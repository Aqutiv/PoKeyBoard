import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "The Coming of Winter" — original composition by Claude Fable 5.2 for
 * PoKeyBoard: a ballade in the spirit of Chopin.
 *
 * F minor, 6/8, 84 bars, about 3:05. Everything grows from five notes that
 * have the rhythm of the words "winter is coming": three rising steps, a leap
 * of a fourth, and a semitone sigh, D flat falling to C. The sigh never
 * resolves to F until the last bar.
 *
 *   1–8    Largo. The omen, in bare octaves, answered by two still chords
 *          high up: the sigh again, as harmony.
 *   9–24   The theme. The omen opens a song that climbs three times, to a
 *          Neapolitan G flat, over a rocking left hand; then again an octave
 *          higher, ornamented, turning towards A flat major.
 *   25–32  The last warm light. A hymn in A flat, the omen upside down:
 *          three falling steps and a rest. Its last bar is the sigh again.
 *   33–42  The wind rises. The omen is split between tenor and top over a
 *          bass that sinks by semitones from F to C, and the sigh breaks
 *          into gusts; then five bars on the dominant, the bass drumming
 *          the omen's rhythm.
 *   43–49  The storm. The theme in octaves over waves of sixteenths.
 *   50–57  The blizzard. The right hand tumbles down in threes, each a chord
 *          note, the one below, and the step above that; the harmony falls
 *          by fifths from F minor round to its dominant.
 *   58–65  The hymn again, in full chords: first in D flat, then in F minor.
 *          What was warm is the storm's own voice now.
 *   66–69  The omen, squeezed into one bar and climbing: B flat minor, G
 *          seventh, F minor over C, then an augmented sixth on D flat, so
 *          that the bass itself sighs D flat to C.
 *   70–75  A cascade down four octaves over the dominant drum, two hammered
 *          chords, and F minor.
 *   76–84  Snow. The two still chords, single notes drifting down from the
 *          top of the keyboard, and the omen once more over a low F — its
 *          sigh at last going on down to F, on a fifth with no third in it.
 *
 * One harmony to a bar, so the bar-long pedal never blurs two chords: the
 * neighbour notes of the storm ring inside their own chord, as they do under
 * a pianist's foot. Every event names its staff, because both hands roam.
 */

const events: TrackEvent[] = [];

type Staff = 'treble' | 'bass';

/**
 * How early, in eighths, every note lets go of its written length. The pedal
 * goes down on each bar line, and a note released right on one would be
 * caught by it and ring through the whole of the next bar.
 */
const RELEASE = 0.05;

/** Velocities are authored to two places; sums of shadings are trimmed back. */
function trim(velocity: number): number {
  return Math.round(velocity * 100) / 100;
}

/** One note or chord at bar/eighth (both 1-based); duration in eighths. */
function n(
  bar: number,
  eighth: number,
  note: string | string[],
  eighths: number,
  velocity: number,
  staff: Staff,
): void {
  events.push([(bar - 1) * 6 + (eighth - 1), note, eighths - RELEASE, trim(velocity), staff]);
}

type LineNote = readonly [eighth: number, note: string, eighths: number, velocity: number];

/** A right-hand line. */
function sing(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([eighth, note, eighths, velocity]) =>
    n(bar, eighth, note, eighths, velocity, 'treble'),
  );
}

/** A line for the left hand's thumb, above its own bass. */
function tenor(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([eighth, note, eighths, velocity]) =>
    n(bar, eighth, note, eighths, velocity, 'bass'),
  );
}

/** The same note an octave lower: 'Bb5' → 'Bb4'. */
function octaveBelow(note: string): string {
  return note.replace(/\d+$/, (octave) => String(Number(octave) - 1));
}

/** A right-hand line in octaves, the lower note a shade under the upper. */
function octaves(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([eighth, note, eighths, velocity]) => {
    n(bar, eighth, note, eighths, velocity, 'treble');
    n(bar, eighth, octaveBelow(note), eighths, velocity - 0.08, 'treble');
  });
}

/** A line shared by the hands an octave apart, with nothing under it. */
function bare(bar: number, notes: readonly LineNote[]): void {
  notes.forEach(([eighth, note, eighths, velocity]) => {
    n(bar, eighth, note, eighths, velocity, 'treble');
    n(bar, eighth, octaveBelow(note), eighths, velocity - 0.04, 'bass');
  });
}

/** A right-hand chord, low to high, whose top note carries the tune. */
function chord(
  bar: number,
  eighth: number,
  notes: readonly string[],
  eighths: number,
  velocity: number,
): void {
  notes.forEach((note, i) =>
    n(bar, eighth, note, eighths, i === notes.length - 1 ? velocity : velocity - 0.1, 'treble'),
  );
}

/** Six notes, one to each eighth of the bar. */
type Six = readonly [string, string, string, string, string, string];

/** Leans on the two dotted-quarter pulses of 6/8 and lets the eighths between fall away. */
const LILT = [0.04, -0.04, -0.02, 0.02, -0.03, -0.05];

/** Left hand: six rocking eighths. */
function rock(bar: number, notes: Six, velocity: number): void {
  notes.forEach((note, i) => n(bar, i + 1, note, 1, velocity + (LILT[i] ?? 0), 'bass'));
}

