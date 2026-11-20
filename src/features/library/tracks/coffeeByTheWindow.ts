import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Coffee by the Window" — original jazz piano piece by Gemini 4 Neon for PoKeyBoard.
 *
 * F major, 4/4, ~2:05 (48 bars). Intro(4) A1(8) A2(8) B(8) Solo(8) A3(8) Coda(4).
 *
 * Designed to pair with a quiet morning cup: warm major-ninth and thirteenth
 * voicings, smooth half-step voice leading (Am9 – Ab13 – Gm9 – C13), a sunlit
 * bridge that briefly borrows the bittersweet minor subdominant (Bbm6) before
 * climbing to a radiant G13 apex, a playful walking-bass solo chorus with two
 * jazz triplet turns, and a Bill Evans–inspired tritone-sub coda (Gm9 – Gb13 – Fmaj9).
 *
 * Offbeat eighths swing gently at 62% of the beat — natural and unhurried in
 * playback while still snapping cleanly to the 1/8 notation grid so the score
 * reads like a real jazz lead sheet. Explicit finger-legato durations replace
 * bar-wide sustain pedal so two-chord bars and swung melodic lines stay crisp.
 * Every event declares its staff so left-hand voicings rising to E4 remain on
 * the bass staff, every simultaneous chord stays within an octave, and the
 * entire melody sits comfortably inside C4–A5.
 */

const events: TrackEvent[] = [];

/** Laid-back coffee-morning swing: offbeats land 62% through the beat. */
const SWING = 0.62;
const TRIPLET_1 = 1 / 3;
const TRIPLET_2 = 2 / 3;

/** One note or chord at 1-based bar and beat; durations are quarter-note beats. */
function n(
  bar: number,
  beat: number,
  note: string | string[],
  duration: number,
  velocity: number,
  staff: 'treble' | 'bass',
): void {
  events.push([(bar - 1) * 4 + (beat - 1), note, duration, velocity, staff]);
}

type VoiceNote = readonly [
  beat: number,
  note: string | string[],
  duration: number,
  velocity: number,
];

function rh(bar: number, notes: readonly VoiceNote[]): void {
  notes.forEach(([beat, note, duration, velocity]) =>
    n(bar, beat, note, duration, velocity, 'treble'),
  );
}

/** Gentle jazz comping: sustained bass root answered by two warm shells on beats 2 and 4. */
function gentle(
  bar: number,
  root: string,
  shellA: string[],
  shellB: string[],
  baseVel: number,
): void {
  n(bar, 1, root, 3.85, baseVel, 'bass');
  n(bar, 2, shellA, 1.85, baseVel - 0.03, 'bass');
  n(bar, 4, shellB, 0.88, baseVel - 0.05, 'bass');
}

/** Swinging comping: sustained bass root with a warm shell on beat 2 and a swung answer on 3&. */
function sway(
  bar: number,
  root: string,
  shellA: string[],
  shellB: string[],
  baseVel: number,
): void {
  n(bar, 1, root, 3.85, baseVel, 'bass');
  n(bar, 2, shellA, 1.54, baseVel - 0.03, 'bass');
  n(bar, 3 + SWING, shellB, 1.28, baseVel - 0.05, 'bass');
}

/** Two-chord bar: clean half-bar bass roots and mid-register shells, zero overlap. */
function split(
  bar: number,
  rootA: string,
  shellA: string[],
  rootB: string,
  shellB: string[],
  baseVel: number,
): void {
  n(bar, 1, rootA, 1.9, baseVel, 'bass');
  n(bar, 2, shellA, 0.92, baseVel - 0.035, 'bass');
  n(bar, 3, rootB, 1.9, baseVel, 'bass');
  n(bar, 4, shellB, 0.9, baseVel - 0.035, 'bass');
}

/** Solo-chorus left hand: bouncy walking bass with a crisp guide-tone shell on beat 2. */
function walk(
  bar: number,
  b1: string,
  shell2: string[],
  b3: string,
  b4: string,
  baseVel = 0.43,
): void {
  n(bar, 1, b1, 0.94, baseVel, 'bass');
  n(bar, 2, shell2, 0.85, baseVel - 0.05, 'bass');
  n(bar, 3, b3, 0.94, baseVel - 0.01, 'bass');
  n(bar, 4, b4, 0.92, baseVel - 0.02, 'bass');
}

