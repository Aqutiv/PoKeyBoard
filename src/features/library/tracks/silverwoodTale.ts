import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "The Silverwood Tale" — original composition by Claude Opus 5.5 for
 * PoKeyBoard: a fairy tale told at the piano.
 *
 * D minor into F major, 6/8, 59 bars, about 2:04, in seven scenes:
 *
 *   1–6    Once upon a time. A music box turns over a low open fifth, and
 *          bells high above it ring the opening of the tale's tune.
 *   7–22   The Wanderer. The tune itself, a ballad in two verses over a
 *          rocking left hand; the second verse gains an alto beneath it.
 *   23–30  Into the Silverwood. The tune's first two bars travel down a
 *          chain of chords, D, G, C and F, each answered on the major chord
 *          a third below, where the tune's middle note becomes the raised
 *          fourth — the Lydian colour that makes the wood shine. Fireflies
 *          blink in the top octave.
 *   31–36  The sleeping dragon. A low ostinato breathes under the tune, now
 *          small and dark; it stirs, rises, and roars on a diminished
 *          seventh.
 *   37–40  The old song. The wanderer sings the first two bars alone, the
 *          music box answers, and a sweep up the keyboard breaks the spell.
 *   41–52  Flight at dawn. The tune in F major, in octaves over a galloping
 *          left hand, climbs above the clouds and lands by way of D flat.
 *   53–59  And the tale is told still. The music box again, in F now,
 *          winding down through D flat and B flat minor to F with a ninth.
 *
 * The notation reads one key from the pitches (one flat) and spells
 * everything else towards the flat side, so every colour here comes from
 * that side — B natural, E flat, A flat, D flat — and nothing needs an F
 * sharp or a C sharp to be read the way it was meant.
 *
 * One harmony to a bar, so the bar-long pedal never blurs two chords. The
 * tempo map tells the story: the music box at 72, the ballad at 96, the
 * dragon pushing to 116, the last bell at 48.
 */

const events: TrackEvent[] = [];

type Staff = 'treble' | 'bass';

/**
 * How early, in eighths, every note lets go of its written length. The pedal
 * goes down on each bar line, and a note released right on one would be
 * caught by it and ring through the whole of the next bar.
 */
const RELEASE = 0.05;

/** One note or chord at bar/eighth (both 1-based); duration in eighths. */
function n(
  bar: number,
  eighth: number,
  note: string | string[],
  eighths: number,
  velocity: number,
  staff: Staff,
): void {
  events.push([(bar - 1) * 6 + (eighth - 1), note, eighths - RELEASE, velocity, staff]);
}

type LineNote = readonly [
  eighth: number,
  note: string | string[],
  eighths: number,
  velocity: number,
];

/** A right-hand line. */
function sing(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([eighth, note, eighths, velocity]) =>
    n(bar, eighth, note, eighths, velocity, 'treble'),
  );
}

/** The same note an octave lower: 'Bb5' → 'Bb4'. */
function octaveBelow(note: string): string {
  return note.replace(/\d+$/, (octave) => String(Number(octave) - 1));
}

/** A right-hand line in octaves, the lower note a shade under the tune. */
function octaves(
  bar: number,
  notes: readonly (readonly [eighth: number, note: string, eighths: number, velocity: number])[],
): void {
  notes.forEach(([eighth, note, eighths, velocity]) => {
    n(bar, eighth, note, eighths, velocity, 'treble');
    n(bar, eighth, octaveBelow(note), eighths, velocity - 0.1, 'treble');
  });
}

/** Six notes, one to each eighth of the bar. */
type Six = readonly [string, string, string, string, string, string];

/** Leans on the two dotted-quarter pulses of 6/8 and lets the eighths between fall away. */
const LILT = [0.04, -0.04, -0.02, 0.02, -0.03, -0.05];

/** Left hand: six rocking eighths. */
function rock(bar: number, notes: Six, velocity: number): void {
  notes.forEach((note, i) => n(bar, i + 1, note, 1, velocity + (LILT[i] ?? 0), 'bass'));
}

