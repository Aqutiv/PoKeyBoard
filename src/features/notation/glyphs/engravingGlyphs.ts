import { STEM_LENGTH_G } from '../beamGeometry';
import type { DrawSurface } from '../drawSurface';
import type { DynamicMark } from '../dynamics';
import type { AccidentalKind } from '../keySignature';
import type { BeamCount, DurationSymbol } from '../quantization';
import type { ClefKind } from '../staffMapping';
import { drawGlyph } from './drawGlyph';
import {
  ENGRAVING_DEFAULTS,
  MUSIC_GLYPH_ANCHORS,
  MUSIC_GLYPH_METRICS,
  type MusicGlyphName,
} from './musicGlyphMetrics';

/**
 * Which music glyph engraves what, and the arithmetic of setting one against
 * another: how wide a glyph is, where its middle is, how far a run of them
 * advances, how long a flagged stem must be to meet its flag. Everything is in
 * staff spaces, measured from the glyph's SMuFL origin (`drawGlyph`), so it
 * serves any scale — points on paper, pixels on screen.
 */

type DurationBase = DurationSymbol['base'];

// ---------------------------------------------------------------- lookups --

export function noteheadGlyphFor(base: DurationBase): MusicGlyphName {
  if (base === 'whole') return 'noteheadWhole';
  return base === 'half' ? 'noteheadHalf' : 'noteheadBlack';
}

export const ACCIDENTAL_GLYPHS: Readonly<Record<AccidentalKind, MusicGlyphName>> = {
  '#': 'accidentalSharp',
  b: 'accidentalFlat',
  natural: 'accidentalNatural',
  x: 'accidentalDoubleSharp',
  bb: 'accidentalDoubleFlat',
};

const REST_GLYPHS: Readonly<Record<DurationBase, MusicGlyphName>> = {
  whole: 'restWhole',
  half: 'restHalf',
  quarter: 'restQuarter',
  eighth: 'rest8th',
  sixteenth: 'rest16th',
  '32nd': 'rest32nd',
  '64th': 'rest64th',
};

export function restGlyphFor(base: DurationBase): MusicGlyphName {
  return REST_GLYPHS[base];
}

/** Every dynamic the sheet writes is one glyph, its letters set as the font kerns them. */
export const DYNAMIC_GLYPHS = {
  ppp: 'dynamicPPP',
  pp: 'dynamicPP',
  p: 'dynamicPiano',
  mp: 'dynamicMP',
  mf: 'dynamicMF',
  f: 'dynamicForte',
  ff: 'dynamicFF',
  fff: 'dynamicFFF',
} as const satisfies Readonly<Record<DynamicMark, MusicGlyphName>>;

/**
 * How far right of its origin a dynamic reads as centred under a note, in
 * staff spaces: SMuFL's optical centre, which the font places by eye rather
 * than halfway across the ink.
 */
export function dynamicOpticalCentre(mark: DynamicMark): number {
  return MUSIC_GLYPH_ANCHORS[DYNAMIC_GLYPHS[mark]].opticalCenter[0];
}

/**
 * The clef glyph for a staff: full size where a system opens, and the smaller
 * change glyph where one turns over inside the staff. A G clef is placed on
 * its G line and an F clef on its F line.
 */
export function clefGlyphFor(clef: ClefKind, change: boolean): MusicGlyphName {
  if (clef === 'treble') return change ? 'gClefChange' : 'gClef';
  return change ? 'fClefChange' : 'fClef';
}

export type DigitStyle = 'timeSig' | 'tuplet';

const DIGITS: Readonly<Record<DigitStyle, readonly MusicGlyphName[]>> = {
  timeSig: [
    'timeSig0',
    'timeSig1',
    'timeSig2',
    'timeSig3',
    'timeSig4',
    'timeSig5',
    'timeSig6',
    'timeSig7',
    'timeSig8',
    'timeSig9',
  ],
  tuplet: [
    'tuplet0',
    'tuplet1',
    'tuplet2',
    'tuplet3',
    'tuplet4',
    'tuplet5',
    'tuplet6',
    'tuplet7',
    'tuplet8',
    'tuplet9',
  ],
};