// Reusable open jazz voicings (all <= 11 semitones, keeping guide tones clear).
const FMAJ7_OPEN = ['F3', 'A3', 'E4'];
const FMAJ9_CORE = ['F3', 'G3', 'A3'];
const FMAJ9_SHIMMER = ['E3', 'G3', 'A3'];
const F69_WARM = ['D3', 'G3', 'A3'];
const F_TRIAD_WARM = ['C3', 'F3', 'A3'];
const D9_SHELL = ['F#3', 'C4', 'E4'];
const D7_OPEN = ['F#3', 'A3', 'C4'];
const D9_GUIDE = ['F#3', 'C4'];
const GM9_SHELL = ['F3', 'Bb3', 'D4'];
const GM9_LOW = ['D3', 'F3', 'Bb3'];
const C9_SHELL = ['E3', 'Bb3', 'D4'];
const C9_GUIDE = ['E3', 'Bb3'];
const C7_AUG = ['E3', 'G#3', 'Bb3'];
const AM9_SHELL = ['G3', 'C4', 'E4'];
const AM9_COLOR = ['G3', 'B3', 'E4'];
const AB13_SHELL = ['Gb3', 'C4', 'Eb4'];
const AB13_GUIDE = ['Gb3', 'C4'];
const BBMAJ9_HIGH = ['F3', 'A3', 'D4'];
const BBMAJ9_OPEN = ['F3', 'A3', 'C4'];
const BBMAJ9_LOW = ['D3', 'F3', 'A3'];
const BBM6_SHELL = ['Db3', 'F3', 'G3'];
const BBM6_GUIDE = ['Db3', 'G3'];
const CM9_SHELL = ['Eb3', 'Bb3', 'D4'];
const F13_SHELL = ['Eb3', 'A3', 'D4'];
const G13_SHELL = ['F3', 'B3', 'E4'];
const GB13_SHELL = ['E3', 'Ab3', 'Bb3'];

// ---- Intro (Bars 1–4): sunlit vamp setting the table ---------------------
gentle(1, 'F2', FMAJ7_OPEN, FMAJ9_CORE, 0.35);
rh(1, [
  [1 + SWING, 'G4', 0.36, 0.48],
  [2, 'A4', 0.92, 0.54],
  [3, 'C5', 1.85, 0.58],
]);

gentle(2, 'G2', GM9_SHELL, GM9_SHELL, 0.35);
rh(2, [
  [1 + SWING, 'A4', 0.36, 0.5],
  [2, 'Bb4', 0.92, 0.55],
  [3, 'D5', 1.85, 0.59],
]);

split(3, 'A2', AM9_SHELL, 'D3', D9_SHELL, 0.36);
rh(3, [
  [1, 'E5', 0.92, 0.6],
  [2, 'C5', 0.92, 0.54],
  [3, 'A4', 0.92, 0.53],
  [4, 'F#4', 0.9, 0.49],
]);

// Bar 4: Gm9 -> C9sus4 -> C9; left hand breathes right before the F4 pickup.
n(4, 1, 'G2', 1.9, 0.36, 'bass');
n(4, 2, GM9_SHELL, 0.92, 0.33, 'bass');
n(4, 3, 'C3', 1.85, 0.36, 'bass');
n(4, 3, ['F3', 'Bb3'], 0.92, 0.33, 'bass');
n(4, 4, C9_GUIDE, 0.56, 0.34, 'bass');
rh(4, [
  [1, 'A4', 0.92, 0.55],
  [2, 'G4', 0.92, 0.51],
  [3, 'D4', 0.85, 0.46],
  [4, 'C4', 0.56, 0.52],
  [4 + SWING, 'F4', 0.36, 0.58],
]);

// ---- A1 (Bars 5–12): the head, warm and unhurried ------------------------
// F3 gently melts to E3 on 3& as the melody blooms up to C5.
sway(5, 'F2', FMAJ9_CORE, FMAJ9_SHIMMER, 0.39);
rh(5, [
  [1, 'A4', 1.54, 0.66],
  [2 + SWING, 'G4', 0.36, 0.58],
  [3, 'A4', 0.56, 0.64],
  [3 + SWING, 'C5', 1.3, 0.7],
]);