/** Left hand, swaying: a bass on the first pulse, a chord on the second. */
function sway(bar: number, bass: string[], upper: string[], velocity: number): void {
  n(bar, 1, bass, 6, velocity, 'bass');
  n(bar, 4, upper, 3, velocity - 0.05, 'bass');
}

/** A run of sixteenths from `eighth`, its loudness moving evenly from `from` to `to`. */
function run(
  bar: number,
  eighth: number,
  notes: readonly string[],
  from: number,
  to: number,
  staff: Staff = 'treble',
): void {
  const last = Math.max(1, notes.length - 1);
  notes.forEach((note, i) =>
    n(bar, eighth + i / 2, note, 0.5, from + ((to - from) * i) / last, staff),
  );
}

/**
 * The blizzard's figure: twelve sixteenths in threes — a chord note, the one
 * below it, and the step above that. The chord notes are leaned on, so the
 * harmony stays in front of the notes between.
 */
function flutter(bar: number, notes: readonly string[], velocity: number): void {
  notes.forEach((note, i) =>
    n(bar, 1 + i / 2, note, 0.5, velocity + (i % 3 === 0 ? 0.06 : -0.06), 'treble'),
  );
}

/** How a left-hand wave swells: struck at the bottom, cresting past the middle. */
const SWELL = [0.14, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.03, 0, -0.03, -0.05];

/** Left hand: twelve sixteenths, up through the chord and back. */
function surge(bar: number, notes: readonly string[], velocity: number): void {
  notes.forEach((note, i) => n(bar, 1 + i / 2, note, 0.5, velocity + (SWELL[i] ?? 0), 'bass'));
}

/**
 * The omen's rhythm as a drum — long, short, long: a low octave twice, then
 * whatever answers it.
 */
function drum(bar: number, low: string[], answer: string[], velocity: number): void {
  n(bar, 1, low, 2, velocity, 'bass');
  n(bar, 3, low, 1, velocity - 0.1, 'bass');
  n(bar, 4, answer, 3, velocity - 0.04, 'bass');
}

/**
 * Left hand under the hymn in the storm: a low octave, four sixteenths swept
 * up from it, and a chord struck twice.
 */
function grand(
  bar: number,
  low: string[],
  sweep: readonly [string, string, string, string],
  upper: string[],
  velocity: number,
): void {
  n(bar, 1, low, 1, velocity, 'bass');
  run(bar, 2, sweep, velocity - 0.3, velocity - 0.2, 'bass');
  n(bar, 4, upper, 2, velocity - 0.2, 'bass');
  n(bar, 6, upper, 1, velocity - 0.26, 'bass');
}

// ---- 1–8: Largo — the omen -------------------------------------------------
// "Win-ter is com-ing": F, G, A flat, up a fourth to D flat, and the sigh down
// to C. Bare octaves, then the sigh alone as two chords, D flat and C, with
// nothing between them and the floor.
bare(1, [
  [1, 'F4', 2, 0.36],
  [3, 'G4', 1, 0.31],
  [4, 'Ab4', 3, 0.38],
]);
bare(2, [
  [1, 'Db5', 3, 0.44],
  [4, 'C5', 3, 0.33],
]);
n(3, 1, ['Db3', 'Ab3'], 6, 0.26, 'bass');
n(3, 1, ['F5', 'Ab5', 'Db6'], 6, 0.32, 'treble');
n(4, 1, ['C3', 'G3'], 6, 0.24, 'bass');
n(4, 1, ['E5', 'G5', 'C6'], 6, 0.3, 'treble');
// The first flake.
n(4, 4, 'C7', 3, 0.34, 'treble');
// Again from C, a fifth higher and note for note the same, over a low fifth:
// its D natural is the one bright step in the whole opening.
n(5, 1, ['C2', 'G2'], 6, 0.28, 'bass');
octaves(5, [
  [1, 'C5', 2, 0.42],
  [3, 'D5', 1, 0.36],
  [4, 'Eb5', 3, 0.44],
]);
n(6, 1, ['C2', 'G2'], 6, 0.3, 'bass');
octaves(6, [
  [1, 'Ab5', 3, 0.5],
  [4, 'G5', 3, 0.38],
]);
// B flat minor to C: the sigh in the top voice is F to E now, a leading note
// left hanging for the theme to answer.
n(7, 1, ['Bb2', 'F3'], 6, 0.27, 'bass');
n(7, 1, ['Bb4', 'Db5', 'F5'], 6, 0.34, 'treble');
n(8, 1, ['C2', 'C3'], 6, 0.3, 'bass');
n(8, 1, ['G4', 'C5', 'E5'], 6, 0.31, 'treble');
n(8, 4, 'G6', 3, 0.32, 'treble');

