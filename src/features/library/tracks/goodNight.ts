import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Good Night" - an original piano lullaby by GPT 5.6 Sol Ultra.
 *
 * G major, gently rocking 6/8 at 72 bpm, about 90 seconds. A quiet four-bar
 * introduction leads to two statements of the main melody, a moonlit E-minor
 * middle section, and a softened return. The repeating broken chords are kept
 * low beneath the singing melody, with a fresh pedal for every bar.
 */

const events: TrackEvent[] = [];

function n(
  bar: number,
  beat: number,
  note: string | string[],
  duration: number,
  velocity: number,
): void {
  events.push([(bar - 1) * 6 + (beat - 1), note, duration, velocity]);
}

type RockingHarmony = readonly [
  bass: string,
  beatOne: string,
  beatTwo: string,
  beatThree: string,
  beatFour: string,
  beatFive: string,
  beatSix: string,
];

/** A sustained bass under six softly breathing eighth notes. */
function rock(bar: number, harmony: RockingHarmony, lift = 0): void {
  n(bar, 1, harmony[0], 5.8, 0.38 + lift);
  const pulseVelocities = [0.39, 0.34, 0.37, 0.42, 0.36, 0.33];
  harmony.slice(1).forEach((note, index) => {
    n(bar, index + 1, note, 0.82, (pulseVelocities[index] ?? 0.34) + lift);
  });
}

function accompany(startBar: number, harmonies: readonly RockingHarmony[], lift = 0): void {
  harmonies.forEach((harmony, index) => rock(startBar + index, harmony, lift));
}

type MelodyNote = readonly [beat: number, note: string, duration: number, velocity: number];

function melody(bar: number, notes: readonly MelodyNote[]): void {
  notes.forEach(([beat, note, duration, velocity]) => n(bar, beat, note, duration, velocity));
}

const G: RockingHarmony = ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3'];
const D_OVER_FS: RockingHarmony = ['F#2', 'D3', 'A3', 'D4', 'F#4', 'D4', 'A3'];
const EM: RockingHarmony = ['E2', 'B2', 'E3', 'G3', 'B3', 'G3', 'E3'];
const C: RockingHarmony = ['C3', 'G3', 'C4', 'E4', 'G3', 'E4', 'C4'];
const G_OVER_B: RockingHarmony = ['B2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3'];
const AM7: RockingHarmony = ['A2', 'E3', 'A3', 'C4', 'E4', 'C4', 'G3'];
const D7: RockingHarmony = ['D3', 'A3', 'C4', 'D4', 'A3', 'D4', 'C4'];
const BM_OVER_D: RockingHarmony = ['D3', 'A3', 'B3', 'D4', 'F#4', 'D4', 'B3'];
const CMAJ7: RockingHarmony = ['C3', 'G3', 'B3', 'C4', 'E4', 'C4', 'B3'];
const EM_OVER_G: RockingHarmony = ['G2', 'B2', 'E3', 'G3', 'B3', 'G3', 'E3'];
const C_OVER_D: RockingHarmony = ['D3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4'];

// Introduction, two verses, a slightly fuller middle, and the quiet return.
accompany(1, [G, D_OVER_FS, EM, C], -0.04);
accompany(5, [G, D_OVER_FS, EM, C, G_OVER_B, AM7, D7, G], -0.02);
accompany(13, [G, D_OVER_FS, EM, C, G_OVER_B, AM7, D7, G]);
accompany(21, [EM, BM_OVER_D, CMAJ7, G_OVER_B, AM7, EM_OVER_G, C_OVER_D, D7], 0.02);
accompany(29, [G, D_OVER_FS, EM, C], -0.01);
accompany(33, [G_OVER_B, AM7, D7], -0.04);