gentle(6, 'D2', D9_SHELL, D9_GUIDE, 0.39);
rh(6, [
  [1, 'B4', 0.56, 0.67],
  [1 + SWING, 'C5', 0.36, 0.64],
  [2, 'B4', 0.92, 0.65],
  [3, 'A4', 0.92, 0.61],
  [4, 'F#4', 0.9, 0.57],
]);

sway(7, 'G2', GM9_SHELL, GM9_SHELL, 0.39);
rh(7, [
  [1, 'A4', 1.54, 0.66],
  [2 + SWING, 'G4', 0.36, 0.59],
  [3, 'A4', 0.56, 0.64],
  [3 + SWING, 'Bb4', 1.3, 0.68],
]);

gentle(8, 'C3', C9_SHELL, C9_GUIDE, 0.39);
rh(8, [
  [1, 'A4', 0.92, 0.66],
  [2, 'G4', 0.92, 0.61],
  [3, 'E4', 0.92, 0.57],
  [4, 'G4', 0.56, 0.56],
  [4 + SWING, 'A4', 0.36, 0.62],
]);

// Bars 9–12: smooth chromatic descent Am9 -> Ab13 -> Gm9 -> C9sus4 – C9.
gentle(9, 'A2', AM9_SHELL, AM9_COLOR, 0.4);
rh(9, [
  [1, 'C5', 0.92, 0.68],
  [2, 'E5', 0.92, 0.72],
  [3, 'D5', 0.56, 0.66],
  [3 + SWING, 'C5', 0.36, 0.63],
  [4, 'B4', 0.9, 0.61],
]);

gentle(10, 'Ab2', AB13_SHELL, AB13_GUIDE, 0.39);
rh(10, [
  [1, 'C5', 1.54, 0.67],
  [2 + SWING, 'Bb4', 0.36, 0.61],
  [3, 'Ab4', 0.92, 0.59],
  [4, 'F4', 0.9, 0.56],
]);

sway(11, 'G2', GM9_SHELL, GM9_LOW, 0.38);
rh(11, [
  [1, 'A4', 1.54, 0.64],
  [2 + SWING, 'G4', 0.36, 0.58],
  [3, 'F4', 0.92, 0.56],
  [4, 'D4', 0.9, 0.52],
]);

// Bar 12: C9sus4 resolves to C9, lifting cleanly before the F4 pickup to A2.
n(12, 1, 'C3', 3.85, 0.38, 'bass');
n(12, 2, GM9_SHELL, 0.92, 0.34, 'bass');
n(12, 3, C9_SHELL, 1.54, 0.35, 'bass');
rh(12, [
  [1, 'G4', 1.9, 0.58],
  [3, 'E4', 0.88, 0.54],
  [4, 'C4', 0.56, 0.53],
  [4 + SWING, 'F4', 0.36, 0.6],
]);

// ---- A2 (Bars 13–20): second statement with soft inner harmony -----------
sway(13, 'F2', FMAJ9_CORE, FMAJ9_SHIMMER, 0.4);
rh(13, [
  [1, 'A4', 1.54, 0.68],
  [1, 'E4', 1.5, 0.41],
  [2 + SWING, 'G4', 0.36, 0.6],
  [3, 'A4', 0.56, 0.65],
  [3 + SWING, 'C5', 1.3, 0.72],
  [3 + SWING, 'G4', 1.25, 0.43],
]);

gentle(14, 'D2', D7_OPEN, D9_GUIDE, 0.4);
rh(14, [
  [1, 'B4', 0.56, 0.69],
  [1 + SWING, 'C5', 0.36, 0.65],
  [2, 'B4', 0.92, 0.67],
  [2, 'F#4', 0.9, 0.41],
  [3, 'A4', 0.92, 0.63],
  [3, 'E4', 0.9, 0.4],
  [4, 'F#4', 0.9, 0.59],
]);

sway(15, 'G2', GM9_SHELL, GM9_SHELL, 0.4);
rh(15, [
  [1, 'A4', 1.54, 0.68],
  [1, 'F4', 1.5, 0.41],
  [2 + SWING, 'G4', 0.36, 0.61],
  [3, 'A4', 0.56, 0.66],
  [3 + SWING, 'D5', 1.3, 0.73],
  [3 + SWING, 'Bb4', 1.25, 0.43],
]);

