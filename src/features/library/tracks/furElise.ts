import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Für Elise" (Bagatelle No. 25 in A minor, WoO 59) — Ludwig van Beethoven,
 * 1810. Public domain. The famous opening section: ||: A :|| B A B A.
 *
 * 3/8, beats are eighth notes. `beatDurationMs` derives the beat from the
 * quarter at the stored bpm, so bpm 70 yields a ~429 ms eighth — poco moto.
 * Left hand sits one octave above the urtext's deepest bass (lowest ≈ A2)
 * to hug the app's default visible range.
 */

const events: TrackEvent[] = [];

function n(beat: number, note: string, dur: number, vel: number): void {
  events.push([beat, note, dur, vel]);
}

/** The two-sixteenth pickup (E5 D#5) into a theme bar starting at `at`. */
function anacrusis(at: number): void {
  n(at - 1, 'E5', 0.45, 0.66);
  n(at - 0.5, 'D#5', 0.45, 0.62);
}

/** The famous sixteenth run: E5 D#5 E5 B4 D5 C5. */
function runBar(at: number): void {
  const seq: Array<[string, number]> = [
    ['E5', 0.68],
    ['D#5', 0.6],
    ['E5', 0.66],
    ['B4', 0.6],
    ['D5', 0.64],
    ['C5', 0.62],
  ];
  seq.forEach(([name, vel], i) => n(at + i * 0.5, name, 0.45, vel));
}

/** Left-hand arpeggio, let ring under the bar (fingers hold, as pedal would). */
function lhArp(at: number, notes: [string, string, string]): void {
  n(at, notes[0], 2.5, 0.5);
  n(at + 0.5, notes[1], 2, 0.46);
  n(at + 1, notes[2], 1.5, 0.44);
}

/** A-minor bar: A4 answer plus the rising C4–E4–A4 sixteenths. */
function aMinorBar(at: number): void {
  lhArp(at, ['A2', 'E3', 'A3']);
  n(at, 'A4', 1, 0.64);
  n(at + 1.5, 'C4', 0.5, 0.56);
  n(at + 2, 'E4', 0.5, 0.58);
  n(at + 2.5, 'A4', 0.5, 0.62);
}

/** E-major bar; the second phrase falls E4–C5–B4 instead of rising. */
function eMajorBar(at: number, kind: 'rising' | 'falling'): void {
  lhArp(at, ['E3', 'G#3', 'B3']);
  n(at, 'B4', 1, 0.64);
  if (kind === 'rising') {
    n(at + 1.5, 'E4', 0.5, 0.56);
    n(at + 2, 'G#4', 0.5, 0.58);
    n(at + 2.5, 'B4', 0.5, 0.62);
  } else {
    n(at + 1.5, 'E4', 0.5, 0.56);
    n(at + 2, 'C5', 0.5, 0.6);
    n(at + 2.5, 'B4', 0.5, 0.58);
  }
}

/** C5 bar that slides back into the run: C5 … E4 E5 D#5. */
function retransitionBar(at: number): void {
  lhArp(at, ['A2', 'E3', 'A3']);
  n(at, 'C5', 1, 0.66);
  n(at + 1.5, 'E4', 0.5, 0.56);
  n(at + 2, 'E5', 0.5, 0.66);
  n(at + 2.5, 'D#5', 0.5, 0.62);
}

/**
 * One full A statement (8 bars from the run downbeat at `at`).
 * The tail either repeats (pickup E5 D#5), walks up into the B episode
 * (B4 C5 D5), or lets the final A ring. Returns the next downbeat.
 */
function aStatement(at: number, tail: 'repeat' | 'episode' | 'end'): number {
  runBar(at);
  aMinorBar(at + 3);
  eMajorBar(at + 6, 'rising');
  retransitionBar(at + 9);
  runBar(at + 12);
  aMinorBar(at + 15);
  eMajorBar(at + 18, 'falling');

  const last = at + 21;
  if (tail === 'end') {
    n(last, 'A2', 3, 0.5);
    n(last + 0.5, 'E3', 2.5, 0.46);
    n(last + 1, 'A3', 2, 0.44);
    n(last, 'A4', 2, 0.62);
  } else {
    lhArp(last, ['A2', 'E3', 'A3']);
    n(last, 'A4', 1, 0.64);
    if (tail === 'repeat') {
      anacrusis(last + 3);
    } else {
      n(last + 1.5, 'B4', 0.5, 0.6);
      n(last + 2, 'C5', 0.5, 0.62);
      n(last + 2.5, 'D5', 0.5, 0.64);
    }
  }
  return last + 3;
}

/**
 * The brighter B episode (4 bars): C — G — Am — E, each a held melody note
 * answered by a lower neighbor and an upper turn; the E bar's E5 D#5 doubles
 * as the pickup back into the theme. Returns the next downbeat.
 */
function bEpisode(at: number): number {
  lhArp(at, ['C3', 'G3', 'C4']);
  n(at, 'E5', 1, 0.7);
  n(at + 1.5, 'G4', 0.5, 0.58);
  n(at + 2, 'F5', 0.5, 0.68);
  n(at + 2.5, 'E5', 0.5, 0.64);

  lhArp(at + 3, ['G2', 'D3', 'B3']);
  n(at + 3, 'D5', 1, 0.68);
  n(at + 4.5, 'F4', 0.5, 0.56);
  n(at + 5, 'E5', 0.5, 0.66);
  n(at + 5.5, 'D5', 0.5, 0.62);

  lhArp(at + 6, ['A2', 'E3', 'A3']);
  n(at + 6, 'C5', 1, 0.66);
  n(at + 7.5, 'E4', 0.5, 0.54);
  n(at + 8, 'D5', 0.5, 0.64);
  n(at + 8.5, 'C5', 0.5, 0.6);

  lhArp(at + 9, ['E3', 'G#3', 'B3']);
  n(at + 9, 'B4', 1, 0.64);
  n(at + 10.5, 'E4', 0.5, 0.54);
  n(at + 11, 'E5', 0.5, 0.64);
  n(at + 11.5, 'D#5', 0.5, 0.6);
  return at + 12;
}

// Bar 1 holds only the pickup; every later pickup is written by the tail
// of the section before it.
anacrusis(3);
let cursor = aStatement(3, 'repeat');
cursor = aStatement(cursor, 'episode');
cursor = bEpisode(cursor);
cursor = aStatement(cursor, 'episode');
cursor = bEpisode(cursor);
aStatement(cursor, 'end');

export const FUR_ELISE: LibraryTrackDef = {
  trackId: 'fur-elise',
  title: 'Für Elise',
  composer: 'Ludwig van Beethoven',
  descriptionKey: 'furElise',
  bpm: 70,
  timeSignature: { numerator: 3, denominator: 8 },
  quantization: '1/16',
  events,
};