// ---- Introduction: distant, bell-like fragments -------------------------
melody(1, [
  [1, 'D5', 2.8, 0.5],
  [4, 'B4', 2.8, 0.47],
]);
melody(2, [
  [1, 'A4', 1.8, 0.47],
  [3, 'D5', 0.8, 0.5],
  [4, 'F#5', 2.8, 0.53],
]);
melody(3, [
  [1, 'E5', 2.8, 0.52],
  [4, 'B4', 1.8, 0.47],
  [6, 'G4', 0.8, 0.44],
]);
melody(4, [
  [1, 'E5', 1.8, 0.5],
  [3, 'D5', 0.8, 0.47],
  [4, 'B4', 2.8, 0.46],
]);

// ---- A: the lullaby theme -----------------------------------------------
melody(5, [
  [1, 'B4', 1.8, 0.58],
  [3, 'D5', 0.8, 0.62],
  [4, 'B4', 1.8, 0.57],
  [6, 'A4', 0.8, 0.53],
]);
melody(6, [
  [1, 'A4', 1.8, 0.55],
  [3, 'F#4', 0.8, 0.5],
  [4, 'A4', 1.8, 0.56],
  [6, 'B4', 0.8, 0.58],
]);
melody(7, [
  [1, 'G4', 1.8, 0.53],
  [3, 'B4', 0.8, 0.57],
  [4, 'E5', 1.8, 0.63],
  [6, 'D5', 0.8, 0.58],
]);
melody(8, [
  [1, 'C5', 2.8, 0.59],
  [4, 'G4', 1.8, 0.51],
  [6, 'A4', 0.8, 0.54],
]);
melody(9, [
  [1, 'B4', 1.8, 0.58],
  [3, 'D5', 0.8, 0.62],
  [4, 'G5', 1.8, 0.67],
  [6, 'F#5', 0.8, 0.63],
]);
melody(10, [
  [1, 'E5', 2.8, 0.62],
  [4, 'C5', 1.8, 0.57],
  [6, 'B4', 0.8, 0.54],
]);
melody(11, [
  [1, 'A4', 1.8, 0.54],
  [3, 'F#4', 0.8, 0.49],
  [4, 'A4', 0.8, 0.54],
  [5, 'B4', 0.8, 0.57],
  [6, 'D5', 0.8, 0.61],
]);
melody(12, [[1, 'G4', 5.6, 0.56]]);

// ---- A': the same thought opens toward the upper register ----------------
melody(13, [
  [1, 'B4', 0.8, 0.59],
  [2, 'D5', 0.8, 0.62],
  [3, 'G5', 0.8, 0.67],
  [4, 'F#5', 1.8, 0.64],
  [6, 'D5', 0.8, 0.59],
]);
melody(14, [
  [1, 'A4', 1.8, 0.55],
  [3, 'F#4', 0.8, 0.5],
  [4, 'D5', 1.8, 0.61],
  [6, 'A4', 0.8, 0.54],
]);
melody(15, [
  [1, 'B4', 0.8, 0.57],
  [2, 'E5', 1.8, 0.63],
  [4, 'G5', 0.8, 0.68],
  [5, 'F#5', 1.8, 0.64],
]);
melody(16, [
  [1, 'E5', 1.8, 0.61],
  [3, 'C5', 0.8, 0.57],
  [4, 'G4', 2.8, 0.51],
]);
melody(17, [
  [1, 'D5', 1.8, 0.61],
  [3, 'G5', 0.8, 0.68],
  [4, 'B5', 1.8, 0.71],
  [6, 'A5', 0.8, 0.68],
]);
melody(18, [
  [1, 'G5', 2.8, 0.67],
  [4, 'E5', 1.8, 0.61],
  [6, 'D5', 0.8, 0.57],
]);
melody(19, [
  [1, 'C5', 1.8, 0.59],
  [3, 'A4', 0.8, 0.54],
  [4, 'F#4', 0.8, 0.5],
  [5, 'A4', 0.8, 0.55],
  [6, 'C5', 0.8, 0.59],
]);
melody(20, [[1, 'B4', 5.6, 0.58]]);