gentle(16, 'C3', C9_SHELL, C9_GUIDE, 0.4);
rh(16, [
  [1, 'C5', 0.92, 0.69],
  [1, 'G4', 0.9, 0.42],
  [2, 'A4', 0.92, 0.65],
  [2, 'E4', 0.9, 0.4],
  [3, 'G4', 0.92, 0.61],
  [4, 'A4', 0.56, 0.62],
  [4 + SWING, 'C5', 0.36, 0.67],
]);

gentle(17, 'Bb2', BBMAJ9_HIGH, BBMAJ9_OPEN, 0.41);
rh(17, [
  [1, 'F5', 1.54, 0.74],
  [1, 'A4', 1.5, 0.43],
  [2 + SWING, 'D5', 0.36, 0.66],
  [3, 'C5', 0.92, 0.65],
  [4, 'A4', 0.9, 0.61],
]);

split(18, 'G2', GM9_SHELL, 'C3', C9_SHELL, 0.4);
rh(18, [
  [1, 'Bb4', 0.56, 0.65],
  [1 + SWING, 'A4', 0.36, 0.61],
  [2, 'G4', 0.92, 0.62],
  [3, 'A4', 0.92, 0.64],
  [4, 'G4', 0.9, 0.59],
]);

// Bar 19: F6/9 beneath the sustained tonic F4 avoids any E3-F4 minor-ninth rub.
gentle(19, 'F2', F69_WARM, F_TRIAD_WARM, 0.39);
rh(19, [
  [1, 'F4', 2.85, 0.64],
  [2, ['A4', 'C5'], 1.8, 0.43],
  [4, 'G4', 0.9, 0.54],
]);

// Bar 20: Cm9 -> F13 prepares the sunlit modulation to Bb major.
split(20, 'C3', CM9_SHELL, 'F2', F13_SHELL, 0.4);
rh(20, [
  [1, 'G4', 0.92, 0.6],
  [2, 'Bb4', 0.92, 0.64],
  [3, 'C5', 0.56, 0.66],
  [3 + SWING, 'A4', 0.36, 0.63],
  [4, 'G4', 0.56, 0.63],
  [4 + SWING, 'C5', 0.36, 0.68],
]);

// ---- B (Bars 21–28): bridge — Bb major, minor-iv sigh, and G13 sunbeam ---
sway(21, 'Bb2', BBMAJ9_LOW, BBMAJ9_LOW, 0.42);
rh(21, [
  [1, 'D5', 1.54, 0.72],
  [1, 'A4', 1.5, 0.43],
  [2 + SWING, 'F5', 0.36, 0.74],
  [3, 'G5', 0.92, 0.76],
  [4, 'F5', 0.9, 0.71],
]);

// Bar 22: Bbm6 — D drops to Db for a warm, nostalgic minor-subdominant hue.
sway(22, 'Bb2', BBM6_SHELL, BBM6_SHELL, 0.41);
rh(22, [
  [1, 'F5', 0.92, 0.71],
  [2, 'Eb5', 0.56, 0.67],
  [2 + SWING, 'Db5', 1.3, 0.69],
  [2 + SWING, 'G4', 1.25, 0.41],
  [4, 'C5', 0.9, 0.64],
]);

gentle(23, 'A2', AM9_SHELL, AM9_COLOR, 0.41);
rh(23, [
  [1, 'E5', 1.54, 0.72],
  [1, 'C5', 1.5, 0.42],
  [2 + SWING, 'D5', 0.36, 0.66],
  [3, 'C5', 0.92, 0.65],
  [4, 'B4', 0.9, 0.62],
]);

gentle(24, 'D2', D9_SHELL, D9_GUIDE, 0.41);
rh(24, [
  [1, 'A4', 0.56, 0.64],
  [1 + SWING, 'B4', 0.36, 0.66],
  [2, 'C5', 0.92, 0.68],
  [3, 'A4', 0.92, 0.63],
  [4, 'F#4', 0.56, 0.58],
  [4 + SWING, 'A4', 0.36, 0.63],
]);

