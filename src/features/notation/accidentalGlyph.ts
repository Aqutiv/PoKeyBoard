import type { AccidentalKind } from './keySignature';

/**
 * Sharp, flat, natural and their doubles, drawn from paths so that no music font is needed
 * and the live score and the printed page show the same shapes. Everything
 * scales from `gap`, a staff space, and each glyph is centred on the line or
 * space its note sits on; the caller has set `fillStyle`/`strokeStyle`.
 */

/** Sharp: two thin verticals crossed by two thick slanted beams. */
function drawSharp(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  ctx.lineWidth = gap * 0.102;
  ctx.beginPath();
  ctx.moveTo(x - 0.25 * gap, y - 0.95 * gap);
  ctx.lineTo(x - 0.25 * gap, y + 1.15 * gap);
  ctx.moveTo(x + 0.25 * gap, y - 1.15 * gap);
  ctx.lineTo(x + 0.25 * gap, y + 0.95 * gap);
  ctx.stroke();
  for (const beamY of [y - 0.35 * gap, y + 0.45 * gap]) {
    ctx.beginPath();
    ctx.moveTo(x - 0.6 * gap, beamY + 0.35 * gap);
    ctx.lineTo(x + 0.6 * gap, beamY - 0.05 * gap);
    ctx.lineTo(x + 0.6 * gap, beamY - 0.45 * gap);
    ctx.lineTo(x - 0.6 * gap, beamY - 0.05 * gap);
    ctx.closePath();
    ctx.fill();
  }
}

/** Flat: a tall stem with a small bowl hung off its foot, to the right. */
function drawFlat(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  ctx.lineWidth = gap * 0.111;
  ctx.beginPath();
  ctx.moveTo(x - 0.3 * gap, y - 1.75 * gap);
  ctx.lineTo(x - 0.3 * gap, y + 0.6 * gap);
  ctx.stroke();
  // The bowl sits on the note's own line and closes back onto the stem.
  ctx.beginPath();
  ctx.moveTo(x - 0.3 * gap, y + 0.6 * gap);
  ctx.bezierCurveTo(
    x + 0.4 * gap,
    y + 0.12 * gap,
    x + 0.62 * gap,
    y - 0.5 * gap,
    x - 0.3 * gap,
    y - 0.52 * gap,
  );
  ctx.lineTo(x - 0.3 * gap, y - 0.26 * gap);
  ctx.bezierCurveTo(
    x + 0.32 * gap,
    y - 0.32 * gap,
    x + 0.14 * gap,
    y + 0.12 * gap,
    x - 0.3 * gap,
    y + 0.44 * gap,
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * Natural: two half-height verticals joined by two thick slanted beams. The
 * left one rises and the right one falls, which is what tells it from a sharp
 * at a glance.
 */
function drawNatural(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  ctx.lineWidth = gap * 0.102;
  ctx.beginPath();
  ctx.moveTo(x - 0.25 * gap, y - 1.5 * gap);
  ctx.lineTo(x - 0.25 * gap, y + 0.65 * gap);
  ctx.moveTo(x + 0.25 * gap, y - 0.65 * gap);
  ctx.lineTo(x + 0.25 * gap, y + 1.5 * gap);
  ctx.stroke();
  for (const beamY of [y - 0.45 * gap, y + 0.35 * gap]) {
    ctx.beginPath();
    ctx.moveTo(x - 0.25 * gap, beamY + 0.32 * gap);
    ctx.lineTo(x + 0.25 * gap, beamY);
    ctx.lineTo(x + 0.25 * gap, beamY - 0.32 * gap);
    ctx.lineTo(x - 0.25 * gap, beamY);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Double sharp: a small saltire with square ends, a space tall — much smaller
 * than a sharp, which is how it is told from one at a glance.
 */
function drawDoubleSharp(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  const arm = 0.36 * gap;
  ctx.lineWidth = gap * 0.15;
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
  const corner = 0.16 * gap;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    ctx.fillRect(x + dx * arm - corner, y + dy * arm - corner, 2 * corner, 2 * corner);
  }
}

/** Double flat: two flats side by side, drawn a little closer than two would sit. */
function drawDoubleFlat(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  drawFlat(ctx, x - 0.27 * gap, y, gap);
  drawFlat(ctx, x + 0.27 * gap, y, gap);
}

export function drawAccidentalGlyph(
  ctx: CanvasRenderingContext2D,
  kind: AccidentalKind,
  x: number,
  y: number,
  gap: number,
): void {
  if (kind === '#') drawSharp(ctx, x, y, gap);
  else if (kind === 'b') drawFlat(ctx, x, y, gap);
  else if (kind === 'x') drawDoubleSharp(ctx, x, y, gap);
  else if (kind === 'bb') drawDoubleFlat(ctx, x, y, gap);
  else drawNatural(ctx, x, y, gap);
}
