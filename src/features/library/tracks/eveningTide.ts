import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Evening Tide" — original composition by Claude Opus 5 for PoKeyBoard.
 *
 * E minor, 4/4 at 66 bpm, ~2:35. Intro(4) A(8) A'(8) B(8) A''(8) Coda(6).
 * The left hand rolls one eight-note wave the whole way through — root,
 * fifth, octave, tenth and back — and only lets go in the last two bars.
 * Above it the melody climbs from B4 to the B5 that sits at the very top of
 * the default visible keyboard, then settles home.
 *
 * Harmony: i – VI – III – VII – iv – VI – v – i, brightening into G major
 * for the middle section. The sevenths of Cmaj7 and Em7 are left to the
 * melody, so the left-hand voicings stay open and triadic.
 *
 * The tempo map is the breathing: it leans forward into the middle section,
 * settles back for the return, and lets the coda run down to a ritardando.
 */

const events: TrackEvent[] = [];

/** One note or chord at bar/beat (both 1-based); duration in beats. */
function n(bar: number, beat: number, note: string | string[], dur: number, vel: number): void {
  events.push([(bar - 1) * 4 + (beat - 1), note, dur, vel]);
}

/** A left-hand voicing read low to high: root, fifth, octave, tenth. */
type Wave = readonly [string, string, string, string];

/**
 * Left hand: the tide. Eight eighth notes rising and falling through the
 * voicing — a b c d c b c d — so every bar leans back towards its root.
 */
function tide(bar: number, [a, b, c, d]: Wave, base: number): void {
  const shape: readonly (readonly [string, number])[] = [
    [a, 0],
    [b, -0.05],
    [c, -0.03],
    [d, -0.06],
    [c, -0.02],
    [b, -0.06],
    [c, -0.03],
    [d, -0.06],
  ];
  shape.forEach(([name, lean], i) => n(bar, 1 + i * 0.5, name, 0.45, base + lean));
}

/** Left hand at the close: the same voicing, unwound into four quarters. */
function slack(bar: number, [a, b, c, d]: Wave, base: number): void {
  [a, b, c, d].forEach((name, i) => n(bar, i + 1, name, 0.95, base - i * 0.02));
}

const EM: Wave = ['E2', 'B2', 'E3', 'G3'];
const C: Wave = ['C2', 'G2', 'C3', 'E3'];
const G: Wave = ['G2', 'D3', 'G3', 'B3'];
const G_B: Wave = ['B2', 'D3', 'G3', 'B3'];
const D: Wave = ['D2', 'A2', 'D3', 'F#3'];
const D_FS: Wave = ['F#2', 'A2', 'D3', 'F#3'];
const AM7: Wave = ['A2', 'E3', 'A3', 'C4'];
const BM7: Wave = ['B2', 'F#3', 'B3', 'D4'];

// ---- Intro: the water first, then one distant note ----------------------
tide(1, EM, 0.4);
tide(2, C, 0.42);
n(2, 3, 'E5', 2, 0.58);
tide(3, G, 0.43);
n(3, 1, 'D5', 2, 0.6);
n(3, 3, 'B4', 2, 0.56);
tide(4, D_FS, 0.43);
n(4, 1, 'A4', 1.5, 0.58);
n(4, 2.5, 'B4', 0.5, 0.56);
n(4, 3, 'D5', 2, 0.62);

// ---- A: the theme, one voice ---------------------------------------------
tide(5, EM, 0.45);
n(5, 1, 'B4', 1.5, 0.64);
n(5, 2.5, 'E5', 0.5, 0.66);
n(5, 3, 'D5', 1, 0.65);
n(5, 4, 'B4', 1, 0.62);
tide(6, C, 0.45);
n(6, 1, 'C5', 1.5, 0.66);
n(6, 2.5, 'B4', 0.5, 0.62);
n(6, 3, 'G4', 2, 0.6);
tide(7, G, 0.45);
n(7, 1, 'A4', 1, 0.62);
n(7, 2, 'B4', 1, 0.65);
n(7, 3, 'D5', 2, 0.68);
tide(8, D_FS, 0.45);
n(8, 1, 'B4', 1.5, 0.64);
n(8, 2.5, 'A4', 0.5, 0.6);
n(8, 3, 'F#4', 2, 0.58);
tide(9, AM7, 0.46);
n(9, 1, 'E5', 1.5, 0.7);
n(9, 2.5, 'D5', 0.5, 0.66);
n(9, 3, 'C5', 1, 0.66);
n(9, 4, 'A4', 1, 0.62);
tide(10, C, 0.46);
n(10, 1, 'G4', 1, 0.62);
n(10, 2, 'C5', 1, 0.66);
n(10, 3, 'E5', 2, 0.7);
tide(11, BM7, 0.46);
n(11, 1, 'D5', 1.5, 0.68);
n(11, 2.5, 'B4', 0.5, 0.64);
n(11, 3, 'A4', 2, 0.62);
tide(12, EM, 0.45);
n(12, 1, 'G4', 1.5, 0.62);
n(12, 2.5, 'F#4', 0.5, 0.58);
n(12, 3, 'E4', 2, 0.58);

