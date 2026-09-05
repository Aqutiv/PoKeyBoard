import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Where Starlight Lingers" — original piano music by GPT-6 Astra Ultra.
 *
 * An E-flat-major nocturne in 3/4, 54 bars, approximately two minutes.
 * The tune remembers a rising fourth followed by a semitone sigh: Bb–Eb–D.
 * Its twelve-bar first statement has room to breathe; the embellished second
 * thought leads through C minor and G minor to a single, radiant high Eb.
 * The return changes the harmony beneath familiar gestures, especially the
 * borrowed minor subdominant, before the last sigh finds its tonic.
 *
 * The accompaniment moves in six eighths, but the tune leans across that
 * pulse with dotted notes, suspensions, and occasional sixteenth-note turns.
 * Quiet alto answers supply a third voice. Every event names its staff so
 * the left hand keeps its arpeggios when they rise above middle C. Dynamics
 * belong to the voices individually; the tune always leads the texture.
 * Tempo marks shape the phrases and progressively release the closing bars.
 */

const events: TrackEvent[] = [];

/** Bars and beats are 1-based; durations are quarter-note beats. */
function n(
  bar: number,
  beat: number,
  note: string | string[],
  duration: number,
  velocity: number,
  staff: 'treble' | 'bass',
): void {
  events.push([(bar - 1) * 3 + beat - 1, note, duration, velocity, staff]);
}

type LineNote = readonly [
  beat: number,
  note: string | string[],
  duration: number,
  velocity: number,
];

function sing(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([beat, note, duration, velocity]) =>
    n(bar, beat, note, duration, velocity, 'treble'),
  );
}

/** Six individually voiced eighths; pedal carries the bass between attacks. */
type Arpeggio = readonly [string, string, string, string, string, string];

function flow(bar: number, notes: Arpeggio, velocity: number): void {
  const shading = [0.02, -0.05, -0.01, -0.03, 0, -0.04];
  notes.forEach((note, index) =>
    n(bar, 1 + index * 0.5, note, 0.48, velocity + (shading[index] ?? 0), 'bass'),
  );
}

/** Two gently connected alto tones, well below the soprano's dynamic. */
function answer(bar: number, first: string, second: string, velocity = 0.43): void {
  n(bar, 1.5, first, 1.45, velocity, 'treble');
  n(bar, 3, second, 0.95, velocity - 0.025, 'treble');
}

const EB: Arpeggio = ['Eb2', 'Bb2', 'G3', 'Bb3', 'G3', 'Eb3'];
const BB_D: Arpeggio = ['D2', 'Bb2', 'F3', 'Bb3', 'F3', 'D3'];
const CM9: Arpeggio = ['C3', 'G3', 'Bb3', 'Eb4', 'Bb3', 'G3'];
const AB_MAJOR: Arpeggio = ['Ab2', 'Eb3', 'G3', 'C4', 'G3', 'Eb3'];
const EB_G: Arpeggio = ['G2', 'Bb2', 'Eb3', 'G3', 'Bb3', 'G3'];
const FM9: Arpeggio = ['F2', 'C3', 'Ab3', 'Eb4', 'Ab3', 'C3'];
const BB_SUS: Arpeggio = ['Bb2', 'F3', 'Ab3', 'Eb4', 'Ab3', 'F3'];
const BB7: Arpeggio = ['Bb2', 'F3', 'Ab3', 'D4', 'Ab3', 'F3'];
const BB9_SUS: Arpeggio = ['Bb2', 'F3', 'Ab3', 'C4', 'Ab3', 'F3'];
const G7_B: Arpeggio = ['B2', 'F3', 'G3', 'D4', 'G3', 'F3'];
const CM_BB: Arpeggio = ['Bb2', 'Eb3', 'G3', 'C4', 'G3', 'Eb3'];
const DB_MAJOR: Arpeggio = ['Db3', 'Ab3', 'C4', 'F4', 'C4', 'Ab3'];
const FM_C: Arpeggio = ['C3', 'F3', 'Ab3', 'Eb4', 'Ab3', 'F3'];
const A_HALF_DIM: Arpeggio = ['A2', 'Eb3', 'G3', 'C4', 'G3', 'Eb3'];
const D7_A: Arpeggio = ['A2', 'D3', 'F#3', 'C4', 'F#3', 'D3'];
const GM7: Arpeggio = ['G2', 'D3', 'F3', 'Bb3', 'F3', 'D3'];
const AB_MINOR: Arpeggio = ['Ab2', 'Eb3', 'Cb4', 'Eb4', 'Cb4', 'Eb3'];
const C7_E: Arpeggio = ['E2', 'G2', 'Bb2', 'C3', 'G3', 'Bb3'];