// ---- B: moonlight, briefly colored by E minor ---------------------------
melody(21, [
  [1, 'E5', 2.8, 0.64],
  [4, 'G5', 1.8, 0.69],
  [6, 'F#5', 0.8, 0.65],
]);
melody(22, [
  [1, 'D5', 1.8, 0.61],
  [3, 'B4', 0.8, 0.57],
  [4, 'F#5', 1.8, 0.66],
  [6, 'D5', 0.8, 0.6],
]);
melody(23, [
  [1, 'E5', 0.8, 0.62],
  [2, 'G5', 0.8, 0.67],
  [3, 'B5', 0.8, 0.71],
  [4, 'A5', 1.8, 0.68],
  [6, 'G5', 0.8, 0.65],
]);
melody(24, [
  [1, 'D5', 2.8, 0.61],
  [4, 'B4', 1.8, 0.56],
  [6, 'D5', 0.8, 0.6],
]);
melody(25, [
  [1, 'C5', 1.8, 0.59],
  [3, 'E5', 0.8, 0.63],
  [4, 'A5', 1.8, 0.69],
  [6, 'G5', 0.8, 0.65],
]);
melody(26, [
  [1, 'F#5', 0.8, 0.64],
  [2, 'E5', 0.8, 0.61],
  [3, 'B4', 0.8, 0.56],
  [4, 'G4', 2.8, 0.51],
]);
melody(27, [
  [1, 'E5', 1.8, 0.62],
  [3, 'D5', 0.8, 0.59],
  [4, 'C5', 1.8, 0.57],
  [6, 'A4', 0.8, 0.53],
]);
melody(28, [
  [1, 'F#4', 0.8, 0.51],
  [2, 'A4', 0.8, 0.55],
  [3, 'C5', 0.8, 0.59],
  [4, 'D5', 1.8, 0.62],
  [6, 'F#5', 0.8, 0.66],
]);

// ---- Return and coda: the melody settles and the room grows still --------
melody(29, [
  [1, 'B4', 1.8, 0.58],
  [3, 'D5', 0.8, 0.61],
  [4, 'B4', 1.8, 0.56],
  [6, 'A4', 0.8, 0.52],
]);
melody(30, [
  [1, 'A4', 1.8, 0.54],
  [3, 'F#4', 0.8, 0.49],
  [4, 'A4', 1.8, 0.54],
  [6, 'D5', 0.8, 0.59],
]);
melody(31, [
  [1, 'G4', 1.8, 0.51],
  [3, 'B4', 0.8, 0.55],
  [4, 'E5', 1.8, 0.61],
  [6, 'D5', 0.8, 0.56],
]);
melody(32, [
  [1, 'C5', 2.8, 0.56],
  [4, 'G4', 1.8, 0.49],
  [6, 'E4', 0.8, 0.45],
]);
melody(33, [
  [1, 'G4', 1.8, 0.5],
  [3, 'B4', 0.8, 0.54],
  [4, 'D5', 1.8, 0.58],
  [6, 'G5', 0.8, 0.62],
]);
melody(34, [
  [1, 'E5', 2.8, 0.57],
  [4, 'C5', 1.8, 0.52],
  [6, 'A4', 0.8, 0.48],
]);
melody(35, [
  [1, 'F#4', 1.8, 0.46],
  [3, 'A4', 0.8, 0.49],
  [4, 'C5', 1.8, 0.52],
  [6, 'D5', 0.8, 0.54],
]);

// One final, widely spaced G-major chord, held for the whole last bar.
n(36, 1, ['G2', 'D3', 'G3'], 6, 0.36);
n(36, 1, ['B3', 'D4', 'G4', 'B4', 'D5'], 6, 0.5);

export const GOOD_NIGHT: LibraryTrackDef = {
  trackId: 'good-night',
  title: 'Good Night',
  composer: 'GPT 5.6 Sol Ultra',
  descriptionKey: 'goodNight',
  bpm: 72,
  timeSignature: { numerator: 6, denominator: 8 },
  quantization: '1/8',
  pedal: 'bar',
  events,
};