/** The music box: soft right-hand eighths, fewer than six to trail off. */
function box(bar: number, notes: readonly string[], velocity: number): void {
  notes.forEach((note, i) => n(bar, i + 1, note, 1, velocity + (LILT[i] ?? 0) / 2, 'treble'));
}

/** Two fireflies in the top octave, blinking off the pulse. */
function fireflies(bar: number, first: string, second: string, velocity: number): void {
  n(bar, 2, first, 1, velocity, 'treble');
  n(bar, 5, second, 1, velocity - 0.02, 'treble');
}

/**
 * Lag between the notes of a spread chord, in eighths — about 20 ms at these
 * tempos. A whole spread stays inside a sixteenth, so the score still draws
 * one chord while the ear hears a harp.
 */
const SPREAD = 0.04;

/** A chord spread upward, every note released together; `from` delays the first. */
function spread(
  bar: number,
  notes: readonly string[],
  eighths: number,
  velocity: number,
  staff: Staff,
  from = 0,
): void {
  notes.forEach((note, i) => {
    const lag = (from + i) * SPREAD;
    n(bar, 1 + lag, note, eighths - lag, velocity, staff);
  });
}

/**
 * Left hand at the gallop: a bass on each pulse, a chord after each. `last`
 * replaces the second chord where the tune passes through a note it would
 * rub against.
 */
function gallop(
  bar: number,
  bass: string[],
  fifth: string,
  chord: string[],
  velocity: number,
  last: string[] = chord,
): void {
  n(bar, 1, bass, 2, velocity, 'bass');
  n(bar, 3, chord, 1, velocity - 0.12, 'bass');
  n(bar, 4, fifth, 2, velocity - 0.06, 'bass');
  n(bar, 6, last, 1, velocity - 0.14, 'bass');
}

// ---- 1–6: Once upon a time -------------------------------------------------
// No third at first: D with its fifth and ninth, then B flat with its raised
// fourth. The bells enter at bar 3 with the tune's first two bars.
n(1, 1, ['D2', 'A2'], 6, 0.28, 'bass');
box(1, ['A4', 'D5', 'E5', 'A5', 'E5', 'D5'], 0.3);
n(2, 1, ['Bb1', 'F2'], 6, 0.28, 'bass');
box(2, ['Bb4', 'D5', 'E5', 'A5', 'E5', 'D5'], 0.3);
n(3, 1, ['D2', 'A2'], 6, 0.3, 'bass');
box(3, ['A4', 'D5', 'F5', 'A5', 'F5', 'D5'], 0.3);
sing(3, [
  [1, 'D6', 3, 0.42],
  [4, 'A6', 2, 0.46],
  [6, 'G6', 1, 0.4],
]);
n(4, 1, ['Bb1', 'F2'], 6, 0.3, 'bass');
// A under the bells' E rather than F: a fifth, not a major seventh.
box(4, ['Bb4', 'D5', 'A5', 'F5', 'A5', 'D5'], 0.3);
sing(4, [
  [1, 'F6', 2, 0.44],
  [3, 'E6', 1, 0.4],
  [4, 'D6', 3, 0.42],
]);
n(5, 1, ['G1', 'D2'], 6, 0.3, 'bass');
box(5, ['G4', 'Bb4', 'D5', 'G5', 'D5', 'Bb4'], 0.3);
sing(5, [
  [1, 'G6', 2, 0.44],
  [3, 'F6', 1, 0.4],
  [4, 'D6', 3, 0.42],
]);
n(6, 1, ['C2', 'G2'], 6, 0.3, 'bass');
box(6, ['G4', 'C5', 'E5', 'G5', 'E5'], 0.29);
sing(6, [
  [1, 'E6', 3, 0.4],
  // The storyteller's first word.
  [6, 'A4', 1, 0.5],
]);