// ---- 9–24: the theme -------------------------------------------------------
// Root, fifth, tenth and back, the way a nocturne's left hand rocks.
const FM: Six = ['F2', 'C3', 'Ab3', 'C4', 'Ab3', 'C3'];
const C7: Six = ['C2', 'G2', 'E3', 'Bb3', 'E3', 'G2'];
/** C seventh under a tune that ends on E: the left hand leaves that E alone. */
const C7_CLOSE: Six = ['C2', 'G2', 'E3', 'Bb3', 'G3', 'C3'];
const DB: Six = ['Db2', 'Ab2', 'F3', 'Ab3', 'F3', 'Ab2'];
const AB: Six = ['Ab2', 'Eb3', 'C4', 'Eb4', 'C4', 'Eb3'];
const BBM: Six = ['Bb2', 'F3', 'Db4', 'F4', 'Db4', 'F3'];
/** The Neapolitan, G flat major, over the B flat the bass is already on. */
const GB_BB: Six = ['Bb2', 'Gb3', 'Db4', 'Gb4', 'Db4', 'Gb3'];
const EB7: Six = ['Eb2', 'Bb2', 'G3', 'Db4', 'G3', 'Bb2'];
const BBM_LOW: Six = ['Bb1', 'F2', 'Db3', 'F3', 'Db3', 'F2'];

// Three waves, each the omen's shape a third higher: F to D flat, A flat to
// F, D flat to the B flat at the top, where the harmony turns Neapolitan. Then
// down the dominant seventh, home.
rock(9, FM, 0.36);
sing(9, [
  [1, 'F4', 2, 0.56],
  [3, 'G4', 1, 0.5],
  [4, 'Ab4', 3, 0.58],
]);
// D flat over C seventh: the sigh is the dominant's minor ninth.
rock(10, C7, 0.36);
sing(10, [
  [1, 'Db5', 3, 0.64],
  [4, 'C5', 3, 0.54],
]);
rock(11, DB, 0.37);
sing(11, [
  [1, 'Ab4', 2, 0.56],
  [3, 'Bb4', 1, 0.52],
  [4, 'Db5', 3, 0.6],
]);
rock(12, AB, 0.38);
sing(12, [
  [1, 'F5', 3, 0.66],
  [4, 'Eb5', 3, 0.56],
]);
rock(13, BBM, 0.39);
sing(13, [
  [1, 'Db5', 2, 0.6],
  [3, 'Eb5', 1, 0.56],
  [4, 'F5', 3, 0.64],
]);
rock(14, GB_BB, 0.41);
sing(14, [
  [1, 'Bb5', 3, 0.72],
  [4, 'Ab5', 1, 0.62],
  [5, 'Gb5', 1, 0.6],
  [6, 'Db5', 1, 0.56],
]);
rock(15, C7_CLOSE, 0.38);
sing(15, [
  [1, 'C5', 2, 0.58],
  [3, 'Bb4', 1, 0.52],
  [4, 'G4', 2, 0.52],
  [6, 'E4', 1, 0.5],
]);
rock(16, FM, 0.35);
sing(16, [
  [1, 'F4', 4, 0.54],
  // Up the chord, to begin again an octave higher.
  [5, 'Ab4', 1, 0.46],
  [6, 'C5', 1, 0.5],
]);

// Again, an octave up and a shade louder. A written-out turn leads into the
// sigh, and where the first time went to the Neapolitan this one goes to E
// flat seventh, and so to A flat major.
rock(17, FM, 0.39);
sing(17, [
  [1, 'F5', 2, 0.64],
  [3, 'G5', 1, 0.58],
  [4, 'Ab5', 1, 0.62],
  [5, 'Bb5', 0.5, 0.54],
  [5.5, 'Ab5', 0.5, 0.52],
  [6, 'G5', 0.5, 0.52],
  [6.5, 'Ab5', 0.5, 0.56],
]);
rock(18, C7, 0.38);
sing(18, [
  [1, 'Db6', 3, 0.8],
  [4, 'C6', 3, 0.7],
]);
rock(19, DB, 0.38);
sing(19, [
  [1, 'Ab5', 2, 0.7],
  [3, 'Bb5', 1, 0.66],
  [4, 'Db6', 3, 0.76],
]);
rock(20, AB, 0.39);
sing(20, [
  [1, 'F6', 3, 0.84],
  [4, 'Eb6', 2, 0.72],
  [6, 'C6', 1, 0.66],
]);
rock(21, BBM, 0.4);
sing(21, [
  [1, 'Db6', 2, 0.76],
  [3, 'Eb6', 1, 0.72],
  [4, 'F6', 3, 0.8],
]);
rock(22, EB7, 0.4);
sing(22, [[1, 'Bb6', 3, 0.88]]);
// Down the seventh chord in small notes, the way Chopin lets a long note go.
run(22, 4, ['Ab6', 'G6', 'Eb6', 'Db6', 'Bb5', 'G5'], 0.7, 0.56);
rock(23, AB, 0.37);
sing(23, [
  [1, 'Ab5', 4, 0.68],
  [5, 'G5', 1, 0.56],
  [6, 'F5', 1, 0.56],
]);
// The line keeps walking down, through the seventh of E flat, into the hymn.
rock(24, EB7, 0.34);
sing(24, [
  [1, 'Eb5', 3, 0.52],
  [4, 'Db5', 3, 0.46],
]);