sway(25, 'G2', GM9_SHELL, GM9_SHELL, 0.42);
rh(25, [
  [1, 'Bb4', 0.92, 0.68],
  [2, 'D5', 0.92, 0.72],
  [3, 'F5', 0.92, 0.75],
  [3, 'Bb4', 0.9, 0.43],
  [4, 'G5', 0.56, 0.76],
  [4 + SWING, 'F5', 0.36, 0.73],
]);

// Bar 26: G13 — Bb lifts to B natural as the tune reaches its high A5 apex.
sway(26, 'G2', G13_SHELL, G13_SHELL, 0.44);
rh(26, [
  [1, 'A5', 1.54, 0.8],
  [1, 'B4', 1.5, 0.44],
  [2 + SWING, 'G5', 0.36, 0.74],
  [3, 'E5', 0.92, 0.72],
  [3, 'B4', 0.9, 0.42],
  [4, 'D5', 0.9, 0.68],
]);

sway(27, 'C3', GM9_SHELL, GM9_SHELL, 0.41);
rh(27, [
  [1, 'F5', 0.56, 0.72],
  [1 + SWING, 'D5', 0.36, 0.66],
  [2, 'C5', 0.92, 0.65],
  [2, 'G4', 0.9, 0.41],
  [3, 'Bb4', 0.92, 0.62],
  [4, 'G4', 0.9, 0.59],
]);

// Bar 28: C13 -> C7(#5); the raised fifth G# pulls straight into A4 for the solo.
n(28, 1, 'C3', 3.85, 0.41, 'bass');
n(28, 1 + SWING, C9_SHELL, 1.28, 0.37, 'bass');
n(28, 3, C7_AUG, 1.85, 0.37, 'bass');
rh(28, [
  [1, 'A4', 0.92, 0.65],
  [2, 'G4', 0.92, 0.61],
  [3, 'G#4', 0.92, 0.64],
  [4, 'E4', 0.56, 0.57],
  [4 + SWING, 'G#4', 0.36, 0.64],
]);

// ---- Solo Chorus (Bars 29–36): walking bass and lyrical jazz solo --------
walk(29, 'F2', ['F3', 'A3'], 'C3', 'A2', 0.43);
rh(29, [
  [1, 'A4', 0.56, 0.7],
  [1 + SWING, 'C5', 0.36, 0.72],
  [2, 'D5', 0.56, 0.74],
  [2 + SWING, 'E5', 0.92, 0.76],
  [3 + SWING, 'D5', 0.36, 0.68],
  [4, 'C5', 0.56, 0.67],
  [4 + SWING, 'A4', 0.36, 0.64],
]);

// Bar 30: first jazz eighth-note triplet turn on beat 2.
walk(30, 'D2', D9_GUIDE, 'F#2', 'A2', 0.43);
rh(30, [
  [1, 'C5', 0.56, 0.7],
  [1 + SWING, 'B4', 0.36, 0.67],
  [2, 'A4', 0.3, 0.68],
  [2 + TRIPLET_1, 'B4', 0.3, 0.7],
  [2 + TRIPLET_2, 'A4', 0.3, 0.66],
  [3, 'F#4', 0.92, 0.64],
  [4, 'E4', 0.56, 0.6],
  [4 + SWING, 'F#4', 0.36, 0.64],
]);

walk(31, 'G2', ['F3', 'Bb3'], 'Bb2', 'D3', 0.43);
rh(31, [
  [1, 'G4', 0.56, 0.67],
  [1 + SWING, 'A4', 0.36, 0.69],
  [2, 'Bb4', 0.56, 0.72],
  [2 + SWING, 'D5', 1.28, 0.75],
  [4, 'C5', 0.56, 0.69],
  [4 + SWING, 'A4', 0.36, 0.66],
]);

walk(32, 'C3', C9_GUIDE, 'G2', 'Bb2', 0.43);
rh(32, [
  [1, 'G4', 0.56, 0.67],
  [1 + SWING, 'E4', 0.36, 0.62],
  [2, 'G4', 0.56, 0.66],
  [2 + SWING, 'A4', 0.36, 0.69],
  [3, 'Bb4', 0.56, 0.71],
  [3 + SWING, 'A4', 0.36, 0.68],
  [4, 'G4', 0.56, 0.66],
  [4 + SWING, 'Bb4', 0.36, 0.7],
]);

