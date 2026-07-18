import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "A Beautiful Day" — original composition by Claude Fable 5 for PoKeyBoard.
 *
 * C major, 4/4 at 92 bpm, ~95 seconds. Intro(2) A(8) A'(8) B(8) A''(8)
 * Coda(2). Written to sit entirely inside the default visible keyboard
 * range (C3–B5) so every highlighted key is on screen for beginners.
 */

const events: TrackEvent[] = [];

/** One note at bar/beat (both 1-based); duration in beats. */
function n(bar: number, beat: number, note: string | string[], dur: number, vel: number): void {
  events.push([(bar - 1) * 4 + (beat - 1), note, dur, vel]);
}

/** Left hand: four gentle quarter notes. */
function lhQ(bar: number, notes: [string, string, string, string], soft = 0): void {
  const vels = [0.5 - soft, 0.44 - soft, 0.47 - soft, 0.42 - soft];
  notes.forEach((name, i) => n(bar, i + 1, name, 0.95, vels[i] as number));
}

/** Left hand: flowing eighth notes (B section and final verse). */
function lh8(bar: number, notes: [string, string, string, string], base = 0.48): void {
  const pattern = [notes[0], notes[1], notes[2], notes[1], notes[3], notes[1], notes[2], notes[1]];
  pattern.forEach((name, i) => {
    n(bar, 1 + i * 0.5, name, 0.45, i % 2 === 0 ? base : base - 0.07);
  });
}

const C: [string, string, string, string] = ['C3', 'G3', 'E4', 'G3'];
const Gd: [string, string, string, string] = ['D3', 'G3', 'B3', 'G3'];
const Am: [string, string, string, string] = ['A3', 'E4', 'C4', 'E4'];
const F: [string, string, string, string] = ['F3', 'C4', 'A3', 'C4'];
// lh8 draws [root, pulse, color, top]: root–pulse–color–pulse–top–pulse–color–pulse.
const C8: [string, string, string, string] = ['C3', 'G3', 'E4', 'C4'];
const Gd8: [string, string, string, string] = ['D3', 'G3', 'B3', 'G3'];
const Am8: [string, string, string, string] = ['A3', 'E4', 'C4', 'A3'];
const F8: [string, string, string, string] = ['F3', 'C4', 'A3', 'F3'];
const Dm78: [string, string, string, string] = ['D3', 'A3', 'C4', 'D3'];
const G8: [string, string, string, string] = ['G3', 'D4', 'B3', 'G3'];

// ---- Intro: two bars of morning light -----------------------------------
n(1, 1, 'C3', 4, 0.5);
n(1, 2, 'G3', 3, 0.44);
n(1, 3, 'E4', 2, 0.46);
n(1, 3, 'G4', 1, 0.52);
n(1, 4, 'C5', 1, 0.56);
n(2, 1, 'D3', 4, 0.48);
n(2, 2, 'G3', 3, 0.43);
n(2, 3, 'B3', 2, 0.45);
n(2, 3, 'A4', 1, 0.52);
n(2, 4, 'G4', 1, 0.48);

