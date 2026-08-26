import { audioEngine } from './AudioEngine';

/**
 * Who needs which registers decoded and playable.
 *
 * The visible key bed and a MIDI device move independently — a MIDI keyboard
 * keeps playing on every tab, long after the key bed has unmounted — so the
 * engine is told the union rather than whichever one moved last.
 * `ensurePlayableRange` also remembers its argument to reload after an
 * instrument switch, so a narrow caller must never be the last to speak.
 */
export type RangeContributor = 'keyboard' | 'midi';

const spans = new Map<RangeContributor, { low: number; high: number }>();
/** The most recent load, so a caller can wait for roots that are still coming. */
let pending: Promise<void> = Promise.resolve();

/**
 * Returns the load this contribution is waiting on — already resolved when
 * the union did not move. A caller that needs a note to sound can await it
 * and try again, rather than dropping the note that asked for the register.
 */
export function contributeRange(who: RangeContributor, low: number, high: number): Promise<void> {
  const current = spans.get(who);
  if (current && current.low === low && current.high === high) return pending;
  spans.set(who, { low, high });
  let unionLow = Infinity;
  let unionHigh = -Infinity;
  for (const span of spans.values()) {
    unionLow = Math.min(unionLow, span.low);
    unionHigh = Math.max(unionHigh, span.high);
  }
  pending = audioEngine.ensurePlayableRange(unionLow, unionHigh).catch(() => {
    // The shared load-progress state exposes the retryable error.
  });
  return pending;
}

/**
 * Contributions deliberately outlive the component that made them: a range
 * that was playable stays playable, so leaving the Play page and coming back
 * does not re-decode what was already there.
 */
export function __resetForTests(): void {
  spans.clear();
  pending = Promise.resolve();
}