// ---- 25–32: the last warm light --------------------------------------------
// The omen turned over: where it rose three steps and leapt up, the hymn
// falls three steps and drops, and where it sighed down, the hymn steps up.
sway(25, ['Ab2', 'Eb3'], ['C4', 'Eb4'], 0.34);
sing(25, [
  [1, 'C5', 2, 0.56],
  [3, 'Bb4', 1, 0.5],
  [4, 'Ab4', 3, 0.52],
]);
sway(26, ['Db2', 'Ab2'], ['F3', 'Ab3', 'Db4'], 0.34);
sing(26, [
  [1, 'Eb4', 3, 0.5],
  [4, 'F4', 3, 0.52],
]);
sway(27, ['Eb2', 'Bb2'], ['G3', 'Db4', 'Eb4'], 0.34);
sing(27, [
  [1, 'Bb4', 2, 0.54],
  [3, 'Ab4', 1, 0.48],
  [4, 'G4', 3, 0.5],
]);
sway(28, ['Ab2', 'Eb3'], ['C4', 'Eb4', 'Ab4'], 0.34);
sing(28, [
  [1, 'C5', 3, 0.54],
  [4, 'Eb5', 3, 0.58],
]);
// The same three notes over F minor: the light is already going. The left
// hand takes up its rocking again.
rock(29, FM, 0.33);
sing(29, [
  [1, 'C5', 2, 0.56],
  [3, 'Bb4', 1, 0.5],
  [4, 'Ab4', 3, 0.52],
]);
rock(30, DB, 0.33);
sing(30, [
  [1, 'F4', 3, 0.5],
  [4, 'Ab4', 2, 0.52],
  [6, 'Db5', 1, 0.56],
]);
rock(31, BBM_LOW, 0.33);
sing(31, [
  [1, 'Db5', 2, 0.56],
  [3, 'C5', 1, 0.5],
  [4, 'Bb4', 3, 0.5],
]);
// And the hymn is cut off by the sigh, over a low C that drums the omen's
// rhythm for the first time.
drum(32, ['C2'], ['C2', 'G2'], 0.36);
n(32, 1, ['E4', 'G4', 'Bb4'], 6, 0.3, 'treble');
sing(32, [
  [1, 'Db5', 3, 0.5],
  [4, 'C5', 3, 0.4],
]);

// ---- 33–42: the wind rises -------------------------------------------------
// The bass sinks a semitone a bar, F, E, E flat, D, D flat, to C: the old
// lament. The omen is split between two voices: the tenor asks its three
// rising notes, and the sigh answers from the top, where it breaks into a
// gust — a chord note, the one below, and the step above that, falling away.
n(33, 1, 'F2', 6, 0.42, 'bass');
tenor(33, [
  [1, 'F3', 2, 0.52],
  [3, 'G3', 1, 0.46],
  [4, 'Ab3', 3, 0.54],
]);
run(33, 4, ['C6', 'Ab5', 'Bb5', 'Ab5', 'F5', 'G5'], 0.44, 0.34);
// C seventh over its third.
n(34, 1, 'E2', 6, 0.42, 'bass');
n(34, 2, ['G3', 'Bb3', 'C4'], 2, 0.34, 'bass');
sing(34, [[1, 'Db6', 3, 0.58]]);
run(34, 4, ['C6', 'G5', 'Ab5', 'G5', 'E5', 'F5'], 0.46, 0.34);
// A flat over E flat: the omen a third higher, and the gusts fill the bar.
n(35, 1, 'Eb2', 6, 0.44, 'bass');
tenor(35, [
  [2, 'Ab3', 1, 0.54],
  [3, 'Bb3', 1, 0.5],
  [4, 'C4', 3, 0.6],
]);
run(
  35,
  1,
  ['Eb6', 'C6', 'Db6', 'C6', 'Ab5', 'Bb5', 'Ab5', 'Eb5', 'F5', 'Eb5', 'C5', 'Db5'],
  0.44,
  0.36,
);
// G seventh over D, and the sigh in octaves: the leap has widened.
n(36, 1, 'D2', 6, 0.46, 'bass');
n(36, 2, ['F3', 'G3', 'B3'], 2, 0.38, 'bass');
octaves(36, [[1, 'Ab6', 3, 0.7]]);
run(36, 4, ['G6', 'D6', 'Eb6', 'D6', 'B5', 'C6'], 0.6, 0.5);
// D flat with an augmented sixth above it, swept up three octaves. Its B
// wants C, and so does the bass.
n(37, 1, ['Db2', 'Db3'], 2, 0.58, 'bass');
n(37, 3, ['F3', 'Ab3', 'B3'], 1, 0.48, 'bass');
n(37, 4, ['Db2', 'Db3'], 2, 0.62, 'bass');
n(37, 6, ['F3', 'Ab3', 'B3'], 1, 0.52, 'bass');
run(
  37,
  1,
  ['Db4', 'F4', 'Ab4', 'B4', 'Db5', 'F5', 'Ab5', 'B5', 'Db6', 'F6', 'Ab6', 'B6'],
  0.5,
  0.82,
);