// ---- A: the tune, simply ------------------------------------------------
lhQ(3, C);
n(3, 1, 'E4', 0.95, 0.62);
n(3, 2, 'G4', 0.95, 0.66);
n(3, 3, 'A4', 0.95, 0.7);
n(3, 4, 'G4', 0.9, 0.65);
lhQ(4, Gd);
n(4, 1, 'F4', 0.95, 0.66);
n(4, 2, 'E4', 0.95, 0.62);
n(4, 3, 'D4', 2, 0.6);
lhQ(5, Am);
n(5, 1, 'C4', 0.95, 0.6);
n(5, 2, 'E4', 0.95, 0.65);
n(5, 3, 'A4', 0.95, 0.71);
n(5, 4, 'G4', 0.9, 0.66);
lhQ(6, F);
n(6, 1, 'F4', 0.95, 0.67);
n(6, 2, 'A4', 0.95, 0.71);
n(6, 3, 'G4', 2, 0.66);
lhQ(7, C);
n(7, 1, 'E4', 0.95, 0.63);
n(7, 2, 'G4', 0.95, 0.67);
n(7, 3, 'C5', 2, 0.73);
lhQ(8, Gd);
n(8, 1, 'B4', 0.95, 0.7);
n(8, 2, 'A4', 0.95, 0.66);
n(8, 3, 'G4', 2, 0.63);
n(9, 1, 'F3', 0.95, 0.5);
n(9, 2, 'C4', 0.95, 0.44);
n(9, 3, 'D3', 0.95, 0.49);
n(9, 4, 'B3', 0.9, 0.43);
n(9, 1, 'A4', 0.95, 0.66);
n(9, 2, 'F4', 0.95, 0.62);
n(9, 3, 'G4', 0.95, 0.66);
n(9, 4, 'B4', 0.9, 0.71);
lhQ(10, C);
n(10, 1, 'C5', 2.5, 0.72);
n(10, 4, 'G4', 1, 0.6);

// ---- A': the tune again, reaching higher --------------------------------
lhQ(11, C);
n(11, 1, 'E4', 0.95, 0.64);
n(11, 2, 'G4', 0.95, 0.68);
n(11, 3, 'A4', 0.95, 0.72);
n(11, 4, 'G4', 0.9, 0.67);
lhQ(12, Gd);
n(12, 1, 'F4', 0.95, 0.68);
n(12, 2, 'G4', 0.95, 0.7);
n(12, 3, 'B4', 2, 0.72);
lhQ(13, Am);
n(13, 1, 'C5', 0.95, 0.74);
n(13, 2, 'B4', 0.95, 0.7);
n(13, 3, 'A4', 0.95, 0.68);
n(13, 4, 'E4', 0.9, 0.62);
lhQ(14, F);
n(14, 1, 'F4', 0.95, 0.64);
n(14, 2, 'A4', 0.95, 0.7);
n(14, 3, 'C5', 2, 0.74);
lhQ(15, C);
n(15, 1, 'E5', 0.95, 0.78);
n(15, 2, 'D5', 0.95, 0.73);
n(15, 3, 'C5', 0.95, 0.7);
n(15, 4, 'G4', 0.9, 0.66);
lhQ(16, Gd);
n(16, 1, 'A4', 0.95, 0.68);
n(16, 2, 'B4', 0.95, 0.71);
n(16, 3, 'D5', 2, 0.75);
n(17, 1, 'F3', 0.95, 0.5);
n(17, 2, 'C4', 0.95, 0.44);
n(17, 3, 'D3', 0.95, 0.49);
n(17, 4, 'B3', 0.9, 0.43);
n(17, 1, 'C5', 0.95, 0.73);
n(17, 2, 'A4', 0.95, 0.68);
n(17, 3, 'B4', 0.95, 0.7);
n(17, 4, 'D5', 0.9, 0.74);
lhQ(18, C);
n(18, 1, 'E5', 3, 0.78);
n(18, 4, 'D5', 1, 0.68);

