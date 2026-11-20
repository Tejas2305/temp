/**
 * "Saathi" — the in-app ISL learning companion.
 *
 * Gemini answers first; hosted Gemma is the backup (see aiClient). The prompt keeps the bot
 * honest: it never describes how to physically form a sign (the same rule as the lessons),
 * and points to the app's own visuals instead.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generate, extractJson, hasApiKey, AIError, AIPreference, ChatTurn, Provider } from './aiClient';
import {
  loadLearnerProfile,
  loadAIStats,
  loadModulesProgress,
  loadPersonalizedRoadmap,
} from './learningStorage';

export type ChatAction = 'recognize' | 'learn' | 'studio' | 'academy' | 'history' | 'lesson';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  suggestions?: string[];
  action?: ChatAction | null;
  letter?: string;
  provider?: Provider;
  model?: string;
  error?: boolean;
  createdAt: number;
}

const STORAGE_KEY = '@abhivyakti/chat_v1';
const PREF_KEY = '@abhivyakti/chat_ai_pref';

export async function loadAIPreference(): Promise<AIPreference> {
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    return v === 'gemini' || v === 'gemma' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveAIPreference(pref: AIPreference): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, pref);
  } catch {
    // non-critical
  }
}

/** Suggestions must never be "how do I sign / say X" style questions. */
const BANNED_SUGGESTION_PATTERNS: RegExp[] = [
  /\bhow (do|can|could|would|should|to)\b.*\b(sign|say)\b/i,
  /\bhow to (sign|say)\b/i,
  /\bshow\b.*\b(sign|gesture)\b/i,
  /\b(sign|gesture|signing)\b.*\b(for|of)\b/i,
  /\bin (isl|indian sign language)\b.*\b(say|sign|show)\b/i,
  /\bwhat('s| is) the sign\b/i,
];

export function cleanSuggestions(list: string[]): string[] {
  return list.filter((s) => !BANNED_SUGGESTION_PATTERNS.some((re) => re.test(s))).slice(0, 3);
}

const MAX_STORED = 60;
const MAX_CONTEXT_TURNS = 14;

const VALID_ACTIONS: ChatAction[] = ['recognize', 'learn', 'studio', 'academy', 'history', 'lesson'];

const SYSTEM_PROMPT = `You are "Saathi", the friendly Indian Sign Language (ISL) learning companion inside the Abhivyakti app.

ABOUT THE APP (you can send people to these):
- Recognize tab: live camera that reads ISL fingerspelling (A-Z, 0-9) and builds a caption.
- Learn tab: A-Z reference images and a 3D Studio for numbers 1-9.
- AI ISL Academy: personalized roadmap, 9 modules, lessons and quizzes.
- History tab: letters the user recognized before.

WHAT YOU DO
- Explain ISL concepts: how ISL differs from ASL (ISL fingerspelling is two-handed, ASL is one-handed), grammar (topic-comment order, facial expressions and body movement carry meaning), regional variation, the role of ISLRTC (Indian Sign Language Research and Training Centre), and Deaf culture and etiquette.
- Coach learning: practice plans, memory tips, how to use the app's tabs, what to study next based on the learner profile, and one-question-at-a-time quizzes when asked.
- Help with real communication: how to get a Deaf person's attention politely, how to be a good communication partner, why eye contact and visibility matter.
- If the user shares text they fingerspelled, explain the word's meaning and give a short practice idea.

HARD RULES
- NEVER describe how to physically make a sign (finger positions, palm orientation, movement) and NEVER invent a sign or claim a gesture "means" something you are not sure of. For "how do I sign X?" explain the meaning, when it is used and a memory tip, then point to the visual in the app (Learn tab images, 3D Studio, Academy lessons) and suggest confirming with a Deaf teacher or ISLRTC resources.
- If you are not sure of a fact, say so plainly. Do not make things up.
- Use respectful language: "Deaf" or "Deaf and hard of hearing". Never say "deaf-mute" or "hearing impaired".
- Stay on topic (ISL, learning, Deaf culture, using this app, communication). Politely steer back otherwise. For medical or legal emergencies, advise contacting a professional or local emergency services.

STYLE
- Warm, encouraging, concise: usually under 110 words. Short paragraphs; a few "- " bullets when useful; **bold** only for key terms.
- Reply in the user's language (English, Hindi, or Hinglish as they write).
- Use the learner context to personalize, but do not recite it back.

OUTPUT: return ONLY valid JSON, no markdown fences:
{"reply": "your message", "suggestions": ["up to 3 short follow-up QUESTIONS the user might tap, max 6 words each, never navigation commands like 'Open Learn tab', and NEVER questions about how to sign or say something (no 'How do I sign...', 'Show me the sign for...', 'How to say ... in ISL')"], "action": null, "letter": null}
"action" may be one of "recognize", "learn", "studio", "academy", "history", "lesson" when opening that part of the app would genuinely help right now (otherwise null). For "lesson" also set "letter" to a single A-Z letter.`;

export const STARTER_PROMPTS = [
  'How is ISL different from ASL?',
  'How should I practice fingerspelling?',
  'Quiz me on greetings',
  'How do I use this app?',
];

export function welcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    role: 'bot',
    text:
      "Namaste! 🙏 I'm **Saathi**, your ISL learning companion. Ask me about Indian Sign Language, Deaf culture, how to practice, or how to use the app.",
    suggestions: STARTER_PROMPTS.slice(0, 3),
    createdAt: Date.now(),
  };
}

