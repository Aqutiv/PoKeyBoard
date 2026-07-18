import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Blues Bass in C" — original jam backing by Claude Fable 5. Three choruses
 * of 12-bar blues boogie bass (C7–F7–G7) with a chromatic turnaround,
 * swung eighths at an explicit 2:1 triplet feel, 104 bpm. The bass lives at
 * C2–F3, leaving the whole upper keyboard free to improvise over — try the
 * C blues scale (C, Eb, F, F#, G, Bb).
 */

const events: TrackEvent[] = [];

/** Offbeat eighths land two thirds through the beat: 2:1 swing. */
const SWING = 2 / 3;

const C7 = ['C2', 'E2', 'G2', 'A2', 'Bb2', 'A2', 'G2', 'E2'] as const;
const F7 = ['F2', 'A2', 'C3', 'D3', 'Eb3', 'D3', 'C3', 'A2'] as const;
const G7 = ['G2', 'B2', 'D3', 'E3', 'F3', 'E3', 'D3', 'B2'] as const;

/** One bar of walking boogie: eight swung eighths, beats 1 and 3 accented. */
function boogieBar(bar: number, notes: readonly string[], accent: number): void {
  notes.forEach((name, i) => {
    const beatInBar = Math.floor(i / 2);
    const off = i % 2 === 1;
    const beat = (bar - 1) * 4 + beatInBar + (off ? SWING : 0);
    const vel = off
      ? 0.55 + accent
      : beatInBar === 0
        ? 0.72 + accent
        : beatInBar === 2
          ? 0.68 + accent
          : 0.63 + accent;
    events.push([beat, name, off ? 0.3 : 0.6, vel]);
  });
}

/** Chromatic quarter-note walk G–A–Bb–B, aiming the ear back at C. */
function turnaround(bar: number, accent: number): void {
  const walk: Array<[string, number]> = [
    ['G2', 0.66],
    ['A2', 0.62],
    ['Bb2', 0.64],
    ['B2', 0.7],
  ];
  walk.forEach(([name, vel], i) => {
    events.push([(bar - 1) * 4 + i, name, 0.8, vel + accent]);
  });
}

/** A 12-bar chorus: C C C C | F F C C | G F C | turnaround. */
function chorus(startBar: number, accent: number): void {
  const shapes = [C7, C7, C7, C7, F7, F7, C7, C7, G7, F7, C7] as const;
  shapes.forEach((shape, i) => boogieBar(startBar + i, shape, accent));
  turnaround(startBar + 11, accent);
}

// Each chorus digs in a little harder than the last.
chorus(1, 0);
chorus(13, 0.02);
chorus(25, 0.04);
// Land home: a low C octave with a touch of the third, left to ring.
events.push([144, 'C2', 4, 0.74], [144, 'C3', 4, 0.68], [144, 'E3', 4, 0.6]);

export const BLUES_IN_C: LibraryTrackDef = {
  trackId: 'blues-in-c',
  title: 'Blues Bass in C',
  composer: 'Claude Fable 5',
  descriptionKey: 'bluesInC',
  bpm: 104,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: 'off',
  events,
};