// ---- 7–22: The Wanderer ----------------------------------------------------
// Root, fifth, tenth and twelfth, rocking up and back. The ballad runs
// i – VI – III – VII, the old modal way home: C major, never an A major
// with its C sharp.
const DM: Six = ['D2', 'A2', 'F3', 'A3', 'F3', 'A2'];
const BB: Six = ['Bb1', 'F2', 'D3', 'F3', 'D3', 'F2'];
const F: Six = ['F2', 'C3', 'A3', 'C4', 'A3', 'C3'];
const C: Six = ['C2', 'G2', 'E3', 'G3', 'E3', 'G2'];
const GM: Six = ['G2', 'D3', 'Bb3', 'D4', 'Bb3', 'D3'];
/** G major under the second verse: the B natural is D minor's Dorian sixth. */
const G: Six = ['G2', 'D3', 'B3', 'D4', 'B3', 'D3'];

rock(7, DM, 0.36);
sing(7, [
  [1, 'D5', 3, 0.58],
  [4, 'A5', 2, 0.62],
  [6, 'G5', 1, 0.55],
]);
rock(8, BB, 0.36);
sing(8, [
  [1, 'F5', 2, 0.58],
  [3, 'E5', 1, 0.52],
  [4, 'D5', 3, 0.54],
]);
rock(9, F, 0.36);
sing(9, [
  [1, 'C5', 2, 0.54],
  [3, 'D5', 1, 0.52],
  [4, 'F5', 2, 0.58],
  [6, 'A5', 1, 0.6],
]);
rock(10, C, 0.37);
sing(10, [
  [1, 'G5', 2, 0.62],
  [3, 'F5', 1, 0.56],
  [4, 'E5', 3, 0.54],
]);
rock(11, DM, 0.37);
sing(11, [
  [1, 'D5', 3, 0.58],
  [4, 'A5', 2, 0.64],
  [6, 'Bb5', 1, 0.62],
]);
rock(12, GM, 0.38);
sing(12, [
  [1, 'A5', 2, 0.64],
  [3, 'G5', 1, 0.58],
  [4, 'F5', 2, 0.58],
  [6, 'D5', 1, 0.54],
]);
rock(13, BB, 0.38);
sing(13, [
  [1, 'D5', 2, 0.56],
  [3, 'F5', 1, 0.58],
  [4, 'Bb5', 3, 0.66],
]);
rock(14, C, 0.37);
sing(14, [
  [1, 'A5', 2, 0.64],
  [3, 'G5', 1, 0.58],
  [4, 'E5', 2, 0.56],
  [6, 'A4', 1, 0.52],
]);

// Second verse: a touch louder, reaching C6, with an alto below from bar 17.

/** The alto: held chord tones well under the tune. */
function alto(
  bar: number,
  velocity: number,
  notes: readonly (readonly [eighth: number, note: string | string[], eighths: number])[],
): void {
  notes.forEach(([eighth, note, eighths]) => n(bar, eighth, note, eighths, velocity, 'treble'));
}

rock(15, DM, 0.4);
sing(15, [
  [1, 'D5', 3, 0.6],
  [4, 'A5', 2, 0.66],
  [6, 'G5', 1, 0.6],
]);
rock(16, BB, 0.4);
sing(16, [
  [1, 'F5', 2, 0.62],
  [3, 'E5', 1, 0.56],
  [4, 'D5', 3, 0.58],
]);
rock(17, F, 0.41);
sing(17, [
  [1, 'C5', 2, 0.58],
  [3, 'D5', 1, 0.56],
  [4, 'F5', 2, 0.62],
  [6, 'A5', 1, 0.66],
]);
alto(17, 0.4, [
  [1, 'A4', 3],
  [4, 'C5', 3],
]);
rock(18, C, 0.42);
sing(18, [
  [1, 'C6', 2, 0.72],
  [3, 'Bb5', 1, 0.66],
  [4, 'G5', 3, 0.64],
]);
alto(18, 0.4, [[1, 'E5', 6]]);
rock(19, BB, 0.42);
sing(19, [
  [1, 'Bb5', 2, 0.68],
  [3, 'A5', 1, 0.62],
  [4, 'F5', 3, 0.6],
]);
alto(19, 0.4, [[1, 'D5', 6]]);
rock(20, G, 0.41);
sing(20, [
  [1, 'E5', 2, 0.6],
  [3, 'D5', 1, 0.56],
  [4, 'B4', 2, 0.56],
  [6, 'D5', 1, 0.56],
]);
alto(20, 0.38, [
  [1, 'B4', 3],
  [4, 'G4', 3],
]);
rock(21, C, 0.4);
sing(21, [
  [1, 'G5', 3, 0.6],
  [4, 'E5', 2, 0.56],
  [6, 'C5', 1, 0.52],
]);
alto(21, 0.38, [
  [1, 'C5', 3],
  [4, 'G4', 3],
]);
rock(22, DM, 0.38);
sing(22, [[1, 'D5', 6, 0.54]]);
alto(22, 0.38, [[1, ['F4', 'A4'], 6]]);