/** The digit glyphs that write a whole number, most significant first. */
export function digitGlyphsFor(style: DigitStyle, value: number): MusicGlyphName[] {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`Only a whole number can be written in digits, not ${value}`);
  }
  return Array.from(String(value), (digit) => DIGITS[style][Number(digit)]!);
}

// ------------------------------------------------------------------ maths --

/** How wide a glyph's ink is, in staff spaces. */
export function glyphWidth(name: MusicGlyphName): number {
  const [left, , right] = MUSIC_GLYPH_METRICS[name].bbox;
  return right - left;
}

/** The middle of a glyph's ink, right of its origin, in staff spaces. */
export function glyphCentre(name: MusicGlyphName): number {
  const [left, , right] = MUSIC_GLYPH_METRICS[name].bbox;
  return (left + right) / 2;
}

/** How far a run of glyphs set side by side advances, in staff spaces. */
export function runAdvance(names: readonly MusicGlyphName[]): number {
  let advance = 0;
  for (const name of names) advance += MUSIC_GLYPH_METRICS[name].advance;
  return advance;
}

/** Half a notehead's width: from its centre to its edge, in staff spaces. */
export function noteheadHalfWidth(base: DurationBase): number {
  return glyphWidth(noteheadGlyphFor(base)) / 2;
}

/** A stem's thickness, in staff spaces. */
export const STEM_THICKNESS_G = ENGRAVING_DEFAULTS.stemThickness;

/**
 * How far a head moves to clear a second. Heads either side of a stem both
 * overlap it, so they sit a head's width less a stem apart; a whole note has no
 * stem, and its heads sit edge to edge.
 */
export function secondShiftG(base: DurationBase): number {
  const width = glyphWidth(noteheadGlyphFor(base));
  return base === 'whole' ? width : width - STEM_THICKNESS_G;
}

/**
 * How far along the stem, from the far head's centre, the stem starts: the
 * height of the notehead's stem anchor, so it meets the head's edge cleanly.
 */
export const STEM_ANCHOR_RISE_G = MUSIC_GLYPH_ANCHORS.noteheadBlack.stemUpSE[1];

const FLAGS: Readonly<
  Record<BeamCount, Readonly<Record<'up' | 'down', { glyph: MusicGlyphName; anchorY: number }>>>
> = {
  1: {
    up: { glyph: 'flag8thUp', anchorY: MUSIC_GLYPH_ANCHORS.flag8thUp.stemUpNW[1] },
    down: { glyph: 'flag8thDown', anchorY: MUSIC_GLYPH_ANCHORS.flag8thDown.stemDownSW[1] },
  },
  2: {
    up: { glyph: 'flag16thUp', anchorY: MUSIC_GLYPH_ANCHORS.flag16thUp.stemUpNW[1] },
    down: { glyph: 'flag16thDown', anchorY: MUSIC_GLYPH_ANCHORS.flag16thDown.stemDownSW[1] },
  },
  3: {
    up: { glyph: 'flag32ndUp', anchorY: MUSIC_GLYPH_ANCHORS.flag32ndUp.stemUpNW[1] },
    down: { glyph: 'flag32ndDown', anchorY: MUSIC_GLYPH_ANCHORS.flag32ndDown.stemDownSW[1] },
  },
  4: {
    up: { glyph: 'flag64thUp', anchorY: MUSIC_GLYPH_ANCHORS.flag64thUp.stemUpNW[1] },
    down: { glyph: 'flag64thDown', anchorY: MUSIC_GLYPH_ANCHORS.flag64thDown.stemDownSW[1] },
  },
};

function flagOf(count: BeamCount, stemDown: boolean) {
  return FLAGS[count][stemDown ? 'down' : 'up'];
}

/** The one glyph that carries all of a lone note's flags. */
export function flagGlyphFor(count: BeamCount, stemDown: boolean): MusicGlyphName {
  return flagOf(count, stemDown).glyph;
}

/**
 * The flag's stem anchor, y up from its origin: how much further than the
 * nominal 3.5 spaces the stem has to run to meet the flag cleanly. SMuFL sets
 * a flag's origin at the end of a stem of normal length, on the stem's left
 * edge, and says through this anchor where the stem should really end.
 */
