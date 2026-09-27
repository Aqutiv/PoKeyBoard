import type { DrawSurface } from './drawSurface';
import { drawRestSymbol } from './glyphs/engravingGlyphs';
import type { DurationSymbol } from './quantization';

/**
 * Draw a rest centred on `x`, for a staff whose top line is at `staffTop`: the
 * music font's glyph (`glyphs/`), the same one the printed page engraves, at
 * `gap` to the staff space. `step` is the staff position the glyph is
 * registered on — 6 for the line a whole rest hangs from, 4 (the middle line)
 * for everything else. A dotted rest carries its dot in the space above. The
 * caller has set `fillStyle`.
 */
export function drawRestGlyph(
  ctx: DrawSurface,
  symbol: DurationSymbol,
  x: number,
  staffTop: number,
  step: number,
  gap: number,
): void {
  drawRestSymbol(ctx, symbol, x, staffTop, step, gap);
}