// ---- A': the same theme an octave into the light -------------------------
tide(13, EM, 0.47);
n(13, 1, 'E5', 1.5, 0.7);
n(13, 2.5, 'G5', 0.5, 0.74);
n(13, 3, 'F#5', 1, 0.72);
n(13, 4, 'E5', 1, 0.7);
tide(14, C, 0.47);
n(14, 1, 'G5', 1.5, 0.74);
n(14, 2.5, 'F#5', 0.5, 0.68);
n(14, 3, 'E5', 2, 0.7);
tide(15, G, 0.47);
n(15, 1, 'D5', 1, 0.66);
n(15, 2, 'E5', 1, 0.7);
n(15, 3, 'G5', 2, 0.75);
tide(16, D_FS, 0.47);
n(16, 1, 'F#5', 1.5, 0.73);
n(16, 2.5, 'E5', 0.5, 0.68);
n(16, 3, 'D5', 2, 0.68);
tide(17, AM7, 0.48);
n(17, 1, 'C5', 1.5, 0.68);
n(17, 2.5, 'E5', 0.5, 0.72);
n(17, 3, 'D5', 1, 0.7);
n(17, 4, 'C5', 1, 0.66);
tide(18, C, 0.48);
n(18, 1, 'B4', 1, 0.64);
n(18, 2, 'C5', 1, 0.67);
n(18, 3, 'E5', 2, 0.72);
tide(19, D, 0.49);
n(19, 1, 'F#5', 1.5, 0.74);
n(19, 2.5, 'E5', 0.5, 0.7);
n(19, 3, 'D5', 1, 0.7);
n(19, 4, 'B4', 1, 0.66);
tide(20, D_FS, 0.49);
n(20, 1, 'A4', 2, 0.64);
n(20, 3, 'D5', 2, 0.7);

// ---- B: G major, and the tide comes all the way in -----------------------
tide(21, G, 0.5);
n(21, 1, 'G4', 1, 0.66);
n(21, 2, 'B4', 1, 0.7);
n(21, 3, 'D5', 2, 0.73);
tide(22, EM, 0.5);
n(22, 1, 'E5', 1.5, 0.74);
n(22, 2.5, 'D5', 0.5, 0.7);
n(22, 3, 'B4', 2, 0.68);
tide(23, C, 0.52);
n(23, 1, 'C5', 1, 0.7);
n(23, 2, 'E5', 1, 0.74);
n(23, 3, 'G5', 2, 0.78);
tide(24, D, 0.52);
n(24, 1, 'F#5', 1.5, 0.76);
n(24, 2.5, 'E5', 0.5, 0.72);
n(24, 3, 'D5', 2, 0.74);
tide(25, G, 0.55);
n(25, 1, ['E5', 'G5'], 1, 0.78);
n(25, 2, ['F#5', 'A5'], 1, 0.82);
n(25, 3, ['G5', 'B5'], 2, 0.86);
tide(26, EM, 0.55);
n(26, 1, ['G5', 'B5'], 1.5, 0.84);
n(26, 2.5, 'A5', 0.5, 0.8);
n(26, 3, ['E5', 'G5'], 1, 0.78);
n(26, 4, 'E5', 1, 0.74);
tide(27, C, 0.56);
n(27, 1, ['C5', 'E5'], 1, 0.74);
n(27, 2, ['E5', 'G5'], 1, 0.78);
n(27, 3, ['G5', 'B5'], 2, 0.86);
tide(28, D, 0.54);
n(28, 1, ['F#5', 'A5'], 1.5, 0.82);
n(28, 2.5, 'G5', 0.5, 0.78);
n(28, 3, ['D5', 'F#5'], 1, 0.76);
n(28, 4, 'E5', 0.5, 0.7);
n(28, 4.5, 'D5', 0.5, 0.68);

