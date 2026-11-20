/**
 * Shared Google AI client: Gemini first, hosted Gemma as the fallback.
 *
 * Every model in CHAIN is tried in order with its own timeout. Quota / overload / missing
 * model errors put that model on a short cooldown so later calls skip straight to a model
 * that works instead of waiting for it to fail again.
 */
import Constants from 'expo-constants';

let localKey = '';
try {
  // @ts-ignore — optional local gitignored runtime key
  const { GEMINI_RUNTIME_KEY } = require('./geminiConfig');
  localKey = GEMINI_RUNTIME_KEY || '';
} catch {
  // ignored
}

const API_KEY: string =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  localKey ||
  ((Constants?.expoConfig?.extra as any)?.geminiApiKey as string) ||
  '';

export type Provider = 'gemini' | 'gemma';

interface ChainEntry {
  model: string;
  provider: Provider;
  timeoutMs: number;
  /** Retries for transient 503 "high demand" responses. */
  retries?: number;
}

// Fast Gemini models first, then slower Gemini, then Gemma (less accurate, used as a safety net).
const CHAIN: ChainEntry[] = [
  { model: 'gemini-3.5-flash-lite', provider: 'gemini', timeoutMs: 20000 },
  { model: 'gemini-flash-lite-latest', provider: 'gemini', timeoutMs: 20000 },
  { model: 'gemini-3.5-flash', provider: 'gemini', timeoutMs: 30000 },
  { model: 'gemma-4-26b-a4b-it', provider: 'gemma', timeoutMs: 25000, retries: 2 },
  { model: 'gemma-4-31b-it', provider: 'gemma', timeoutMs: 30000, retries: 1 },
];

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export type AIPreference = 'auto' | 'gemini' | 'gemma';

export interface GenerateOptions {
  /** 'auto' = Gemini then Gemma fallback. 'gemini' / 'gemma' use only that provider. */
  prefer?: AIPreference;
  system?: string;
  turns: ChatTurn[];
  /** Ask for a JSON response (native JSON mode on Gemini, prompt-only on Gemma). */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: Provider;
  /** Models that failed before this one answered. */
  skipped: string[];
}

export interface AIAttempt {
  model: string;
  message: string;
  /** HTTP status, or 0 for timeouts / network errors. */
  status: number;
}

export class AIError extends Error {
  attempts: AIAttempt[];
  constructor(message: string, attempts: AIAttempt[]) {
    super(message);
    this.name = 'AIError';
    this.attempts = attempts;
  }
}

const cooldownUntil = new Map<string, number>();

export function hasApiKey(): boolean {
  return API_KEY.length > 0;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Timed out after ${Math.round(ms / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function extractJson<T = any>(raw: string): T {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a === -1 || b <= a) throw new Error('Model returned no JSON');
    return JSON.parse(cleaned.slice(a, b + 1)) as T;
  }
}

function buildBody(entry: ChainEntry, opts: GenerateOptions, withThinkingControl = true) {
  const turns = opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  const body: any = {
    contents: turns,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      // Gemma "thinks" before answering and that counts against the limit, so give it more room.
      ...(opts.maxOutputTokens
        ? { maxOutputTokens: entry.provider === 'gemma' ? Math.max(opts.maxOutputTokens * 2, 1500) : opts.maxOutputTokens }
        : {}),
      // Gemma otherwise spends 500+ tokens "thinking" first (12-14 s for a one-line answer).
      ...(entry.provider === 'gemma' && withThinkingControl ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
      ...(opts.json && entry.provider === 'gemini' ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (opts.system) {
    if (entry.provider === 'gemini') {
      body.systemInstruction = { parts: [{ text: opts.system }] };
    } else {
      // Gemma has no dedicated system role: fold the instructions into the first user turn.
      const first = turns.find((t) => t.role === 'user');
      if (first) {
        first.parts[0].text = `${opts.system}\n\n---\n\n${first.parts[0].text}`;
      }
    }
  }
  return body;
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  if (!API_KEY) {
    throw new AIError('Gemini API key is missing. Set EXPO_PUBLIC_GEMINI_API_KEY in .env', []);
  }

  const attempts: AIAttempt[] = [];
  const now = Date.now();
  // Prefer models that are not cooling down, but still try them last if everything is.
  const pool = opts.prefer && opts.prefer !== 'auto' ? CHAIN.filter((c) => c.provider === opts.prefer) : CHAIN;
  const ready = pool.filter((c) => (cooldownUntil.get(c.model) ?? 0) <= now);
  const cooling = pool.filter((c) => !ready.includes(c));
  const order = [...ready, ...cooling];

  for (const entry of order) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${entry.model}:generateContent?key=${API_KEY}`;
      let withThinking = true;
      let tries = 0;
      let data: any = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(entry, opts, withThinking)),
          },
          entry.timeoutMs,
        );
        if (res.ok) {
          data = await res.json();
          break;
        }
        const errJson = await res.json().catch(() => null);
        const msg = String(errJson?.error?.message ?? `HTTP ${res.status}`).split(String.fromCharCode(10))[0].trim();
        // Model rejects the thinking option: retry once without it.
        if (res.status === 400 && withThinking && /thinking/i.test(msg)) {
          withThinking = false;
          continue;
        }
        // Transient overload: short backoff then retry the same model.
        if (res.status === 503 && tries < (entry.retries ?? 0)) {
          tries++;
          await new Promise((r) => setTimeout(r, 1200 * tries));
          continue;
        }
        // quota / model gone: skip for a while; overload: skip briefly
        if (res.status === 429 || res.status === 404) cooldownUntil.set(entry.model, Date.now() + 10 * 60_000);
        else if (res.status >= 500) cooldownUntil.set(entry.model, Date.now() + 60_000);
        const e: any = new Error(`${res.status}: ${msg}`);
        e.status = res.status;
        throw e;
      }

      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => typeof p?.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'empty';
        throw new Error(`No text (${reason})`);
      }

      cooldownUntil.delete(entry.model);
      return { text, model: entry.model, provider: entry.provider, skipped: attempts.map((a) => a.model) };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.warn(`[aiClient] ${entry.model} failed: ${message}`);
      attempts.push({ model: entry.model, message, status: typeof err?.status === 'number' ? err.status : 0 });
      if (/Timed out/i.test(message)) cooldownUntil.set(entry.model, Date.now() + 60_000);
    }
  }

  throw new AIError(
    `All AI models failed. Last error: ${attempts[attempts.length - 1]?.message ?? 'unknown'}`,
    attempts,
  );
}
