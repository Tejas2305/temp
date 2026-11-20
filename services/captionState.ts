/**
 * Exact port of the extension's content/caption-state.js (same as realtime_isl.py):
 * a letter is committed once its confidence >= minConf and the same label is held for
 * minSamples frames and holdMs; it commits once until the label changes or the hand
 * leaves. A space is added after spaceMs with no hand.
 */
export interface CaptionOptions {
  minConf: number;
  holdMs: number;
  minSamples: number;
  spaceMs: number;
}

export interface FrameResult {
  hasHand: boolean;
  label?: string;
  conf?: number;
}

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = {
  minConf: 0.7,
  holdMs: 300,
  minSamples: 2,
  spaceMs: 1500,
};

export class CaptionState {
  opts: CaptionOptions;
  text = '';
  live: { label: string; conf: number } | null = null;
  private cand: string | null = null;
  private count = 0;
  private candSince: number | null = null;
  private locked = false;
  private noHandSince: number | null = null;

  constructor(opts: Partial<CaptionOptions> = {}) {
    this.opts = { ...DEFAULT_CAPTION_OPTIONS, ...opts };
  }

  reset() {
    this.text = '';
    this.resetTracking();
  }

  resetTracking() {
    this.cand = null;
    this.count = 0;
    this.candSince = null;
    this.locked = false;
    this.noHandSince = null;
    this.live = null;
  }

  /** Progress (0..1) towards committing the current candidate letter. */
  holdProgress(now: number): number {
    if (this.cand == null || this.locked || this.candSince == null) return this.locked ? 1 : 0;
    return Math.min(1, (now - this.candSince) / this.opts.holdMs);
  }

  /** Feed one frame. Returns the characters appended to `text` (may be ''). */
  update(r: FrameResult | null, now: number): string {
    const o = this.opts;
    let add = '';
    if (!r || !r.hasHand) {
      this.cand = null;
      this.count = 0;
      this.locked = false;
      this.live = null;
      if (this.noHandSince == null) this.noHandSince = now;
      if (this.text && !this.text.endsWith(' ') && now - this.noHandSince >= o.spaceMs) {
        this.text += ' ';
        add = ' ';
      }
      return add;
    }

    const label = r.label ?? '';
    const conf = r.conf ?? 0;
    this.noHandSince = null;
    this.live = { label, conf };

    if (conf >= o.minConf) {
      if (label === this.cand) {
        this.count++;
        if (this.candSince == null) this.candSince = now;
      } else {
        this.cand = label;
        this.count = 1;
        this.candSince = now;
        this.locked = false;
      }
      if (!this.locked && this.count >= o.minSamples && now - (this.candSince ?? now) >= o.holdMs) {
        this.text += label;
        this.locked = true;
        add = label;
        if (this.text.length > 300) this.text = this.text.slice(-200);
      }
    } else {
      this.count = 0;
      this.candSince = null;
    }
    return add;
  }
}
