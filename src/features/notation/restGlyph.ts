import type { DurationSymbol } from './quantization';

/**
 * The rest glyphs, drawn from paths so that no music font is needed and the
 * live score and the printed page show the same shapes. Both renderers scale
 * everything from their own staff space, so one set of proportions serves both:
 * `gap` is a staff space, `staffTop` the staff's top line, and the caller has
 * already set `fillStyle`/`strokeStyle`.
 */

/** y of a staff step relative to the staff's top line (down is +). */
function yFor(step: number, gap: number): number {
  return 4 * gap - (step * gap) / 2;
}

/** Whole and half rests are the same block, one hanging and one sitting. */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  lineY: number,
  gap: number,
  hanging: boolean,
): void {
  const w = 1.1 * gap;
  const h = 0.55 * gap;
  ctx.fillRect(x - w / 2, hanging ? lineY : lineY - h, w, h);
}

/** Quarter rest: the four-stroke zigzag, ending in a hook toward the stem side. */
function drawQuarter(ctx: CanvasRenderingContext2D, x: number, midY: number, gap: number): void {
  const u = gap * 0.5; // half a space, the zigzag's step
  ctx.beginPath();
  ctx.moveTo(x - 0.5 * u, midY - 3 * u);
  ctx.lineTo(x + 0.9 * u, midY - 1.3 * u);
  ctx.lineTo(x - 0.6 * u, midY + 0.2 * u);
  ctx.lineTo(x + 1.0 * u, midY + 1.9 * u);
  // The hook curls back on itself under the last stroke.
  ctx.lineTo(x + 0.2 * u, midY + 1.35 * u);
  ctx.bezierCurveTo(
    x - 1.3 * u,
    midY + 1.1 * u,
    x - 0.9 * u,
    midY + 3.1 * u,
    x + 0.55 * u,
    midY + 3.2 * u,
  );
  ctx.bezierCurveTo(
    x - 0.5 * u,
    midY + 2.2 * u,
    x + 0.1 * u,
    midY + 1.6 * u,
    x - 0.15 * u,
    midY + 1.2 * u,
  );
  ctx.lineTo(x - 1.15 * u, midY + 0.05 * u);
  ctx.lineTo(x + 0.35 * u, midY - 1.4 * u);
  ctx.lineTo(x - 1.0 * u, midY - 3 * u);
  ctx.closePath();
  ctx.fill();
}

/**
 * The rests from an eighth down: a slanted stroke carrying one hook per flag,
 * each hook a filled blob on the left of the stroke. The stroke leans the same
 * way whatever the value, and each shorter one starts a space higher to carry
 * the hook it has gained. Past two hooks the stroke also drops a little, so a
 * 64th rest stays roughly centred on the staff rather than climbing out of it —
 * the eighth and the sixteenth are untouched by that and read exactly as before.
 */
function drawHooked(
  ctx: CanvasRenderingContext2D,
  x: number,
  midY: number,
  gap: number,
  hooks: 1 | 2 | 3 | 4,
): void {
  const drop = Math.max(0, hooks - 2) * 0.5;
  const topY = midY - (0.6 + (hooks - 1) - drop) * gap;
  const bottomY = midY + (1.5 + drop) * gap;
  const topX = x + 0.45 * gap;

  ctx.lineWidth = Math.max(0.7, gap * 0.13);
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.lineTo(x - 0.5 * gap, bottomY);
  ctx.stroke();

  for (let i = 0; i < hooks; i += 1) {
    const hookY = topY + i * gap;
    ctx.beginPath();
    ctx.arc(topX - 0.16 * gap, hookY, 0.22 * gap, 0, Math.PI * 2);
    ctx.fill();
    // The hook sweeps left off the stroke and tapers back into it.
    ctx.beginPath();
    ctx.moveTo(topX - 0.1 * gap, hookY - 0.2 * gap);
    ctx.bezierCurveTo(
      topX - 0.9 * gap,
      hookY + 0.15 * gap,
      topX - 1.15 * gap,
      hookY + 0.5 * gap,
      topX - 0.95 * gap,
      hookY + 0.75 * gap,
    );
    ctx.bezierCurveTo(
      topX - 1.0 * gap,
      hookY + 0.25 * gap,
      topX - 0.55 * gap,
      hookY + 0.1 * gap,
      topX - 0.05 * gap,
      hookY + 0.12 * gap,
    );
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw a rest centred on `x`, for a staff whose top line is at `staffTop`.
 * `step` is where the glyph is read from — 6 for the line a whole rest hangs
 * under, 4 (the middle line) for everything else.
 */
export function drawRestGlyph(
  ctx: CanvasRenderingContext2D,
  symbol: DurationSymbol,
  x: number,
  staffTop: number,
  step: number,
  gap: number,
): void {
  const y = staffTop + yFor(step, gap);
  switch (symbol.base) {
    case 'whole':
      drawBlock(ctx, x, y, gap, true);
      break;
    case 'half':
      drawBlock(ctx, x, y, gap, false);
      break;
    case 'quarter':
      drawQuarter(ctx, x, y, gap);
      break;
    case 'eighth':
      drawHooked(ctx, x, y, gap, 1);
      break;
    case '32nd':
      drawHooked(ctx, x, y, gap, 3);
      break;
    case '64th':
      drawHooked(ctx, x, y, gap, 4);
      break;
    default:
      drawHooked(ctx, x, y, gap, 2);
      break;
  }
  if (symbol.dotted) {
    // The dot sits in the space above the middle line, clear of the glyph.
    ctx.beginPath();
    ctx.arc(x + 1.05 * gap, y - 0.5 * gap, 0.16 * gap, 0, Math.PI * 2);
    ctx.fill();
  }
}