walk(33, 'A2', ['G3', 'C4'], 'C3', 'A2', 0.44);
rh(33, [
  [1, ['C5', 'E5'], 0.92, 0.74],
  [2, ['D5', 'G5'], 0.56, 0.77],
  [2 + SWING, ['C5', 'E5'], 1.28, 0.74],
  [4, 'D5', 0.56, 0.69],
  [4 + SWING, 'C5', 0.36, 0.67],
]);

walk(34, 'Ab2', AB13_GUIDE, 'Eb2', 'Gb2', 0.43);
rh(34, [
  [1, ['C5', 'F5'], 0.92, 0.74],
  [2, 'Eb5', 0.56, 0.7],
  [2 + SWING, 'C5', 0.36, 0.67],
  [3, 'Bb4', 0.56, 0.66],
  [3 + SWING, 'Ab4', 0.36, 0.63],
  [4, 'F4', 0.9, 0.61],
]);

walk(35, 'G2', ['F3', 'Bb3'], 'Bb2', 'D3', 0.42);
rh(35, [
  [1, 'G4', 0.56, 0.65],
  [1 + SWING, 'A4', 0.36, 0.67],
  [2, 'Bb4', 0.56, 0.7],
  [2 + SWING, 'C5', 0.36, 0.71],
  [3, 'D5', 0.92, 0.73],
  [4, 'C5', 0.56, 0.67],
  [4 + SWING, 'A4', 0.36, 0.64],
]);

// Bar 36: triplet sigh winds the solo down and hands back the opening pickup.
n(36, 1, 'C3', 1.9, 0.4, 'bass');
n(36, 2, C9_SHELL, 0.92, 0.36, 'bass');
n(36, 3, 'G2', 1.85, 0.38, 'bass');
n(36, 3 + SWING, C9_GUIDE, 0.92, 0.34, 'bass');
rh(36, [
  [1, 'G4', 0.92, 0.65],
  [2, 'A4', 0.3, 0.64],
  [2 + TRIPLET_1, 'Bb4', 0.3, 0.65],
  [2 + TRIPLET_2, 'A4', 0.3, 0.62],
  [3, 'G4', 0.92, 0.59],
  [4, 'C4', 0.56, 0.54],
  [4 + SWING, 'F4', 0.36, 0.6],
]);

// ---- A3 (Bars 37–44): final head, lush and intimate ----------------------
sway(37, 'F2', FMAJ9_CORE, FMAJ9_SHIMMER, 0.39);
rh(37, [
  [1, 'A4', 1.54, 0.66],
  [1, 'E4', 1.5, 0.4],
  [2 + SWING, 'G4', 0.36, 0.58],
  [3, 'A4', 0.56, 0.64],
  [3 + SWING, 'C5', 1.3, 0.7],
  [3 + SWING, 'G4', 1.25, 0.42],
]);

gentle(38, 'D2', D7_OPEN, D9_GUIDE, 0.39);
rh(38, [
  [1, 'B4', 0.56, 0.67],
  [1 + SWING, 'C5', 0.36, 0.63],
  [2, 'B4', 0.92, 0.65],
  [2, 'F#4', 0.9, 0.4],
  [3, 'A4', 0.92, 0.61],
  [3, 'E4', 0.9, 0.39],
  [4, 'F#4', 0.9, 0.57],
]);

sway(39, 'G2', GM9_SHELL, GM9_SHELL, 0.39);
rh(39, [
  [1, 'A4', 1.54, 0.66],
  [1, 'F4', 1.5, 0.4],
  [2 + SWING, 'G4', 0.36, 0.59],
  [3, 'A4', 0.56, 0.64],
  [3 + SWING, 'D5', 1.3, 0.71],
  [3 + SWING, 'Bb4', 1.25, 0.42],
]);

gentle(40, 'C3', C9_SHELL, C9_GUIDE, 0.39);
rh(40, [
  [1, 'C5', 0.92, 0.67],
  [1, 'G4', 0.9, 0.4],
  [2, 'A4', 0.92, 0.63],
  [2, 'E4', 0.9, 0.39],
  [3, 'G4', 0.92, 0.6],
  [4, 'A4', 0.56, 0.6],
  [4 + SWING, 'C5', 0.36, 0.65],
]);