// ---- A'': the theme once more, in thirds, going out ----------------------
tide(29, EM, 0.47);
n(29, 1, ['G4', 'B4'], 1.5, 0.68);
n(29, 2.5, 'E5', 0.5, 0.7);
n(29, 3, ['B4', 'D5'], 1, 0.69);
n(29, 4, ['G4', 'B4'], 1, 0.66);
tide(30, C, 0.47);
n(30, 1, ['A4', 'C5'], 1.5, 0.68);
n(30, 2.5, 'B4', 0.5, 0.64);
n(30, 3, ['E4', 'G4'], 2, 0.62);
tide(31, G, 0.47);
n(31, 1, ['F#4', 'A4'], 1, 0.64);
n(31, 2, ['G4', 'B4'], 1, 0.67);
n(31, 3, ['B4', 'D5'], 2, 0.7);
tide(32, D_FS, 0.46);
// Sixths, not thirds: over an F# bass a G below the melody would bite.
n(32, 1, ['D4', 'B4'], 1.5, 0.66);
n(32, 2.5, 'A4', 0.5, 0.62);
n(32, 3, ['D4', 'F#4'], 2, 0.6);
tide(33, AM7, 0.46);
n(33, 1, ['C5', 'E5'], 1.5, 0.72);
n(33, 2.5, 'D5', 0.5, 0.68);
n(33, 3, ['A4', 'C5'], 1, 0.68);
n(33, 4, 'A4', 1, 0.64);
tide(34, C, 0.46);
n(34, 1, ['E4', 'G4'], 1, 0.64);
n(34, 2, ['A4', 'C5'], 1, 0.68);
n(34, 3, ['C5', 'E5'], 2, 0.72);
tide(35, BM7, 0.45);
n(35, 1, ['B4', 'D5'], 1.5, 0.7);
n(35, 2.5, 'B4', 0.5, 0.66);
n(35, 3, ['F#4', 'A4'], 2, 0.64);
tide(36, EM, 0.45);
n(36, 1, ['E4', 'G4'], 1.5, 0.64);
n(36, 2.5, 'F#4', 0.5, 0.6);
n(36, 3, ['E4', 'B4'], 2, 0.6);

// ---- Coda: the water goes quiet ------------------------------------------
tide(37, C, 0.44);
n(37, 1, 'G5', 1.5, 0.7);
n(37, 2.5, 'E5', 0.5, 0.66);
n(37, 3, 'D5', 2, 0.66);
tide(38, G_B, 0.43);
n(38, 1, 'B4', 2, 0.62);
n(38, 3, 'D5', 2, 0.64);
tide(39, AM7, 0.42);
n(39, 1, 'C5', 1.5, 0.62);
n(39, 2.5, 'B4', 0.5, 0.58);
n(39, 3, 'A4', 2, 0.58);
slack(40, BM7, 0.4);
n(40, 1, 'B4', 2, 0.6);
n(40, 3, 'A4', 2, 0.56);
slack(41, EM, 0.38);
n(41, 1, 'G4', 2, 0.56);
n(41, 3, 'F#4', 2, 0.52);
// Em add9 — the ninth left ringing on top, six beats of it.
n(42, 1, ['E2', 'B2', 'E3'], 6, 0.42);
n(42, 1, ['E4', 'G4', 'B4'], 6, 0.5);
n(42, 1, 'F#5', 6, 0.55);

export const EVENING_TIDE: LibraryTrackDef = {
  trackId: 'evening-tide',
  title: 'Evening Tide',
  composer: 'Claude Opus 5',
  folder: 'originals',
  descriptionKey: 'eveningTide',
  bpm: 66,
  timeSignature: { numerator: 4, denominator: 4 },
  // Bars 21, 25, 29, 37 and 41: poco più mosso, the climax, a tempo,
  // the coda, and the closing ritardando.
  tempoChanges: [
    [80, 72],
    [96, 76],
    [112, 66],
    [144, 60],
    [160, 52],
  ],
  quantization: '1/8',
  pedal: 'bar',
  events,
};