// ---- 23–30: Into the Silverwood --------------------------------------------
// The tune's opening pair of bars, four times: on D, G, C and F, each
// answered a major third lower — B flat, E flat, A flat, D flat — where its
// middle note lands on the raised fourth. The minor chords brighten to major
// as the path climbs towards the clearing at bar 29.
const DM7: Six = ['D2', 'A2', 'F3', 'C4', 'F3', 'A2'];
const BB_MAJ7: Six = ['Bb1', 'F2', 'D3', 'A3', 'D3', 'F2'];
const EB_MAJ7: Six = ['Eb2', 'Bb2', 'G3', 'D4', 'G3', 'Bb2'];
const C_ADD9: Six = ['C2', 'G2', 'E3', 'D4', 'E3', 'G2'];
const AB_MAJ7: Six = ['Ab1', 'Eb2', 'C3', 'G3', 'C3', 'Eb2'];
const DB_MAJ7: Six = ['Db2', 'Ab2', 'F3', 'C4', 'F3', 'Ab2'];

rock(23, DM7, 0.3);
sing(23, [
  [1, 'D5', 3, 0.46],
  [4, 'A5', 2, 0.5],
  [6, 'G5', 1, 0.46],
]);
fireflies(23, 'A6', 'E6', 0.3);
rock(24, BB_MAJ7, 0.3);
sing(24, [
  [1, 'F5', 2, 0.48],
  [3, 'E5', 1, 0.46],
  [4, 'D5', 3, 0.46],
]);
fireflies(24, 'A6', 'E6', 0.3);
rock(25, GM, 0.31);
sing(25, [
  [1, 'G4', 3, 0.48],
  [4, 'D5', 2, 0.52],
  [6, 'C5', 1, 0.48],
]);
fireflies(25, 'A6', 'D6', 0.3);
rock(26, EB_MAJ7, 0.31);
sing(26, [
  [1, 'Bb4', 2, 0.5],
  [3, 'A4', 1, 0.48],
  [4, 'G4', 3, 0.48],
]);
fireflies(26, 'G6', 'D6', 0.3);
rock(27, C_ADD9, 0.32);
sing(27, [
  [1, 'C5', 3, 0.52],
  [4, 'G5', 2, 0.56],
  [6, 'F5', 1, 0.52],
]);
fireflies(27, 'G6', 'D6', 0.3);
rock(28, AB_MAJ7, 0.33);
sing(28, [
  [1, 'Eb5', 2, 0.54],
  [3, 'D5', 1, 0.52],
  [4, 'C5', 3, 0.52],
]);
fireflies(28, 'G6', 'C6', 0.31);
rock(29, F, 0.35);
sing(29, [
  [1, 'F5', 3, 0.58],
  [4, 'C6', 2, 0.62],
  [6, 'Bb5', 1, 0.58],
]);
fireflies(29, 'A6', 'G6', 0.32);
rock(30, DB_MAJ7, 0.32);
sing(30, [
  [1, 'Ab5', 2, 0.54],
  [3, 'G5', 1, 0.5],
  [4, 'F5', 3, 0.48],
]);
fireflies(30, 'F6', 'C6', 0.3);

// ---- 31–36: The sleeping dragon --------------------------------------------
// A low D that never moves, and above it the dragon's breath: D minor, then
// E flat over D (the Phrygian half step), then diminished. The tune creeps
// through it an octave down, and the dragon wakes.
const DRAGON: Six = ['D2', 'A2', 'D3', 'F3', 'D3', 'A2'];
const DRAGON_EB: Six = ['D2', 'Bb2', 'Eb3', 'G3', 'Eb3', 'Bb2'];
const DRAGON_DIM: Six = ['D2', 'Ab2', 'D3', 'F3', 'D3', 'Ab2'];
const DRAGON_ROAR: Six = ['D2', 'Ab2', 'B2', 'F3', 'B2', 'Ab2'];

