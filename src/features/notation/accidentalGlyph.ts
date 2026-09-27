import type { DrawSurface } from './drawSurface';
import { drawAccidentalCentred } from './glyphs/engravingGlyphs';
import type { AccidentalKind } from './keySignature';

/**
 * Sharp, flat, natural and their doubles: the music font's glyphs
 * (`glyphs/`), the same ones the printed page engraves. Everything scales
 * from `gap`, a staff space; the glyph's ink is centred on `x` and it stands
 * on `y`, the line or space its note sits on. The caller has set `fillStyle`.
 *
 * The live score draws a key signature's accidentals and a chord's through
 * here. A chord's are right-aligned, so it works out each one's centre from
 * where its ink has to end.
 */
export function drawAccidentalGlyph(
  ctx: DrawSurface,
  kind: AccidentalKind,
  x: number,
  y: number,
  gap: number,
): void {
  drawAccidentalCentred(ctx, kind, x, y, gap);
}
