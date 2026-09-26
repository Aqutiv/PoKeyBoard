import { majorTonicName } from '@/features/notation/keySignature';

/**
 * The circle of fifths, as data: the twelve major keys in a ring, each named
 * by its signature in fifths. Kept apart from the drawing so a chapter's
 * catalog test reads the very slots the picture draws.
 *
 * C sits at the top. Each step clockwise is a fifth up and one more sharp;
 * each step anticlockwise a fifth down and one more flat. The two sides meet
 * at the bottom, where six sharps and six flats are one key spelled two ways —
 * so that slot stands for both. Seven sharps and seven flats, which overlap
 * D♭ and B the same way, are left off: a ring of twelve names is what a
 * reader can take in at once.
 */

/** Where the two sides of the ring meet: F♯ major, which is also G♭. */
const MEETING = 6;

/** Clockwise from the top. */
export const CIRCLE_SLOTS: readonly number[] = [0, 1, 2, 3, 4, 5, MEETING, -5, -4, -3, -2, -1];

/** Whether a slot stands for this signature — the bottom one stands for two. */
export function slotHolds(slot: number, fifths: number): boolean {
  return slot === fifths || (slot === MEETING && fifths === -MEETING);
}

/** A slot's key as the ring names it: "D", "B♭", and "F♯/G♭" at the bottom. */
export function circleKeyName(slot: number): string {
  if (slot === MEETING) return `${majorTonicName(MEETING)}/${majorTonicName(-MEETING)}`;
  return majorTonicName(slot);
}

/** A slot's signature as the ring counts it: "0", "2♯", "3♭", "6♯/6♭". */
export function circleCount(slot: number): string {
  if (slot === MEETING) return `${MEETING}♯/${MEETING}♭`;
  if (slot === 0) return '0';
  return slot > 0 ? `${slot}♯` : `${-slot}♭`;
}
