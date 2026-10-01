import type { WaterfallBar, WaterfallMarker, WaterfallScene } from './waterfallLayout';
import { barColour, type WaterfallPalette } from './waterfallPalette';

/** The part of a 2D context the painter draws with; tests record it instead. */
export type WaterfallSurface = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'setLineDash'
  | 'save'
  | 'restore'
>;

export interface WaterfallPaint {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly palette: WaterfallPalette;
  /** Shade each bar by its note's velocity, as `velocityShading` lights the keys. */
  readonly followsVelocity: boolean;
}

/** A bar's corners: round enough to read as a note, never more than a quarter of its width. */
const BAR_RADIUS_PX = 4;
/** An outline needs room inside it, or it only darkens the whole bar. */
const MIN_OUTLINED_PX = 3;
const MARKER_WIDTH_PX = 4;
/** A mark this tall has room for a chevron pointing off the key bed. */
const CHEVRON_MIN_PX = 8;
const RESTART_DASH = [6, 5];

/**
 * A rectangle with its top corners rounded by `top` and its bottom ones by
 * `bottom`. `arcTo` rather than `roundRect`, which older Safari lacks.
 */
function roundedRect(
  ctx: WaterfallSurface,
  x: number,
  y: number,
  width: number,
  height: number,
  top: number,
  bottom: number,
): void {
  const right = x + width;
  const foot = y + height;
  ctx.beginPath();
  ctx.moveTo(x + top, y);
  ctx.lineTo(right - top, y);
  if (top > 0) ctx.arcTo(right, y, right, y + top, top);
  ctx.lineTo(right, foot - bottom);
  if (bottom > 0) ctx.arcTo(right, foot, right - bottom, foot, bottom);
  ctx.lineTo(x + bottom, foot);
  if (bottom > 0) ctx.arcTo(x, foot, x, foot - bottom, bottom);
  ctx.lineTo(x, y + top);
  if (top > 0) ctx.arcTo(x, y, x + top, y, top);
  ctx.closePath();
}

/** The bar's outline, half a pixel in, so it lands crisply on whole pixels. */
function outline(ctx: WaterfallSurface, bar: WaterfallBar, top: number, bottom: number): void {
  const height = bar.bottom - bar.top;
  roundedRect(
    ctx,
    bar.x + 0.5,
    bar.top + 0.5,
    bar.width - 1,
    height - 1,
    Math.max(0, top - 0.5),
    Math.max(0, bottom - 0.5),
  );
}

/** How round each end of a bar is: only an end that is the note's own is rounded. */
function radii(bar: WaterfallBar): [number, number] {
  const radius = Math.max(0, Math.min(BAR_RADIUS_PX, bar.width / 4, (bar.bottom - bar.top) / 2));
  return [bar.cutTop ? 0 : radius, bar.cutBottom ? 0 : radius];
}

function drawBar(ctx: WaterfallSurface, bar: WaterfallBar, paint: WaterfallPaint): void {
  const { palette, followsVelocity } = paint;
  const [top, bottom] = radii(bar);
  roundedRect(ctx, bar.x, bar.top, bar.width, bar.bottom - bar.top, top, bottom);
  ctx.fillStyle = barColour(palette, bar.hand, bar.black, bar.note.velocity, followsVelocity);
  ctx.fill();
  if (bar.bottom - bar.top <= MIN_OUTLINED_PX || bar.width <= MIN_OUTLINED_PX) return;
  outline(ctx, bar, top, bottom);
  ctx.strokeStyle = (bar.hand === 'left' ? palette.left : palette.right).edge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * A note playback does not play on this pass — written but never struck, or
 * held from before where the pass began — is only an outline.
 */
function drawHollow(ctx: WaterfallSurface, bar: WaterfallBar, paint: WaterfallPaint): void {
  const [top, bottom] = radii(bar);
  outline(ctx, bar, top, bottom);
  ctx.strokeStyle = (bar.hand === 'left' ? paint.palette.left : paint.palette.right).edge;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * A note off the key bed: a strip down that edge for as long as it lasts,
 * and a chevron pointing its way where the strip has room for one. Once the
 * note reaches the keys, the key bed's own edge glow takes over.
 */
function drawMarker(ctx: WaterfallSurface, marker: WaterfallMarker, paint: WaterfallPaint): void {
  const { palette, followsVelocity, widthPx } = paint;
  const low = marker.side === 'low';
  const height = marker.bottom - marker.top;
  ctx.fillStyle = marker.silent
    ? (marker.hand === 'left' ? palette.left : palette.right).edge
    : barColour(palette, marker.hand, false, marker.note.velocity, followsVelocity);
  ctx.fillRect(low ? 0 : widthPx - MARKER_WIDTH_PX, marker.top, MARKER_WIDTH_PX, height);
  if (height < CHEVRON_MIN_PX) return;
  const tipX = low ? MARKER_WIDTH_PX + 3 : widthPx - MARKER_WIDTH_PX - 3;
  const baseX = low ? tipX + 4 : tipX - 4;
  const y = marker.bottom - Math.min(5, height / 2);
  ctx.beginPath();
  ctx.moveTo(tipX, y);
  ctx.lineTo(baseX, y - 3.5);
  ctx.lineTo(baseX, y + 3.5);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paint `scene` in CSS pixels; the caller has already scaled the context for
 * the screen. From the bottom up: the stage, the octave guides, the lines
 * where a loop starts again, the white keys' bars, the black keys' bars, which
 * stand over them, and last the marks of notes off the key bed. Within each
 * key colour, the hollow bars of notes not played go under the played ones,
 * so a strike drawn over an outline shows whole.
 */
export function paintWaterfall(
  ctx: WaterfallSurface,
  scene: WaterfallScene,
  paint: WaterfallPaint,
): void {
  const { widthPx, heightPx, palette } = paint;
  ctx.fillStyle = palette.stage;
  ctx.fillRect(0, 0, widthPx, heightPx);

  ctx.fillStyle = palette.guide;
  for (const x of scene.octaveXs) ctx.fillRect(Math.round(x), 0, 1, heightPx);

  if (scene.restartYs.length > 0) {
    ctx.save();
    ctx.strokeStyle = palette.restart;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(RESTART_DASH);
    for (const restartY of scene.restartYs) {
      const y = Math.round(restartY) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(widthPx, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const black of [false, true]) {
    for (const bar of scene.bars)
      if (bar.black === black && bar.silent) drawHollow(ctx, bar, paint);
    for (const bar of scene.bars) if (bar.black === black && !bar.silent) drawBar(ctx, bar, paint);
  }
  for (const marker of scene.markers) drawMarker(ctx, marker, paint);
}