// Bars 1–4: a veil of sound, then the motif heard as a question.
flow(1, EB, 0.32);
sing(1, [[2, 'Bb4', 1.8, 0.48]]);
flow(2, AB_MAJOR, 0.34);
sing(2, [
  [1, 'Eb5', 1.45, 0.55],
  [2.5, 'D5', 0.45, 0.49],
  [3, 'C5', 0.8, 0.47],
]);
flow(3, EB_G, 0.35);
sing(3, [
  [1, 'Bb4', 1.9, 0.5],
  [3, 'G4', 0.8, 0.46],
]);
flow(4, BB7, 0.35);
sing(4, [
  [1, 'F4', 1.4, 0.45],
  [2.5, 'Ab4', 0.45, 0.48],
  [3, 'Bb4', 0.8, 0.53],
]);

// Bars 5–16: the twelve-bar theme, three linked four-bar sentences.
flow(5, EB, 0.4);
sing(5, [
  [1, 'Bb4', 1.45, 0.64],
  [2.5, 'Eb5', 0.48, 0.7],
  [3, 'D5', 0.48, 0.64],
  [3.5, 'Bb4', 0.45, 0.59],
]);
flow(6, BB_D, 0.4);
sing(6, [
  [1, 'C5', 0.48, 0.62],
  [1.5, 'D5', 0.48, 0.65],
  [2, 'F5', 1.45, 0.7],
  [3.5, 'D5', 0.45, 0.61],
]);
answer(6, 'F4', 'Ab4', 0.4);
flow(7, CM9, 0.41);
sing(7, [
  [1, 'Eb5', 1.45, 0.67],
  [2.5, 'D5', 0.48, 0.61],
  [3, 'C5', 0.9, 0.58],
]);
flow(8, AB_MAJOR, 0.41);
sing(8, [
  [1, 'C5', 0.48, 0.61],
  [1.5, 'Eb5', 0.48, 0.65],
  [2, 'G5', 0.95, 0.72],
  [3, 'F5', 0.48, 0.66],
  [3.5, 'Eb5', 0.45, 0.62],
]);
answer(8, 'Ab4', 'C5', 0.42);
flow(9, EB_G, 0.42);
sing(9, [
  [1, 'D5', 0.95, 0.64],
  [2, 'Eb5', 0.48, 0.67],
  [2.5, 'G5', 0.48, 0.72],
  [3, 'Bb5', 0.95, 0.77],
]);
flow(10, FM9, 0.43);
sing(10, [
  [1, 'Ab5', 1.45, 0.73],
  [2.5, 'G5', 0.48, 0.67],
  [3, 'F5', 0.95, 0.64],
]);
answer(10, 'C5', 'Ab4', 0.44);
flow(11, BB_SUS, 0.4);
sing(11, [
  [1, 'G5', 0.48, 0.68],
  [1.5, 'F5', 0.48, 0.64],
  [2, 'Eb5', 0.95, 0.61],
  [3, 'C5', 0.48, 0.58],
  [3.5, 'Bb4', 0.45, 0.54],
]);
flow(12, BB7, 0.38);
sing(12, [
  [1, 'D5', 1.45, 0.61],
  [2.5, 'C5', 0.48, 0.56],
  [3, 'Bb4', 0.7, 0.53],
]);
answer(12, 'F4', 'Ab4', 0.39);
flow(13, CM9, 0.4);
sing(13, [
  [1, 'Bb4', 0.95, 0.61],
  [2, 'Eb5', 0.48, 0.67],
  [2.5, 'D5', 0.48, 0.62],
  [3, 'G5', 0.95, 0.73],
]);
flow(14, AB_MAJOR, 0.4);
sing(14, [
  [1, 'F5', 0.48, 0.66],
  [1.5, 'Eb5', 0.48, 0.62],
  [2, 'C5', 0.95, 0.59],
  [3, 'Bb4', 0.95, 0.56],
]);
answer(14, 'G4', 'Ab4', 0.4);
flow(15, BB9_SUS, 0.39);
sing(15, [
  [1, 'Ab4', 0.48, 0.55],
  [1.5, 'C5', 0.48, 0.6],
  [2, 'Eb5', 0.95, 0.65],
  [3, 'D5', 0.48, 0.59],
  [3.5, 'C5', 0.45, 0.56],
]);
flow(16, EB, 0.37);
sing(16, [
  [1, 'Bb4', 1.45, 0.6],
  [2.5, 'G4', 0.48, 0.53],
  [3, 'Eb5', 0.7, 0.62],
]);