// Five bars on C. The bass drums the omen's rhythm; above it the gusts fall
// in sighs — A flat to G, F to E, D flat to C — and climb back up the chord.
drum(38, ['C2', 'C3'], ['G3', 'Bb3', 'E4'], 0.68);
run(38, 1, ['C7', 'Ab6', 'G6', 'F6', 'E6', 'Db6', 'C6', 'B5', 'Bb5', 'Ab5', 'G5', 'E5'], 0.8, 0.6);
// D flat over the C: the sigh as a whole chord leaning on the bass.
drum(39, ['C2', 'C3'], ['Ab3', 'Db4', 'F4'], 0.72);
run(
  39,
  1,
  ['F5', 'Ab5', 'Db6', 'F6', 'Ab6', 'Db7', 'C7', 'Ab6', 'F6', 'Db6', 'Ab5', 'F5'],
  0.62,
  0.7,
);
drum(40, ['C2', 'C3'], ['Bb3', 'E4', 'G4'], 0.76);
run(
  40,
  1,
  ['G5', 'Bb5', 'C6', 'E6', 'G6', 'Bb6', 'Db7', 'C7', 'B6', 'Bb6', 'Ab6', 'G6'],
  0.66,
  0.8,
);
// A diminished seventh over the C.
drum(41, ['C2', 'C3'], ['Ab3', 'B3', 'D4', 'F4'], 0.82);
run(41, 1, ['Ab6', 'F6', 'D6', 'B5', 'Ab5', 'F5', 'Ab5', 'B5', 'D6', 'F6', 'Ab6', 'B6'], 0.8, 0.86);
// Six sighs down two octaves to the leading note, and the drum closes in.
n(42, 1, ['C2', 'C3'], 2, 0.86, 'bass');
n(42, 3, ['C2', 'C3'], 1, 0.8, 'bass');
n(42, 4, ['C2', 'C3'], 1, 0.86, 'bass');
n(42, 5, ['C2', 'C3'], 1, 0.88, 'bass');
n(42, 6, ['E2', 'E3'], 1, 0.92, 'bass');
run(42, 1, ['Db7', 'C7', 'Ab6', 'G6', 'F6', 'E6', 'Db6', 'C6', 'Ab5', 'G5', 'F5', 'E5'], 0.9, 0.8);

// ---- 43–49: the storm ------------------------------------------------------
// The theme, bar for bar as it was first sung, in octaves and chords over
// left-hand waves that start from the bottom of each harmony.
surge(43, ['F1', 'C2', 'F2', 'Ab2', 'C3', 'F3', 'Ab3', 'C4', 'Ab3', 'F3', 'C3', 'Ab2'], 0.6);
octaves(43, [
  [1, 'F5', 2, 0.9],
  [3, 'G5', 1, 0.82],
]);
chord(43, 4, ['Ab4', 'C5', 'Ab5'], 3, 0.92);
surge(44, ['C2', 'G2', 'C3', 'E3', 'G3', 'Bb3', 'C4', 'E4', 'C4', 'Bb3', 'G3', 'E3'], 0.6);
chord(44, 1, ['Db5', 'E5', 'G5', 'Db6'], 3, 0.95);
chord(44, 4, ['C5', 'E5', 'G5', 'C6'], 3, 0.86);
surge(45, ['Db2', 'Ab2', 'Db3', 'F3', 'Ab3', 'Db4', 'F4', 'Db4', 'Ab3', 'F3', 'Db3', 'Ab2'], 0.61);
octaves(45, [
  [1, 'Ab5', 2, 0.88],
  [3, 'Bb5', 1, 0.82],
]);
chord(45, 4, ['Db5', 'F5', 'Db6'], 3, 0.92);
surge(46, ['Ab1', 'Eb2', 'Ab2', 'C3', 'Eb3', 'Ab3', 'C4', 'Eb4', 'C4', 'Ab3', 'Eb3', 'C3'], 0.62);
chord(46, 1, ['F5', 'Ab5', 'C6', 'F6'], 3, 0.96);
chord(46, 4, ['Eb5', 'Ab5', 'C6', 'Eb6'], 3, 0.88);
surge(47, ['Bb1', 'F2', 'Bb2', 'Db3', 'F3', 'Bb3', 'Db4', 'F4', 'Db4', 'Bb3', 'F3', 'Db3'], 0.63);
octaves(47, [
  [1, 'Db6', 2, 0.9],
  [3, 'Eb6', 1, 0.84],
]);
chord(47, 4, ['F5', 'Bb5', 'Db6', 'F6'], 3, 0.94);
surge(
  48,
  ['Bb1', 'Gb2', 'Bb2', 'Db3', 'Gb3', 'Bb3', 'Db4', 'Gb4', 'Db4', 'Bb3', 'Gb3', 'Db3'],
  0.64,
);
chord(48, 1, ['Bb5', 'Db6', 'Gb6', 'Bb6'], 3, 0.98);
octaves(48, [
  [4, 'Ab6', 1, 0.88],
  [5, 'Gb6', 1, 0.86],
  [6, 'Db6', 1, 0.84],
]);
surge(49, ['C2', 'G2', 'C3', 'E3', 'G3', 'Bb3', 'C4', 'Bb3', 'G3', 'E3', 'C3', 'G2'], 0.64);
chord(49, 1, ['C5', 'E5', 'G5', 'C6'], 2, 0.92);
octaves(49, [
  [3, 'Bb5', 1, 0.86],
  [4, 'G5', 2, 0.88],
  [6, 'E5', 1, 0.88],
]);