// ---- B: lift, swell, and the high point ---------------------------------
lh8(19, Am8);
n(19, 1, 'A4', 1.5, 0.7);
n(19, 2.5, 'C5', 0.5, 0.72);
n(19, 3, 'B4', 1, 0.69);
n(19, 4, 'A4', 1, 0.66);
lh8(20, F8);
n(20, 1, 'A4', 1.5, 0.68);
n(20, 2.5, 'C5', 0.5, 0.73);
n(20, 3, 'D5', 2, 0.75);
lh8(21, C8);
n(21, 1, 'E5', 1.5, 0.77);
n(21, 2.5, 'D5', 0.5, 0.71);
n(21, 3, 'C5', 1, 0.7);
n(21, 4, 'B4', 1, 0.68);
lh8(22, Gd8);
n(22, 1, 'B4', 2, 0.69);
n(22, 3, 'D5', 2, 0.74);
lh8(23, Am8);
n(23, 1, 'C5', 1.5, 0.74);
n(23, 2.5, 'E5', 0.5, 0.78);
n(23, 3, 'D5', 1, 0.73);
n(23, 4, 'C5', 1, 0.7);
lh8(24, F8);
n(24, 1, 'D5', 1.5, 0.76);
n(24, 2.5, 'F5', 0.5, 0.8);
n(24, 3, 'E5', 2, 0.78);
lh8(25, Dm78, 0.5);
n(25, 1, 'F5', 1, 0.8);
n(25, 2, 'G5', 1, 0.84);
n(25, 3, 'A5', 2, 0.86);
lh8(26, G8, 0.5);
n(26, 1, 'G5', 2, 0.8);
n(26, 3, 'D5', 1, 0.72);
n(26, 4, 'B4', 1, 0.66);

// ---- A'': the tune, fuller, coming home ---------------------------------
lh8(27, C8);
n(27, 1, 'E4', 0.95, 0.66);
n(27, 2, 'G4', 0.95, 0.7);
n(27, 3, 'A4', 0.95, 0.73);
n(27, 4, 'G4', 0.9, 0.68);
lh8(28, Gd8);
n(28, 1, 'F4', 0.95, 0.68);
n(28, 2, 'E4', 0.95, 0.64);
n(28, 3, 'D4', 2, 0.62);
lh8(29, Am8);
n(29, 1, 'C4', 0.95, 0.62);
n(29, 2, 'E4', 0.95, 0.67);
n(29, 3, 'A4', 0.95, 0.72);
n(29, 4, 'G4', 0.9, 0.67);
lh8(30, F8);
n(30, 1, 'F4', 0.95, 0.68);
n(30, 2, 'A4', 0.95, 0.72);
n(30, 3, 'C5', 2, 0.74);
lh8(31, C8);
n(31, 1, 'E4', 0.95, 0.65);
n(31, 2, 'G4', 0.95, 0.69);
n(31, 3, 'C5', 2, 0.75);
lh8(32, Gd8);
n(32, 1, 'B4', 0.95, 0.71);
n(32, 2, 'A4', 0.95, 0.67);
n(32, 3, 'G4', 2, 0.64);
n(33, 1, 'F3', 0.45, 0.5);
n(33, 1.5, 'C4', 0.45, 0.42);
n(33, 2, 'A3', 0.45, 0.46);
n(33, 2.5, 'C4', 0.45, 0.42);
n(33, 3, 'G3', 0.45, 0.5);
n(33, 3.5, 'D4', 0.45, 0.42);
n(33, 4, 'B3', 0.45, 0.46);
n(33, 4.5, 'D4', 0.45, 0.42);
n(33, 1, 'F4', 0.95, 0.66);
n(33, 2, 'A4', 0.95, 0.7);
n(33, 3, 'B4', 0.95, 0.72);
n(33, 4, 'D5', 0.9, 0.75);
lhQ(34, C);
n(34, 1, 'C5', 4, 0.74);

// ---- Coda: the day settles ----------------------------------------------
lhQ(35, F, 0.04);
n(35, 1, 'E5', 1, 0.66);
n(35, 2, 'C5', 1, 0.62);
n(35, 3, 'G4', 2, 0.58);
n(36, 1, ['C3', 'G3'], 6, 0.48);
n(36, 1, ['E4', 'G4', 'C5'], 6, 0.58);

export const A_BEAUTIFUL_DAY: LibraryTrackDef = {
  trackId: 'a-beautiful-day',
  title: 'A Beautiful Day',
  composer: 'Claude Fable 5',
  descriptionKey: 'aBeautifulDay',
  bpm: 92,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/8',
  pedal: 'bar',
  events,
};