export function flagAnchorYG(count: BeamCount, stemDown: boolean): number {
  return flagOf(count, stemDown).anchorY;
}

/**
 * How long an unbeamed stem is, from its note's centre, in staff spaces: the
 * usual 3.5, lengthened wherever the flag's anchor asks for more — a 32nd's and
 * a 64th's flags stack up past the normal end — and never shortened.
 */
export function flaggedStemG(count: BeamCount | 0, stemDown: boolean): number {
  if (count === 0) return STEM_LENGTH_G;
  const anchorY = flagAnchorYG(count, stemDown);
  return STEM_LENGTH_G + Math.max(0, stemDown ? -anchorY : anchorY);
}

/**
 * How far an unbeamed stem and its flag reach from the note's centre, in
 * staff spaces: the stem, or the flag's ink where it runs past the stem's end.
 */
export function flaggedStemReachG(count: BeamCount | 0, stemDown: boolean): number {
  const stem = flaggedStemG(count, stemDown);
  if (count === 0) return stem;
  const { glyph, anchorY } = flagOf(count, stemDown);
  const [, bottom, , top] = MUSIC_GLYPH_METRICS[glyph].bbox;
  // The flag's origin sits `anchorY` short of the stem's end.
  const ink = stemDown ? stem + anchorY - bottom : stem - anchorY + top;
  return Math.max(stem, ink);
}

// ---------------------------------------------------------------- drawing --

/**
 * An accidental with its ink centred on `x` and its origin on `y` — the line
 * or space of the note it alters — at `gap` to the staff space.
 */
export function drawAccidentalCentred(
  ctx: DrawSurface,
  kind: AccidentalKind,
  x: number,
  y: number,
  gap: number,
): void {
  const name = ACCIDENTAL_GLYPHS[kind];
  drawGlyph(ctx, name, x - glyphCentre(name) * gap, y, gap);
}

/** An accidental whose ink ends at `right`, as one standing before a chord is set. */
export function drawAccidentalEndingAt(
  ctx: DrawSurface,
  kind: AccidentalKind,
  right: number,
  y: number,
  gap: number,
): void {
  const name = ACCIDENTAL_GLYPHS[kind];
  drawGlyph(ctx, name, right - MUSIC_GLYPH_METRICS[name].bbox[2] * gap, y, gap);
}

/** Clear space between a rest's ink and its dot, in staff spaces. */
const REST_DOT_GAP_G = 0.3;

/**
 * A rest with its ink centred on `x`, for a staff whose top line is at
 * `staffTop`, at `gap` to the staff space. `step` is the staff position the
 * glyph is registered on — 6, the line a whole rest hangs from, or the middle
 * line (4) for the others, which is where SMuFL's own registration puts them.
 * A dotted rest carries its dot in the space above.
 */
export function drawRestSymbol(
  ctx: DrawSurface,
  symbol: DurationSymbol,
  x: number,
  staffTop: number,
  step: number,
  gap: number,
): void {
  const name = restGlyphFor(symbol.base);
  const y = staffTop + 4 * gap - (step * gap) / 2;
  drawGlyph(ctx, name, x - glyphCentre(name) * gap, y, gap);
  if (symbol.dotted) {
    const right = x + (glyphWidth(name) / 2) * gap;
    drawGlyph(ctx, 'augmentationDot', right + REST_DOT_GAP_G * gap, y - 0.5 * gap, gap);
  }
}

/**
 * A whole number in digit glyphs — a time signature's, or a tuplet's — laid
 * side by side by their advances and centred on `centreX`, their origins on
 * `y`: the middle of the digits for a time signature, their foot for a tuplet.
 */
export function drawDigitRun(
  ctx: DrawSurface,
  style: DigitStyle,
  value: number,
  centreX: number,
  y: number,
  space: number,
): void {
  const digits = digitGlyphsFor(style, value);
  let x = centreX - (runAdvance(digits) * space) / 2;
  for (const digit of digits) {
    drawGlyph(ctx, digit, x, y, space);
    x += MUSIC_GLYPH_METRICS[digit].advance * space;
  }
}