// Bars 17–24: the same longing grows more ornamented; Db opens a new door.
flow(17, EB_G, 0.43);
sing(17, [
  [1, 'Bb4', 0.48, 0.64],
  [1.5, 'Eb5', 0.48, 0.7],
  [2, 'D5', 0.23, 0.63],
  [2.25, 'Eb5', 0.23, 0.66],
  [2.5, 'G5', 0.48, 0.75],
  [3, 'F5', 0.48, 0.69],
  [3.5, 'Eb5', 0.45, 0.65],
]);
answer(17, 'G4', 'Bb4', 0.44);
flow(18, G7_B, 0.44);
sing(18, [
  [1, 'D5', 0.48, 0.65],
  [1.5, 'F5', 0.48, 0.7],
  [2, 'Ab5', 0.73, 0.77],
  [2.75, 'G5', 0.23, 0.71],
  [3, 'F5', 0.48, 0.67],
  [3.5, 'D5', 0.45, 0.62],
]);
n(18, 1, 'B4', 2.9, 0.43, 'treble');
flow(19, CM9, 0.44);
sing(19, [
  [1, 'G5', 1.45, 0.75],
  [2.5, 'F5', 0.48, 0.68],
  [3, 'Eb5', 0.48, 0.65],
  [3.5, 'D5', 0.45, 0.61],
]);
n(19, 1, 'C5', 2.9, 0.46, 'treble');
flow(20, CM_BB, 0.45);
sing(20, [
  [1, 'C5', 0.48, 0.64],
  [1.5, 'Eb5', 0.48, 0.68],
  [2, 'G5', 0.48, 0.74],
  [2.5, 'Bb5', 0.95, 0.8],
  [3.5, 'G5', 0.45, 0.7],
]);
answer(20, 'C5', 'Eb5', 0.45);
flow(21, AB_MAJOR, 0.45);
sing(21, [
  [1, 'Ab5', 0.95, 0.76],
  [2, 'G5', 0.48, 0.71],
  [2.5, 'Eb5', 0.48, 0.66],
  [3, 'C5', 0.95, 0.63],
]);
answer(21, 'C5', 'G4', 0.44);
flow(22, DB_MAJOR, 0.47);
sing(22, [
  [1, 'F5', 0.48, 0.69],
  [1.5, 'Ab5', 0.48, 0.75],
  [2, 'C6', 0.95, 0.82],
  [3, 'Bb5', 0.48, 0.75],
  [3.5, 'Ab5', 0.45, 0.71],
]);
answer(22, 'Db5', 'F5', 0.47);
flow(23, FM_C, 0.44);
sing(23, [
  [1, 'G5', 0.48, 0.72],
  [1.5, 'F5', 0.48, 0.67],
  [2, 'Eb5', 0.95, 0.64],
  [3, 'C5', 0.48, 0.6],
  [3.5, 'Ab4', 0.45, 0.56],
]);
flow(24, BB7, 0.42);
sing(24, [
  [1, 'Cb5', 0.48, 0.61],
  [1.5, 'D5', 0.48, 0.64],
  [2, 'F5', 0.48, 0.69],
  [2.5, 'Ab5', 0.48, 0.73],
  [3, 'F5', 0.48, 0.65],
  [3.5, 'D5', 0.22, 0.59],
]);