// ---- 50–57: the blizzard ---------------------------------------------------
// The theme's last note is the first of the snow. The right hand falls in
// threes and is thrown back up; the left drums the omen's rhythm as octave
// and chords; and the harmony falls by fifths — F minor, B flat minor, E
// flat, A flat, D flat, G half-diminished, C — all the way round to the
// dominant.
drum(50, ['F1', 'F2'], ['Ab3', 'C4', 'F4'], 0.86);
n(50, 1, 'F5', 1, 0.86, 'treble');
flutter(50, ['F6', 'C6', 'Db6', 'C6', 'Ab5', 'Bb5', 'Ab5', 'F5', 'G5', 'F5', 'C5', 'Db5'], 0.78);
drum(51, ['Bb1', 'Bb2'], ['Bb3', 'Db4', 'F4'], 0.7);
run(51, 1, ['Bb4', 'Db5', 'F5', 'Bb5', 'Db6', 'F6'], 0.62, 0.8);
run(51, 4, ['Bb6', 'F6', 'Gb6', 'F6', 'Db6', 'Eb6'], 0.84, 0.72);
drum(52, ['Eb2', 'Eb3'], ['G3', 'Db4', 'Eb4'], 0.72);
flutter(52, ['Db6', 'Bb5', 'C6', 'Bb5', 'G5', 'Ab5', 'G5', 'Eb5', 'F5', 'Eb5', 'Db5', 'Bb4'], 0.78);
// A flat takes a seventh at the crest, and falls into D flat.
drum(53, ['Ab1', 'Ab2'], ['Gb3', 'C4', 'Eb4'], 0.75);
run(53, 1, ['C5', 'Eb5', 'Ab5', 'C6', 'Eb6', 'Ab6'], 0.66, 0.84);
run(53, 4, ['C7', 'Ab6', 'Bb6', 'Ab6', 'Eb6', 'Gb6'], 0.88, 0.76);
drum(54, ['Db2', 'Db3'], ['F3', 'Ab3', 'Db4'], 0.78);
flutter(
  54,
  ['F6', 'Db6', 'Eb6', 'Db6', 'Ab5', 'Bb5', 'Ab5', 'F5', 'Gb5', 'F5', 'Db5', 'Eb5'],
  0.83,
);
drum(55, ['G1', 'G2'], ['Bb3', 'Db4', 'F4'], 0.82);
run(55, 1, ['Db5', 'F5', 'G5', 'Bb5', 'Db6', 'F6'], 0.72, 0.9);
run(55, 4, ['Bb6', 'G6', 'Ab6', 'G6', 'F6', 'Db6'], 0.94, 0.82);
drum(56, ['C2', 'C3'], ['Bb3', 'E4', 'G4'], 0.86);
flutter(56, ['C6', 'G5', 'Ab5', 'G5', 'E5', 'F5', 'E5', 'C5', 'Db5', 'C5', 'Bb4', 'Db5'], 0.9);
// Up the dominant ninth, over the top by way of the sigh, and down to meet
// the hymn.
drum(57, ['C1', 'C2'], ['Bb3', 'E4', 'G4'], 0.9);
run(
  57,
  1,
  ['C5', 'E5', 'G5', 'Bb5', 'Db6', 'E6', 'G6', 'Bb6', 'Db7', 'C7', 'Bb6', 'G6'],
  0.76,
  0.96,
);

// ---- 58–65: the hymn in the storm ------------------------------------------
// The falling steps of bar 25, in D flat and in full chords; its drop of a
// fourth is a leap up a fifth now. Four bars later the same notes in F minor.
grand(58, ['Db1', 'Db2'], ['Ab2', 'Db3', 'F3', 'Ab3'], ['Db4', 'F4', 'Ab4'], 0.86);
chord(58, 1, ['F5', 'Ab5', 'Db6', 'F6'], 2, 0.95);
octaves(58, [[3, 'Eb6', 1, 0.86]]);
chord(58, 4, ['Db5', 'F5', 'Ab5', 'Db6'], 3, 0.94);
grand(59, ['Gb1', 'Gb2'], ['Db3', 'Gb3', 'Bb3', 'Db4'], ['Db4', 'Gb4', 'Bb4'], 0.87);
chord(59, 1, ['Ab5', 'Db6', 'Ab6'], 3, 0.96);
chord(59, 4, ['Bb5', 'Db6', 'Gb6', 'Bb6'], 3, 0.98);
grand(60, ['Ab1', 'Ab2'], ['Ab2', 'Eb3', 'Ab3', 'C4'], ['Eb4', 'Gb4', 'Ab4'], 0.86);
chord(60, 1, ['Eb5', 'Gb5', 'C6', 'Eb6'], 2, 0.94);
octaves(60, [[3, 'Db6', 1, 0.86]]);
chord(60, 4, ['C5', 'Eb5', 'Gb5', 'C6'], 3, 0.92);
// Not D flat but B flat minor: the door back to F minor.
grand(61, ['Bb1', 'Bb2'], ['F3', 'Bb3', 'Db4', 'F4'], ['Db4', 'F4', 'Bb4'], 0.87);
chord(61, 1, ['F5', 'Bb5', 'Db6', 'F6'], 3, 0.95);
chord(61, 4, ['Ab5', 'Db6', 'F6', 'Ab6'], 3, 0.97);
grand(62, ['F1', 'F2'], ['Ab2', 'C3', 'F3', 'Ab3'], ['C4', 'F4', 'Ab4'], 0.88);
chord(62, 1, ['Ab5', 'C6', 'F6', 'Ab6'], 2, 0.97);
octaves(62, [[3, 'G6', 1, 0.88]]);
chord(62, 4, ['F5', 'Ab5', 'C6', 'F6'], 3, 0.95);
grand(63, ['Bb1', 'Bb2'], ['F3', 'Bb3', 'Db4', 'F4'], ['Bb3', 'Db4', 'F4'], 0.86);
chord(63, 1, ['C5', 'F5', 'C6'], 3, 0.88);
chord(63, 4, ['Db5', 'F5', 'Bb5', 'Db6'], 3, 0.94);
grand(64, ['C2', 'C3'], ['G3', 'Bb3', 'C4', 'E4'], ['Bb3', 'E4', 'G4'], 0.88);
chord(64, 1, ['G5', 'Bb5', 'E6', 'G6'], 2, 0.96);
octaves(64, [[3, 'F6', 1, 0.88]]);
chord(64, 4, ['E5', 'G5', 'Bb5', 'E6'], 3, 0.95);
// The hymn's last step up reaches the top C.
grand(65, ['F1', 'F2'], ['Ab2', 'C3', 'F3', 'Ab3'], ['C4', 'F4', 'Ab4'], 0.9);
chord(65, 1, ['Ab5', 'C6', 'F6', 'Ab6'], 3, 0.97);
chord(65, 4, ['C6', 'F6', 'Ab6', 'C7'], 3, 0.99);

