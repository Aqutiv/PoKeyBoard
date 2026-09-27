import type { DrawSurface } from './drawSurface';
import { drawGlyph } from './glyphs/drawGlyph';
import { ACCIDENTAL_GLYPHS } from './glyphs/engravingGlyphs';
import { MUSIC_GLYPH_METRICS } from './glyphs/musicGlyphMetrics';
import type { AccidentalKind } from './keySignature';

/**
 * Text on the printed sheet that can carry accidentals — a title such as
 * "Nocturne in E♭ major". The signs are the music font's accidental glyphs,
 * the ones the staves carry, rather than characters from a text font: Times
 * has no ♭ to set in a PDF, and a browser falls back to whatever font it finds,
 * so the preview and the page would disagree. Drawn this way both show the
 * same sign, sized from the text around it.
 */

export type RichRun =
  { kind: 'text'; text: string } | { kind: 'accidental'; accidental: AccidentalKind };

const SIGNS: Record<string, AccidentalKind> = {
  '♭': 'b',
  '♯': '#',
  '♮': 'natural',
  '\u{1d12a}': 'x',
  '\u{1d12b}': 'bb',
};

/** Emoji and text presentation selectors, which mean nothing to a drawn sign. */
const PRESENTATION_SELECTORS = new Set(['\ufe0e', '\ufe0f']);

/** Split text into runs of plain text and the accidental signs between them. */
export function splitRich(text: string): RichRun[] {
  const runs: RichRun[] = [];
  let pending = '';
  let afterSign = false;
  for (const character of text) {
    const accidental = SIGNS[character];
    if (accidental) {
      if (pending) runs.push({ kind: 'text', text: pending });
      pending = '';
      runs.push({ kind: 'accidental', accidental });
      afterSign = true;
      continue;
    }
    if (!(afterSign && PRESENTATION_SELECTORS.has(character))) pending += character;
    afterSign = false;
  }
  if (pending) runs.push({ kind: 'text', text: pending });
  return runs;
}

/**
 * Where a sign's ink reaches from its glyph's origin, in staff spaces, y up:
 * the glyph's bounding box.
 */
function inkOf(kind: AccidentalKind): { left: number; right: number; bottom: number } {
  const [left, bottom, right] = MUSIC_GLYPH_METRICS[ACCIDENTAL_GLYPHS[kind]].bbox;
  return { left, right, bottom };
}

/** Clear space either side of a sign, as a fraction of the font size. */
const SIDE_BEARING_EM = 0.08;

/**
 * A sign's staff space: a quarter of the font size — the em of a music font is
 * four staff spaces — so it stands about as tall as a capital.
 */
function gapFor(fontPx: number): number {
  return fontPx / 4;
}

/** How far a sign advances the text, bearings included. */
export function accidentalRunWidth(kind: AccidentalKind, fontPx: number): number {
  const ink = inkOf(kind);
  return 2 * SIDE_BEARING_EM * fontPx + (ink.right - ink.left) * gapFor(fontPx);
}

function measureRuns(ctx: DrawSurface, runs: readonly RichRun[], fontPx: number): number {
  let width = 0;
  for (const run of runs) {
    width +=
      run.kind === 'text'
        ? ctx.measureText(run.text).width
        : accidentalRunWidth(run.accidental, fontPx);
  }
  return width;
}

/** The width `fillRich` takes to draw `text` in the surface's current font. */
export function measureRich(ctx: DrawSurface, text: string, fontPx: number): number {
  return measureRuns(ctx, splitRich(text), fontPx);
}

/**
 * Draw `text` at `x` on the baseline `y`, honouring the surface's `textAlign`
 * for the whole line: the runs go down left to right from where the alignment
 * puts it, and the alignment is left as it was found. `fontPx` is the size the
 * surface's font is set at, which the signs are drawn to.
 */
export function fillRich(
  ctx: DrawSurface,
  text: string,
  x: number,
  y: number,
  fontPx: number,
): void {
  const runs = splitRich(text);
  const align = ctx.textAlign;
  const width = measureRuns(ctx, runs, fontPx);
  let cursor =
    align === 'center' ? x - width / 2 : align === 'right' || align === 'end' ? x - width : x;
  const gap = gapFor(fontPx);
  ctx.textAlign = 'left';
  for (const run of runs) {
    if (run.kind === 'text') {
      ctx.fillText(run.text, cursor, y);
      cursor += ctx.measureText(run.text).width;
      continue;
    }
    // The sign's ink starts after its bearing and stands on the baseline.
    const ink = inkOf(run.accidental);
    drawGlyph(
      ctx,
      ACCIDENTAL_GLYPHS[run.accidental],
      cursor + SIDE_BEARING_EM * fontPx - ink.left * gap,
      y + ink.bottom * gap,
      gap,
    );
    cursor += accidentalRunWidth(run.accidental, fontPx);
  }
  ctx.textAlign = align;
}

/** The user-perceived characters of `text`, so a cut never lands inside one. */
function graphemesOf(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/**
 * `text` as it is, when it fits in `maxWidth`, or cut short with an ellipsis.
 * The cut falls between whole graphemes, so it never splits a surrogate pair, a
 * joined emoji or a sign; at least one grapheme is kept.
 */
export function ellipsizeRich(
  ctx: DrawSurface,
  text: string,
  maxWidth: number,
  fontPx: number,
): string {
  if (measureRich(ctx, text, fontPx) <= maxWidth) return text;
  const graphemes = graphemesOf(text);
  let count = graphemes.length;
  while (
    count > 1 &&
    measureRich(ctx, `${graphemes.slice(0, count).join('')}…`, fontPx) > maxWidth
  ) {
    count -= 1;
  }
  return `${graphemes.slice(0, count).join('')}…`;
}