// Bars 25–32: the motif turns inward, then sequences towards the light.
flow(25, ['C2', 'G2', 'Eb3', 'Bb3', 'G3', 'Eb3'], 0.43);
sing(25, [
  [1, 'G5', 0.95, 0.71],
  [2, 'Eb5', 0.48, 0.66],
  [2.5, 'D5', 0.48, 0.61],
  [3, 'C5', 0.95, 0.59],
]);
answer(25, 'G4', 'Eb4', 0.43);
flow(26, G7_B, 0.44);
sing(26, [
  [1, 'D5', 0.48, 0.63],
  [1.5, 'Eb5', 0.48, 0.66],
  [2, 'F5', 0.48, 0.69],
  [2.5, 'Ab5', 0.48, 0.75],
  [3, 'G5', 0.95, 0.71],
]);
answer(26, 'B4', 'D5', 0.45);
flow(27, CM_BB, 0.46);
sing(27, [
  [1, 'Bb5', 0.95, 0.79],
  [2, 'G5', 0.48, 0.72],
  [2.5, 'F5', 0.48, 0.68],
  [3, 'Eb5', 0.95, 0.65],
]);
answer(27, 'C5', 'G4', 0.46);
flow(28, A_HALF_DIM, 0.46);
sing(28, [
  [1, 'G5', 0.48, 0.71],
  [1.5, 'Eb5', 0.48, 0.66],
  [2, 'C5', 0.95, 0.63],
  [3, 'D5', 0.48, 0.65],
  [3.5, 'Eb5', 0.45, 0.68],
]);
answer(28, 'A4', 'G4', 0.44);
flow(29, D7_A, 0.48);
sing(29, [
  [1, 'F#5', 0.95, 0.75],
  [2, 'A5', 0.48, 0.8],
  [2.5, 'C6', 0.48, 0.84],
  [3, 'Bb5', 0.48, 0.78],
  [3.5, 'A5', 0.45, 0.73],
]);
answer(29, 'C5', 'F#5', 0.48);
flow(30, GM7, 0.48);
sing(30, [
  [1, 'Bb5', 1.45, 0.81],
  [2.5, 'A5', 0.48, 0.75],
  [3, 'G5', 0.95, 0.72],
]);
answer(30, 'D5', 'F5', 0.48);
flow(31, ['Eb2', 'Bb2', 'G3', 'D4', 'Bb3', 'G3'], 0.49);
sing(31, [
  [1, 'F5', 0.48, 0.71],
  [1.5, 'G5', 0.48, 0.76],
  [2, 'Bb5', 0.73, 0.82],
  [2.75, 'A5', 0.23, 0.75],
  [3, 'G5', 0.48, 0.73],
  [3.5, 'F5', 0.45, 0.69],
]);
answer(31, 'Bb4', 'D5', 0.48);
flow(32, AB_MAJOR, 0.5);
sing(32, [
  [1, 'Eb5', 0.48, 0.7],
  [1.5, 'G5', 0.48, 0.76],
  [2, 'C6', 0.95, 0.85],
  [3, 'Bb5', 0.48, 0.79],
  [3.5, 'Ab5', 0.45, 0.75],
]);
answer(32, 'C5', 'Eb5', 0.5);

// Bars 33–36: thirds bloom at the crest, then the line exhales before returning.
flow(33, FM9, 0.52);
sing(33, [
  [1, ['Ab5', 'C6'], 0.95, 0.85],
  [2, ['G5', 'Bb5'], 0.48, 0.78],
  [2.5, ['Ab5', 'C6'], 0.48, 0.84],
  [3, ['Bb5', 'D6'], 0.95, 0.89],
]);
flow(34, ['Bb1', 'F2', 'Bb2', 'Ab3', 'D4', 'F3'], 0.53);
sing(34, [
  [1, ['C6', 'Eb6'], 1.45, 0.91],
  [2.5, ['Bb5', 'D6'], 0.48, 0.85],
  [3, ['Ab5', 'C6'], 0.95, 0.79],
]);
flow(35, EB_G, 0.48);
sing(35, [
  [1, ['G5', 'Bb5'], 0.95, 0.8],
  [2, ['F5', 'Ab5'], 0.48, 0.75],
  [2.5, ['Eb5', 'G5'], 0.48, 0.71],
  [3, ['D5', 'F5'], 0.48, 0.67],
  [3.5, ['Bb4', 'Eb5'], 0.45, 0.63],
]);
flow(36, ['Bb2', 'F3', 'Ab3', 'Eb4', 'D4', 'F3'], 0.42);
sing(36, [
  [1, 'C5', 0.48, 0.61],
  [1.5, 'D5', 0.48, 0.64],
  [2, 'F5', 0.95, 0.68],
  [3, 'D5', 0.48, 0.59],
  [3.5, 'Bb4', 0.22, 0.54],
]);