/** The dragon's bar: D1 held under its breathing, a shade quieter than it. */
function breathe(bar: number, figure: Six, velocity: number): void {
  n(bar, 1, 'D1', 6, velocity - 0.06, 'bass');
  rock(bar, figure, velocity);
}

breathe(31, DRAGON, 0.36);
sing(31, [
  [1, 'D4', 3, 0.5],
  [4, 'A4', 2, 0.54],
  [6, 'G4', 1, 0.48],
]);
breathe(32, DRAGON_EB, 0.37);
sing(32, [
  [1, 'F4', 2, 0.52],
  [3, 'Eb4', 1, 0.48],
  [4, 'D4', 3, 0.5],
]);
breathe(33, DRAGON, 0.39);
sing(33, [
  [1, 'F4', 3, 0.54],
  [4, 'C5', 2, 0.58],
  [6, 'Bb4', 1, 0.54],
]);
breathe(34, DRAGON_DIM, 0.42);
sing(34, [
  [1, 'Ab4', 2, 0.58],
  [3, 'G4', 1, 0.54],
  [4, 'F4', 3, 0.56],
]);
breathe(35, DRAGON_EB, 0.56);
sing(35, [
  [1, ['Eb4', 'G4', 'Bb4'], 3, 0.7],
  [4, ['G4', 'Bb4', 'Eb5'], 3, 0.74],
]);
// The roar: B diminished seventh over the D.
breathe(36, DRAGON_ROAR, 0.66);
sing(36, [
  [1, ['Ab4', 'B4', 'D5', 'F5'], 3, 0.84],
  [4, ['B4', 'D5', 'F5', 'Ab5'], 3, 0.9],
]);

// ---- 37–40: The old song ---------------------------------------------------
// The first two bars of the tune, alone over the opening's open fifth, and
// the music box answers from above.
n(37, 1, ['D2', 'A2'], 6, 0.32, 'bass');
sing(37, [
  [1, 'D5', 3, 0.5],
  [4, 'A5', 2, 0.54],
  [6, 'G5', 1, 0.5],
]);
n(38, 1, ['Bb1', 'F2'], 6, 0.34, 'bass');
sing(38, [
  [1, 'F5', 2, 0.52],
  [3, 'E5', 1, 0.48],
  [4, 'D5', 3, 0.5],
]);
box(38, ['Bb5', 'D6', 'E6', 'A6', 'E6', 'D6'], 0.3);
// The spell breaks: C with its fourth, swept up four octaves in sixteenths...
n(39, 1, ['C2', 'G2'], 6, 0.44, 'bass');
['C3', 'F3', 'G3', 'C4', 'F4', 'G4', 'C5', 'F5', 'G5', 'C6', 'F6', 'G6'].forEach((note, i) =>
  n(39, 1 + i / 2, note, 0.5, 0.36 + i * 0.03, i < 3 ? 'bass' : 'treble'),
);
// ...and the fourth falls to the third: C7, spread like a harp and left to
// the pedal while the tune's first note is picked up.
n(40, 1, ['C1', 'C2'], 6, 0.62, 'bass');
n(40, 1, ['G2', 'E3', 'Bb3'], 6, 0.5, 'bass');
spread(40, ['E5', 'G5', 'Bb5', 'C6', 'E6'], 3, 0.76, 'treble');
n(40, 6, ['C4', 'C5'], 1, 0.7, 'treble');