// ---- 66–69: the omen closes in ---------------------------------------------
// All five notes in a single bar, three times, each a step nearer: on B flat,
// on D over G seventh, and on F itself over the dominant.
surge(66, ['Bb1', 'F2', 'Bb2', 'Db3', 'F3', 'Bb3', 'Db4', 'F4', 'Db4', 'Bb3', 'F3', 'Db3'], 0.63);
octaves(66, [
  [1, 'Bb5', 1, 0.9],
  [2, 'C6', 1, 0.86],
  [3, 'Db6', 1, 0.9],
  [4, 'Gb6', 2, 0.97],
  [6, 'F6', 1, 0.9],
]);
surge(67, ['B1', 'G2', 'B2', 'D3', 'F3', 'G3', 'B3', 'D4', 'B3', 'G3', 'F3', 'D3'], 0.65);
octaves(67, [
  [1, 'D6', 1, 0.92],
  [2, 'E6', 1, 0.88],
  [3, 'F6', 1, 0.92],
  [4, 'Ab6', 2, 0.98],
  [6, 'G6', 1, 0.92],
]);
surge(68, ['C2', 'Ab2', 'C3', 'F3', 'Ab3', 'C4', 'F4', 'Ab4', 'F4', 'C4', 'Ab3', 'F3'], 0.67);
octaves(68, [
  [1, 'F6', 1, 0.94],
  [2, 'G6', 1, 0.9],
  [3, 'Ab6', 1, 0.94],
  [4, 'Db7', 2, 0.99],
  [6, 'C7', 1, 0.94],
]);
// The augmented sixth, struck twice: D flat in the bass, B on top, both a
// semitone from C. The sigh has become the harmony itself.
n(69, 1, ['Db1', 'Db2'], 1, 0.94, 'bass');
run(69, 2, ['Ab2', 'Db3', 'F3', 'B3'], 0.64, 0.76, 'bass');
n(69, 4, ['F4', 'Ab4', 'B4'], 3, 0.84, 'bass');
chord(69, 1, ['B5', 'F6', 'Ab6', 'B6'], 3, 0.98);
chord(69, 4, ['B5', 'F6', 'Ab6', 'B6'], 3, 0.99);

// ---- 70–75: the fall -------------------------------------------------------
// C, and the right hand comes down four octaves in sighs — D flat to C, B to
// B flat, A flat to G, F to E, the same eight notes in every octave — while
// the bass drums the omen's rhythm on the lowest C.
const CASCADE = [
  ...['Db7', 'C7'],
  ...['B6', 'Bb6', 'Ab6', 'G6', 'F6', 'E6', 'Db6', 'C6'],
  ...['B5', 'Bb5', 'Ab5', 'G5', 'F5', 'E5', 'Db5', 'C5'],
  ...['B4', 'Bb4', 'Ab4', 'G4', 'F4', 'E4', 'Db4', 'C4'],
  ...['B3', 'Bb3', 'Ab3', 'G3', 'F3', 'E3', 'Db3', 'C3'],
];
drum(70, ['C1', 'C2'], ['C1', 'C2'], 0.98);
chord(70, 1, ['C6', 'E6', 'G6', 'C7'], 1, 0.98);
run(70, 2, CASCADE.slice(0, 10), 0.92, 0.86);
drum(71, ['C1', 'C2'], ['C1', 'C2'], 0.96);
run(71, 1, CASCADE.slice(10, 22), 0.86, 0.88);
// Below middle C the left hand leaves its drum and takes the line over.
n(72, 1, ['C1', 'C2'], 2, 0.98, 'bass');
run(72, 1, CASCADE.slice(22, 26), 0.88, 0.9);
run(72, 3, CASCADE.slice(26), 0.9, 0.96, 'bass');

