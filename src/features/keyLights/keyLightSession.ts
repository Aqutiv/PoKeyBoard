import {
  allDark,
  builtInMode,
  DARK,
  enterLedMode,
  PARTYKEYS_KEYS,
  rgbFrames,
  sameRgb,
  type KeyColour,
  type Rgb8,
} from './partyKeysProtocol';

/** One light per physical key, left to right. */
export type DeviceLights = readonly Rgb8[];

export const ALL_DARK: DeviceLights = Array.from({ length: PARTYKEYS_KEYS }, () => DARK);

/** At most one update in this long: 25 a second, the rate a PartyKeys bridge proved. */
export const FRAME_GAP_MS = 40;
/** How long LED mode is given to take hold before the first colours. */
export const MODE_SETTLE_MS = 50;

/** The keys whose light has to change: only these are sent. */
export function lightChanges(sent: DeviceLights, wanted: DeviceLights): KeyColour[] {
  const changes: KeyColour[] = [];
  for (let key = 0; key < PARTYKEYS_KEYS; key += 1) {
    const colour = wanted[key] ?? DARK;
    if (!sameRgb(sent[key] ?? DARK, colour)) changes.push({ key, colour });
  }
  return changes;
}

type Phase = 'fresh' | 'settling' | 'live' | 'repaint';

/**
 * One keyboard's lights, as PianoBallDesktop's `KeyLightSession` runs them:
 * LED mode, a moment to settle, every key dark, then only the keys that
 * change, at most one update per `FRAME_GAP_MS`. Pure: `step` says what to
 * send and the caller sends it, in order; a send that fails calls `fail`, and
 * the next step starts over from LED mode.
 */
export class KeyLightSession {
  private phase: Phase = 'fresh';
  private since = 0;
  private last = Number.NEGATIVE_INFINITY;
  private sent: DeviceLights = ALL_DARK;
  private repainting = false;

  /** The frames that bring the keyboard toward `wanted` at `nowMs`; often none. */
  step(nowMs: number, wanted: DeviceLights): Uint8Array[] {
    if (this.phase === 'fresh' || this.phase === 'repaint') {
      this.repainting = this.phase === 'repaint';
      this.phase = 'settling';
      this.since = nowMs;
      return [enterLedMode()];
    }
    const frames: Uint8Array[] = [];
    if (this.phase === 'settling') {
      if (nowMs - this.since < MODE_SETTLE_MS) return frames;
      if (this.repainting) {
        // Every key again, without going dark first: the keyboard drew its
        // own lights over them, so what was sent before says nothing now.
        this.repainting = false;
        this.phase = 'live';
        this.sent = [...wanted];
        this.last = nowMs;
        return rgbFrames(wanted.map((colour, key) => ({ key, colour })));
      }
      frames.push(...allDark());
      this.sent = ALL_DARK;
      this.phase = 'live';
      this.last = Number.NEGATIVE_INFINITY;
    }
    if (nowMs - this.last < FRAME_GAP_MS) return frames;
    const changes = lightChanges(this.sent, wanted);
    if (changes.length === 0) return frames;
    frames.push(...rgbFrames(changes));
    this.sent = [...wanted];
    this.last = nowMs;
    return frames;
  }

  /**
   * When `step` next has something to send for `wanted`, as a delay from
   * `nowMs`: 0 now, a wait for the mode to settle or the frame gap to pass,
   * or null when the keyboard already shows it.
   */
  nextStepIn(nowMs: number, wanted: DeviceLights): number | null {
    if (this.phase === 'fresh' || this.phase === 'repaint') return 0;
    if (this.phase === 'settling') return Math.max(0, MODE_SETTLE_MS - (nowMs - this.since));
    if (lightChanges(this.sent, wanted).length === 0) return null;
    return Math.max(0, FRAME_GAP_MS - (nowMs - this.last));
  }

  /** Lights out, then the keyboard's own behaviour back (mode 00). */
  release(): Uint8Array[] {
    if (this.phase === 'fresh') return [];
    const frames = this.phase === 'live' ? allDark() : [];
    frames.push(builtInMode());
    this.phase = 'fresh';
    this.repainting = false;
    this.sent = ALL_DARK;
    return frames;
  }

  /** The keyboard took its lights over (its Multi-Function Button): LED mode again, then every key. */
  repaintAll(): void {
    if (this.phase === 'live' || this.phase === 'repaint') this.phase = 'repaint';
  }

  /** A send failed: the keyboard's state is unknown, so the next step starts over. */
  fail(): void {
    this.phase = 'fresh';
    this.repainting = false;
    this.sent = ALL_DARK;
  }

  get live(): boolean {
    return this.phase === 'live';
  }
}