gentle(41, 'Bb2', BBMAJ9_HIGH, BBMAJ9_OPEN, 0.39);
rh(41, [
  [1, 'F5', 1.54, 0.71],
  [1, 'A4', 1.5, 0.41],
  [2 + SWING, 'D5', 0.36, 0.64],
  [3, 'C5', 0.92, 0.63],
  [4, 'A4', 0.9, 0.59],
]);

// Bar 42: one last tender glimpse of Bbm6 before turning home.
gentle(42, 'Bb2', BBM6_SHELL, BBM6_GUIDE, 0.38);
rh(42, [
  [1, 'C5', 0.92, 0.64],
  [2, 'Db5', 0.92, 0.65],
  [3, 'C5', 0.92, 0.61],
  [4, 'G4', 0.9, 0.57],
]);

split(43, 'A2', AM9_SHELL, 'D2', D9_SHELL, 0.38);
rh(43, [
  [1, 'A4', 0.92, 0.62],
  [2, 'C5', 0.92, 0.65],
  [3, 'B4', 0.92, 0.62],
  [4, 'A4', 0.9, 0.58],
]);

split(44, 'G2', GM9_SHELL, 'C3', C9_SHELL, 0.37);
rh(44, [
  [1, 'A4', 1.54, 0.62],
  [2 + SWING, 'G4', 0.36, 0.56],
  [3, 'A4', 0.92, 0.58],
  [4, 'G4', 0.9, 0.54],
]);

// ---- Coda (Bars 45–48): deceptive tag and sunlit Fmaj9 close -------------
split(45, 'A2', AM9_SHELL, 'Ab2', AB13_SHELL, 0.36);
rh(45, [
  [1, 'C5', 0.92, 0.6],
  [2, 'E5', 0.92, 0.62],
  [3, 'C5', 0.92, 0.58],
  [4, 'Ab4', 0.9, 0.54],
]);

split(46, 'G2', GM9_SHELL, 'C3', C9_SHELL, 0.35);
rh(46, [
  [1, 'A4', 1.54, 0.58],
  [2 + SWING, 'G4', 0.36, 0.53],
  [3, 'E4', 0.92, 0.52],
  [4, 'G4', 0.9, 0.5],
]);

// Bar 47: Gm9 -> Gb13 (tritone sub) — every inner voice steps by half-tone into Fmaj9.
split(47, 'G2', GM9_SHELL, 'Gb2', GB13_SHELL, 0.34);
rh(47, [
  [1, 'A4', 0.92, 0.56],
  [2, 'Bb4', 0.92, 0.57],
  [3, 'Eb5', 0.92, 0.56],
  [4, 'Ab4', 0.9, 0.51],
]);

// Bar 48: Ab4 resolves down a semitone to G4 (the 9th), and Fmaj9 blooms upward.
n(48, 1, ['F2', 'C3'], 4, 0.35, 'bass');
n(48, 2, FMAJ7_OPEN, 3, 0.33, 'bass');
rh(48, [
  [1, 'G4', 4, 0.52],
  [2, ['A4', 'C5'], 3, 0.42],
  [3, ['E5', 'G5'], 2, 0.4],
]);

export const COFFEE_BY_THE_WINDOW: LibraryTrackDef = {
  trackId: 'coffee-by-the-window',
  title: 'Coffee by the Window',
  composer: 'Gemini 4 Neon',
  folder: 'originals',
  descriptionKey: 'coffeeByTheWindow',
  bpm: 88,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/8',
  pedal: 'none',
  tempoChanges: [
    [16, 94], // Bar 5: easy morning swing settles in for the head.
    [80, 96], // Bar 21: sunlit lift into the bridge and solo chorus.
    [144, 92], // Bar 37: intimate return of the head.
    [176, 86], // Bar 45: coda tag begins to relax.
    [180, 78], // Bar 46: unhurried sigh.
    [184, 70], // Bar 47: lingering on the Gb13 turnaround.
    [188, 54], // Bar 48: serene Fmaj9 shimmer.
  ],
  events,
};