// Two chords on the dominant seventh, the leading note on top of the second,
// and F minor.
n(73, 1, ['C2', 'C3'], 3, 0.96, 'bass');
chord(73, 1, ['Bb4', 'C5', 'E5', 'G5'], 3, 0.96);
n(73, 4, ['C1', 'C2'], 3, 0.98, 'bass');
chord(73, 4, ['G4', 'Bb4', 'C5', 'E5'], 3, 0.98);
n(74, 1, ['F1', 'F2'], 6, 0.99, 'bass');
chord(74, 1, ['F4', 'Ab4', 'C5', 'F5'], 6, 0.97);
// The drum, on F at last, dying away.
n(75, 1, ['F1', 'F2'], 2, 0.62, 'bass');
n(75, 3, ['F1', 'F2'], 1, 0.46, 'bass');
n(75, 4, ['F1', 'F2'], 3, 0.34, 'bass');
n(75, 1, ['C4', 'F4', 'Ab4'], 6, 0.5, 'treble');

// ---- 76–84: snow -----------------------------------------------------------
// The two still chords of the opening.
n(76, 1, ['Db3', 'Ab3'], 6, 0.26, 'bass');
n(76, 1, ['F5', 'Ab5', 'Db6'], 6, 0.32, 'treble');
n(77, 1, ['C3', 'G3'], 6, 0.24, 'bass');
n(77, 1, ['E5', 'G5', 'C6'], 6, 0.3, 'treble');

/** Single notes high up, off the pulse and thinning out: `[eighth, note]`. */
function flakes(
  bar: number,
  notes: readonly (readonly [eighth: number, note: string])[],
  velocity: number,
): void {
  notes.forEach(([eighth, note], i) => n(bar, eighth, note, 1, velocity - i * 0.03, 'treble'));
}

// Snow over a fifth on F. The top flake sighs once more, C to D flat, and
// there are fewer of them every bar.
n(78, 1, ['F2', 'C3'], 6, 0.22, 'bass');
flakes(
  78,
  [
    [2, 'C7'],
    [4, 'Ab6'],
    [6, 'F6'],
  ],
  0.36,
);
n(79, 1, ['F2', 'Db3'], 6, 0.22, 'bass');
flakes(
  79,
  [
    [2, 'Db7'],
    [4, 'Ab6'],
    [6, 'F6'],
  ],
  0.36,
);
n(80, 1, ['F2', 'Bb2', 'Db3'], 6, 0.2, 'bass');
flakes(
  80,
  [
    [2, 'Bb6'],
    [5, 'F6'],
  ],
  0.34,
);
n(81, 1, ['F2', 'C3'], 6, 0.2, 'bass');
flakes(81, [[3, 'C6']], 0.32);

// The omen one last time, a single voice over the low F — and what the sigh
// never did before: it goes on down to F. No third in the last chord, neither
// minor nor major, only white.
n(82, 1, ['F1', 'F2'], 6, 0.28, 'bass');
sing(82, [
  [1, 'F4', 2, 0.36],
  [3, 'G4', 1, 0.31],
  [4, 'Ab4', 3, 0.38],
]);
n(83, 1, ['F1', 'F2'], 6, 0.26, 'bass');
sing(83, [
  [1, 'Db5', 3, 0.44],
  [4, 'C5', 3, 0.33],
]);
n(84, 1, ['F1', 'F2'], 9, 0.28, 'bass');
chord(84, 1, ['C4', 'F4'], 9, 0.36);
n(84, 4, 'C7', 6, 0.3, 'treble');

export const COMING_OF_WINTER: LibraryTrackDef = {
  trackId: 'coming-of-winter',
  title: 'The Coming of Winter',
  composer: 'Claude Fable 5.2',
  folder: 'originals',
  descriptionKey: 'comingOfWinter',
  bpm: 60,
  timeSignature: { numerator: 6, denominator: 8 },
  // Beats are eighths, so bar b starts on beat 6(b − 1).
  tempoChanges: [
    [36, 54], // Bar 7: the opening holds its breath.
    [48, 84], // Bar 9: the theme.
    [90, 76], // Bar 16: the phrase settles.
    [96, 88], // Bar 17: again, moving on.
    [132, 80], // Bar 23: A flat major.
    [138, 70], // Bar 24: easing into the hymn.
    [144, 76], // Bar 25: the last warm light.
    [180, 70], // Bar 31: the light goes.
    [186, 58], // Bar 32: the sigh.
    [192, 88], // Bar 33: the wind rises.
    [204, 94], // Bar 35.
    [216, 100], // Bar 37: the augmented sixth.
    [222, 108], // Bar 38: on the dominant.
    [234, 114], // Bar 40.
    [246, 110], // Bar 42: broadening into the downbeat.
    [252, 126], // Bar 43: the storm.
    [288, 120], // Bar 49: the cadence.
    [294, 132], // Bar 50: the blizzard.
    [336, 122], // Bar 57: gathering for the hymn.
    [342, 108], // Bar 58: the hymn, broadly.
    [366, 112], // Bar 62: in F minor.
    [384, 102], // Bar 65: up to the top C.
    [390, 132], // Bar 66: the omen closes in.
    [408, 96], // Bar 69: the augmented sixth, with its full weight.
    [414, 138], // Bar 70: the fall.
    [432, 80], // Bar 73: two chords.
    [438, 60], // Bar 74: F minor.
    [444, 52], // Bar 75: the drum dies away.
    [450, 54], // Bar 76: snow.
    [462, 50], // Bar 78.
    [486, 46], // Bar 82: the omen, one last time.
    [498, 40], // Bar 84: F.
  ],
  quantization: '1/16',
  pedal: 'bar',
  events,
};