// Bars 37–48: home, changed by the journey; the alto now sings with the tune.
flow(37, ['Eb2', 'Bb2', 'Eb3', 'G3', 'Bb3', 'G3'], 0.4);
sing(37, [
  [1, 'Bb4', 1.45, 0.66],
  [2.5, 'Eb5', 0.48, 0.72],
  [3, 'D5', 0.48, 0.65],
  [3.5, 'Bb4', 0.45, 0.6],
]);
n(37, 1, 'G4', 2.9, 0.43, 'treble');
flow(38, BB_D, 0.4);
sing(38, [
  [1, 'C5', 0.48, 0.63],
  [1.5, 'D5', 0.48, 0.66],
  [2, 'F5', 1.45, 0.72],
  [3.5, 'D5', 0.45, 0.62],
]);
answer(38, 'F4', 'Ab4', 0.43);
flow(39, CM9, 0.41);
sing(39, [
  [1, 'Eb5', 0.95, 0.68],
  [2, 'D5', 0.48, 0.62],
  [2.5, 'C5', 0.48, 0.59],
  [3, 'G5', 0.95, 0.72],
]);
sing(39, [
  [1, 'Bb4', 1.45, 0.45],
  [2.5, 'Ab4', 0.48, 0.42],
  [3, 'G4', 0.95, 0.4],
]);
flow(40, AB_MINOR, 0.38);
sing(40, [
  [1, 'Eb5', 0.95, 0.64],
  [2, 'Cb5', 0.48, 0.6],
  [2.5, 'Bb4', 0.48, 0.56],
  [3, 'Ab4', 0.95, 0.53],
]);
answer(40, 'Gb4', 'F4', 0.4);
flow(41, EB_G, 0.41);
sing(41, [
  [1, 'Bb4', 0.95, 0.62],
  [2, 'Eb5', 0.48, 0.67],
  [2.5, 'G5', 0.48, 0.73],
  [3, 'Bb5', 0.95, 0.77],
]);
answer(41, 'G4', 'Eb5', 0.44);
flow(42, C7_E, 0.43);
sing(42, [
  [1, 'Bb5', 0.48, 0.76],
  [1.5, 'Ab5', 0.48, 0.7],
  [2, 'G5', 0.95, 0.67],
  [3, 'E5', 0.48, 0.63],
  [3.5, 'G5', 0.45, 0.68],
]);
answer(42, 'E5', 'Bb4', 0.44);
flow(43, FM9, 0.43);
sing(43, [
  [1, 'Ab5', 0.95, 0.74],
  [2, 'G5', 0.48, 0.68],
  [2.5, 'F5', 0.48, 0.64],
  [3, 'Eb5', 0.95, 0.61],
]);
answer(43, 'C5', 'Ab4', 0.44);
flow(44, BB7, 0.39);
sing(44, [
  [1, 'D5', 1.45, 0.63],
  [2.5, 'C5', 0.48, 0.58],
  [3, 'Bb4', 0.7, 0.55],
]);
answer(44, 'F4', 'Ab4', 0.4);
flow(45, EB, 0.4);
sing(45, [
  [1, 'Bb4', 0.95, 0.62],
  [2, 'Eb5', 0.48, 0.69],
  [2.5, 'D5', 0.48, 0.63],
  [3, 'F5', 0.48, 0.67],
  [3.5, 'G5', 0.45, 0.71],
]);
answer(45, 'G4', 'Bb4', 0.43);
flow(46, AB_MAJOR, 0.4);
sing(46, [
  [1, 'G5', 1.45, 0.7],
  [2.5, 'Eb5', 0.48, 0.63],
  [3, 'C5', 0.95, 0.59],
]);
answer(46, 'C5', 'G4', 0.42);
flow(47, ['Cb3', 'Eb3', 'Ab3', 'Cb4', 'Ab3', 'Eb3'], 0.38);
sing(47, [
  [1, 'Cb5', 0.95, 0.6],
  [2, 'Bb4', 0.48, 0.55],
  [2.5, 'Ab4', 0.48, 0.53],
  [3, 'F5', 0.95, 0.64],
]);
n(47, 1, 'F4', 2.9, 0.4, 'treble');
flow(48, ['Bb2', 'F3', 'Ab3', 'Eb4', 'D4', 'F3'], 0.36);
sing(48, [
  [1, 'Eb5', 0.95, 0.61],
  [2, 'D5', 0.95, 0.56],
  [3, 'Bb4', 0.7, 0.52],
]);