export async function loadChat(): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveChat(messages: ChatMessage[]): Promise<void> {
  try {
    const keep = messages.filter((m) => !m.error && m.id !== 'welcome').slice(-MAX_STORED);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
  } catch {
    // non-critical
  }
}

export async function clearChat(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // non-critical
  }
}

async function buildLearnerContext(extra?: string): Promise<string> {
  try {
    const [profile, stats, progress, roadmap] = await Promise.all([
      loadLearnerProfile(),
      loadAIStats(),
      loadModulesProgress(),
      loadPersonalizedRoadmap(),
    ]);
    const done = Object.values(progress).filter((m) => m.isCompleted).length;
    const lines = [
      `Level: ${profile.level}${profile.assessmentCompleted ? '' : ' (assessment not taken yet)'}`,
      `Streak: ${profile.streakDays} day(s), XP: ${profile.totalXP}, daily goal: ${profile.dailyGoalMinutes} min`,
      `Modules completed: ${done}/9, lessons: ${stats.lessonsCompleted}, quizzes: ${stats.quizzesTaken}` +
        (stats.quizzesTaken ? `, average score ${stats.averageQuizScore}%` : ''),
      stats.weakTopics.length ? `Weak topics: ${stats.weakTopics.slice(0, 5).join(', ')}` : '',
      roadmap?.modules?.length ? `Roadmap priority #1: ${roadmap.modules[0].title}` : '',
      extra ? `Context from the app: ${extra}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  } catch {
    return extra ? `Context from the app: ${extra}` : '';
  }
}

function toTurns(history: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of history.filter((x) => !x.error && x.id !== 'welcome').slice(-MAX_CONTEXT_TURNS)) {
    const role = m.role === 'user' ? 'user' : 'model';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n${m.text}`; // keep roles strictly alternating
    else turns.push({ role, text: m.text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export interface SaathiReply {
  text: string;
  suggestions: string[];
  action: ChatAction | null;
  letter?: string;
  provider: Provider;
  model: string;
}

/**
 * Ask Saathi. `history` must NOT include the new user message (it is passed separately).
 * Throws AIError when every model fails.
 */
export async function askSaathi(
  history: ChatMessage[],
  userText: string,
  appContext?: string,
  prefer: AIPreference = 'auto',
): Promise<SaathiReply> {
  if (!hasApiKey()) throw new AIError('AI key is not configured.', []);

  const learner = await buildLearnerContext(appContext);
  const system = `${SYSTEM_PROMPT}\n\nLEARNER CONTEXT:\n${learner || 'No learner data yet.'}`;
  const turns = [...toTurns(history), { role: 'user' as const, text: userText }];

  const res = await generate({
    system,
    turns,
    json: true,
    temperature: 0.7,
    maxOutputTokens: 700,
    prefer,
  });

  let reply = res.text;
  let suggestions: string[] = [];
  let action: ChatAction | null = null;
  let letter: string | undefined;

  try {
    const parsed = extractJson<{ reply?: string; suggestions?: unknown; action?: unknown; letter?: unknown }>(res.text);
    if (typeof parsed.reply === 'string' && parsed.reply.trim()) reply = parsed.reply.trim();
    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim());
      suggestions = cleanSuggestions(suggestions);
    }
    if (typeof parsed.action === 'string' && (VALID_ACTIONS as string[]).includes(parsed.action)) {
      action = parsed.action as ChatAction;
    }
    if (typeof parsed.letter === 'string' && /^[A-Za-z]$/.test(parsed.letter.trim())) {
      letter = parsed.letter.trim().toUpperCase();
    }
    if (action === 'lesson' && !letter) action = 'learn';
  } catch {
    reply = salvageReply(res.text);
  }

  return { text: reply, suggestions, action, letter, provider: res.provider, model: res.model };
}

/** Plain-text or truncated-JSON answers (common with Gemma): pull out the readable reply. */
function salvageReply(raw: string): string {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  // Capture the (possibly unterminated) string value of "reply"
  const m = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (m) {
    try {
      return (JSON.parse(`"${m[1]}"`) as string).trim();
    } catch {
      return m[1].split('\\n').join('\n').split('\\"').join('"').trim();
    }
  }
  return cleaned.startsWith('{') ? "Sorry, I couldn't put that together. Could you ask again?" : cleaned;
}

export function friendlyError(err: unknown, prefer: AIPreference = 'auto'): string {
  const who = prefer === 'gemini' ? 'Gemini' : prefer === 'gemma' ? 'Gemma' : 'The AI models';
  const hint = prefer === 'auto' ? '' : ' You can switch to Auto to use the other model as well.';

  if (err instanceof AIError) {
    if (err.attempts.length === 0) return err.message;
    const attempts = err.attempts;
    const detail = ` (${attempts.map((a) => `${a.model}: ${a.status || 'no response'}`).join(', ')})`;
    const all = (fn: (a: (typeof attempts)[number]) => boolean) => attempts.every(fn);
    const any = (fn: (a: (typeof attempts)[number]) => boolean) => attempts.some(fn);

    if (any((a) => /Network request failed|Failed to fetch|network/i.test(a.message)))
      return `I can't reach the internet. Check your connection and try again.`;
    if (all((a) => a.status === 503))
      return `${who} is overloaded on Google's side right now ("high demand", error 503). I already retried automatically. Please try again in a moment.${hint}${detail}`;
    if (any((a) => a.status === 429))
      return `${who} has hit its usage limit (error 429, quota). Please try again later.${hint}${detail}`;
    if (all((a) => /Timed out/i.test(a.message)))
      return `${who} took too long to respond and timed out. The model may be busy.${hint}${detail}`;
    if (any((a) => a.status === 403 || a.status === 401))
      return `Google rejected the API key (error ${attempts.find((a) => a.status === 403 || a.status === 401)!.status}). Check the key in the app settings.${detail}`;
    if (all((a) => a.status === 404))
      return `${who} isn't available for this API key (model not found).${hint}${detail}`;
    return `${who} couldn't answer right now.${hint}${detail}`;
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (/Network request failed|Failed to fetch/i.test(msg)) return "I can't reach the internet. Check your connection and try again.";
  return `Something went wrong: ${msg}`;
}