// ---- 41–52: Flight at dawn -------------------------------------------------
// The second verse again, a third higher in F major: the same steps of the
// scale, so the tune is unmistakably itself, now bright. The tune's passing
// B flat gets a bare fifth under it rather than the A it would grind on.
const F_BARE = ['F3', 'C4'];
gallop(41, ['F1', 'F2'], 'C2', ['F3', 'A3', 'C4'], 0.62, F_BARE);
octaves(41, [
  [1, 'F5', 3, 0.84],
  [4, 'C6', 2, 0.86],
  [6, 'Bb5', 1, 0.8],
]);
gallop(42, ['D2', 'D3'], 'A2', ['F3', 'A3', 'D4'], 0.62);
octaves(42, [
  [1, 'A5', 2, 0.84],
  [3, 'G5', 1, 0.8],
  [4, 'F5', 3, 0.8],
]);
// G where the verse had a passing step: A minor seventh, nothing to grind.
gallop(43, ['A1', 'A2'], 'E2', ['E3', 'A3', 'C4'], 0.62);
octaves(43, [
  [1, 'E5', 2, 0.8],
  [3, 'G5', 1, 0.78],
  [4, 'A5', 2, 0.84],
  [6, 'C6', 1, 0.86],
]);
gallop(44, ['C2', 'C3'], 'G2', ['E3', 'G3', 'Bb3'], 0.66);
octaves(44, [
  [1, 'E6', 2, 0.92],
  [3, 'D6', 1, 0.86],
  [4, 'Bb5', 3, 0.86],
]);
// C7 to D minor: the deceptive step, at the height of the verse.
gallop(45, ['D2', 'D3'], 'A2', ['F3', 'A3', 'D4'], 0.64);
octaves(45, [
  [1, 'D6', 2, 0.9],
  [3, 'C6', 1, 0.84],
  [4, 'A5', 3, 0.84],
]);
gallop(46, ['G1', 'G2'], 'D2', ['F3', 'Bb3', 'D4'], 0.62);
octaves(46, [
  [1, 'G5', 2, 0.82],
  [3, 'F5', 1, 0.78],
  [4, 'D5', 2, 0.78],
  [6, 'F5', 1, 0.8],
]);
gallop(47, ['C2', 'C3'], 'G2', ['E3', 'G3', 'Bb3'], 0.64);
octaves(47, [
  [1, 'Bb5', 3, 0.84],
  [4, 'G5', 2, 0.8],
  [6, 'E5', 1, 0.78],
]);
gallop(48, ['F1', 'F2'], 'C2', ['F3', 'A3', 'C4'], 0.62);
octaves(48, [[1, 'F5', 3, 0.82]]);
sing(48, [
  [4, 'A5', 1, 0.74],
  [5, 'C6', 1, 0.78],
  [6, 'E6', 1, 0.82],
]);
// Above the clouds: the opening again, an octave up, then its answer over
// D flat, the flat sixth, with G as the raised fourth once more.
gallop(49, ['F1', 'F2'], 'C2', ['F3', 'A3', 'C4'], 0.66, F_BARE);
octaves(49, [
  [1, 'F6', 3, 0.88],
  [4, 'C7', 2, 0.9],
  [6, 'Bb6', 1, 0.84],
]);
gallop(50, ['Db2', 'Db3'], 'Ab2', ['F3', 'Ab3', 'Db4'], 0.66);
octaves(50, [
  [1, 'Ab6', 2, 0.88],
  // Lighter: it rings on against the A flat above it.
  [3, 'G6', 1, 0.78],
  [4, 'F6', 3, 0.86],
]);
// Down through C7 to land.
gallop(51, ['C2', 'C3'], 'G2', ['E3', 'G3', 'Bb3'], 0.66);
sing(51, [
  [1, 'C7', 1, 0.86],
  [2, 'Bb6', 1, 0.8],
  [3, 'G6', 1, 0.78],
  [4, 'E6', 1, 0.8],
  [5, 'C6', 1, 0.76],
  [6, 'Bb5', 1, 0.74],
]);
// Held past the bar line, so it is still ringing as the music box returns.
n(52, 1, ['F1', 'F2'], 9, 0.7, 'bass');
n(52, 1, ['C3', 'F3', 'A3'], 9, 0.58, 'bass');
sing(52, [[1, ['F5', 'A5', 'C6', 'F6'], 9, 0.84]]);