// Bars 49–54: major to minor subdominant; the arpeggio gradually falls still.
flow(49, AB_MAJOR, 0.34);
sing(49, [
  [1, 'C5', 1.45, 0.58],
  [2.5, 'Eb5', 0.48, 0.62],
  [3, 'D5', 0.48, 0.55],
  [3.5, 'Bb4', 0.45, 0.51],
]);
answer(49, 'G4', 'Ab4', 0.37);
flow(50, ['Ab2', 'Eb3', 'Cb4', 'F4', 'Cb4', 'Eb3'], 0.32);
sing(50, [
  [1, 'Cb5', 1.45, 0.55],
  [2.5, 'Bb4', 0.48, 0.5],
  [3, 'Ab4', 0.7, 0.47],
]);
n(51, 1, 'G2', 2.9, 0.32, 'bass');
n(51, 1.5, 'Bb2', 0.95, 0.27, 'bass');
n(51, 2.5, ['Eb3', 'G3'], 1.4, 0.29, 'bass');
sing(51, [
  [1, 'G4', 0.95, 0.49],
  [2, 'Bb4', 0.48, 0.53],
  [2.5, 'Eb5', 0.48, 0.58],
  [3, 'G5', 0.95, 0.61],
]);
n(52, 1, 'Bb2', 2.9, 0.3, 'bass');
n(52, 1.5, 'F3', 0.95, 0.26, 'bass');
n(52, 2.5, ['Ab3', 'C4'], 1.4, 0.28, 'bass');
sing(52, [
  [1, 'F5', 0.95, 0.55],
  [2, 'Eb5', 0.48, 0.51],
  [2.5, 'D5', 0.48, 0.47],
  [3, 'Bb4', 0.7, 0.44],
]);
n(53, 1, 'Eb2', 3, 0.29, 'bass');
n(53, 1.5, 'Bb2', 2.5, 0.25, 'bass');
n(53, 2, ['Eb3', 'G3'], 2, 0.27, 'bass');
sing(53, [
  [1, 'G4', 1.45, 0.45],
  [2.5, 'Bb4', 0.48, 0.48],
  [3, 'Eb5', 0.95, 0.52],
]);
// The last ninth resolves downward; the soft middle voices remain held.
n(54, 1, ['Eb2', 'Bb2'], 3, 0.26, 'bass');
n(54, 1.5, ['G3', 'Bb3'], 2.5, 0.27, 'bass');
n(54, 1, ['G4', 'Bb4'], 3, 0.34, 'treble');
sing(54, [
  [1, 'F5', 0.95, 0.45],
  [2, 'Eb5', 2, 0.4],
]);

export const WHERE_STARLIGHT_LINGERS: LibraryTrackDef = {
  trackId: 'where-starlight-lingers',
  title: 'Where Starlight Lingers',
  composer: 'GPT-6 Astra Ultra',
  folder: 'originals',
  descriptionKey: 'whereStarlightLingers',
  bpm: 76,
  timeSignature: { numerator: 3, denominator: 4 },
  quantization: '1/16',
  pedal: 'bar',
  tempoChanges: [
    [12, 82], // Bar 5: cantabile, the first complete phrase.
    [47, 76], // Last beat of bar 16: a small breath.
    [48, 86], // Bar 17: the ornamented thought moves forward.
    [71, 80], // Last beat of bar 24: make room for the minor turn.
    [72, 90], // Bar 25: a more urgent, searching middle.
    [96, 94], // Bar 33: open out into the climax.
    [107, 78], // Last beat of bar 36: release before the return.
    [108, 82], // Bar 37: the original pulse, with greater tenderness.
    [143, 74], // Last beat of bar 48: the farewell begins.
    [144, 72], // Bar 49: the coda.
    [150, 66], // Bar 51: the accompaniment loosens into held tones.
    [156, 60], // Bar 53: let the final tonic arrive without hurry.
    [159, 52], // Bar 54: the last suspension and its resolution.
  ],
  events,
};
