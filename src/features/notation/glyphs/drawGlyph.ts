import type { DrawSurface } from '../drawSurface';
import {
  decodeGlyphOutline,
  GLYPH_CURVE,
  GLYPH_LINE,
  GLYPH_MOVE,
  type GlyphOutline,
} from './glyphOutline';
import { GLYPH_UNITS_PER_SPACE, type MusicGlyphName } from './musicGlyphMetrics';
import { MUSIC_GLYPH_OUTLINES } from './musicGlyphOutlines';

/**
 * Draws the music glyphs of `musicGlyphOutlines.ts` onto any `DrawSurface`.
 *
 * A glyph is placed by its SMuFL origin — the point its metrics are measured
 * from — and sized by the staff space it is drawn to: `space` surface units to
 * the staff space across, and `spaceY` up and down, which differ only where a
 * glyph is stretched to fit (the brace). The surface's y points down, the
 * font's up, so the outline is turned over on the way.
 *
 * On a canvas the outline is replayed as one path — `beginPath`, the moves,
 * lines and curves, then a single `fill()` with the nonzero rule, as a font
 * renderer fills it — so the glyph takes whatever colour the caller set and
 * leaves no state behind: no `fillStyle`, no transform, no `Path2D` (jsdom has
 * none). A surface with `fillGlyph` gets the whole glyph in one call instead,
 * which lets the PDF and SVG writers store each glyph once and point at it.
 */

/** Each glyph decoded the first time it is drawn, then kept. */
const decoded = new Map<MusicGlyphName, GlyphOutline>();

/** A glyph's outline, decoded once and shared by every drawing of it. */
export function glyphOutline(name: MusicGlyphName): GlyphOutline {
  let outline = decoded.get(name);
  if (!outline) {
    outline = decodeGlyphOutline(MUSIC_GLYPH_OUTLINES[name]);
    decoded.set(name, outline);
  }
  return outline;
}

/**
 * Fill glyph `name` with its origin at (`x`, `y`), a staff space being `space`
 * surface units across and `spaceY` (by default the same) up and down.
 */
export function drawGlyph(
  ctx: DrawSurface,
  name: MusicGlyphName,
  x: number,
  y: number,
  space: number,
  spaceY: number = space,
): void {
  const outline = glyphOutline(name);
  const kx = space / GLYPH_UNITS_PER_SPACE;
  const ky = spaceY / GLYPH_UNITS_PER_SPACE;
  if (ctx.fillGlyph) {
    ctx.fillGlyph(name, outline, [kx, 0, 0, -ky, x, y]);
    return;
  }

  const { ops, xy } = outline;
  const px = (i: number): number => x + xy[i]! * kx;
  const py = (i: number): number => y - xy[i + 1]! * ky;
  ctx.beginPath();
  let p = 0;
  for (const op of ops) {
    if (op === GLYPH_MOVE) {
      ctx.moveTo(px(p), py(p));
      p += 2;
    } else if (op === GLYPH_LINE) {
      ctx.lineTo(px(p), py(p));
      p += 2;
    } else if (op === GLYPH_CURVE) {
      ctx.bezierCurveTo(px(p), py(p), px(p + 2), py(p + 2), px(p + 4), py(p + 4));
      p += 6;
    } else {
      ctx.closePath();
    }
  }
  ctx.fill();
}