// ---- 53–59: And the tale is told still -------------------------------------
// The opening's music box in F, the bells on the tune's first two bars. Then
// C7 slips up to D flat, B flat minor turns it wistful, and F arrives with
// its ninth — the book closing.
n(53, 1, ['F2', 'C3'], 6, 0.3, 'bass');
box(53, ['C5', 'F5', 'G5', 'C6', 'G5', 'F5'], 0.3);
sing(53, [
  [1, 'F6', 3, 0.42],
  [4, 'C7', 2, 0.44],
  [6, 'Bb6', 1, 0.4],
]);
n(54, 1, ['Bb1', 'F2'], 6, 0.3, 'bass');
box(54, ['Bb4', 'D5', 'F5', 'A5', 'F5', 'D5'], 0.29);
sing(54, [
  [1, 'A6', 2, 0.42],
  [3, 'G6', 1, 0.38],
  [4, 'F6', 3, 0.4],
]);
n(55, 1, ['G1', 'D2'], 6, 0.28, 'bass');
box(55, ['G4', 'Bb4', 'D5', 'F5', 'D5', 'Bb4'], 0.28);
sing(55, [
  [1, 'Bb6', 2, 0.4],
  [3, 'A6', 1, 0.36],
  [4, 'F6', 3, 0.38],
]);
n(56, 1, ['C2', 'G2'], 6, 0.28, 'bass');
box(56, ['G4', 'Bb4', 'E5', 'G5', 'E5', 'Bb4'], 0.27);
sing(56, [
  [1, 'G6', 3, 0.38],
  [4, 'E6', 3, 0.36],
]);
// The music box's first figure, transposed to D flat.
n(57, 1, ['Db2', 'Ab2'], 6, 0.28, 'bass');
box(57, ['Ab4', 'Db5', 'Eb5', 'Ab5', 'Eb5', 'Db5'], 0.27);
sing(57, [
  [1, 'Ab6', 3, 0.38],
  [4, 'F6', 3, 0.36],
]);
n(58, 1, ['Bb1', 'F2'], 6, 0.26, 'bass');
box(58, ['G4', 'Bb4', 'Db5', 'F5', 'Db5', 'Bb4'], 0.26);
sing(58, [[1, 'G6', 6, 0.36]]);
// The bell rises G to A as B flat minor gives way to F. Softer than the
// music box before it: eight notes at once carry more than one or two.
n(59, 1, ['F1', 'C3', 'A3'], 9, 0.22, 'bass');
spread(59, ['G4', 'C5', 'F5', 'A5'], 9, 0.24, 'treble', 1);
spread(59, ['A6'], 9, 0.3, 'treble', 5);

export const SILVERWOOD_TALE: LibraryTrackDef = {
  trackId: 'silverwood-tale',
  title: 'The Silverwood Tale',
  composer: 'Claude Opus 5.5',
  folder: 'originals',
  descriptionKey: 'silverwoodTale',
  bpm: 72,
  timeSignature: { numerator: 6, denominator: 8 },
  // Beats are eighths, so bar b starts on beat 6(b − 1).
  tempoChanges: [
    [30, 64], // Bar 6: the music box slows before the tale begins.
    [36, 96], // Bar 7: the Wanderer's ballad.
    [126, 88], // Bar 22: the verse settles.
    [132, 84], // Bar 23: into the Silverwood.
    [168, 88], // Bar 29: the clearing.
    [174, 80], // Bar 30: the light dims.
    [180, 100], // Bar 31: the sleeping dragon.
    [204, 108], // Bar 35: it stirs.
    [210, 116], // Bar 36: it roars.
    [216, 84], // Bar 37: the old song.
    [228, 76], // Bar 39: the spell breaks.
    [234, 56], // Bar 40: broadly, as the light arrives.
    [240, 108], // Bar 41: flight at dawn.
    [300, 100], // Bar 51: the descent.
    [306, 92], // Bar 52: landing.
    [312, 84], // Bar 53: the music box again.
    [324, 76], // Bar 55: winding down.
    [336, 66], // Bar 57: D flat.
    [342, 58], // Bar 58: B flat minor.
    [348, 48], // Bar 59: the last chord.
  ],
  quantization: '1/16',
  pedal: 'bar',
  events,
};
