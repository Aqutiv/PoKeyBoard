import type { RasterText, TextRasterizer } from './vectorSurface';

/**
 * The browser's own text rendering, for the rare string a standard PDF font
 * cannot set (a title in Japanese, an emoji). One canvas, created on first
 * use and reused; the text is drawn black at the resolution asked for and read
 * back as an alpha coverage image, which the PDF paints in the fill colour.
 */

/** Pixels around the measured ink, for the overhang measureText misses. */
const PAD_PX = 2;
/** The most pixels one text image may take, however large the page asks for. */
const MAX_PIXELS = 4_000_000;

const EMPTY: RasterText = {
  width: 0,
  height: 0,
  alpha: new Uint8Array(0),
  originX: 0,
  baselineY: 0,
};

export function createCanvasTextRasterizer(): TextRasterizer {
  let context: CanvasRenderingContext2D | null = null;
  const contextFor = (font: string): CanvasRenderingContext2D => {
    if (!context) {
      const canvas = document.createElement('canvas');
      context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('A 2D canvas is needed to set this text as an image');
    }
    context.font = font;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    return context;
  };

  return {
    measure(text, cssFont) {
      return contextFor(cssFont).measureText(text).width;
    },

    rasterize(text, cssFont, pxPerUnit) {
      const metrics = contextFor(cssFont).measureText(text);
      const left = Math.max(0, metrics.actualBoundingBoxLeft);
      const right = Math.max(0, metrics.actualBoundingBoxRight);
      const ascent = Math.max(0, metrics.actualBoundingBoxAscent);
      const descent = Math.max(0, metrics.actualBoundingBoxDescent);
      if (left + right <= 0 || ascent + descent <= 0) return EMPTY;

      let scale = pxPerUnit;
      const pixelsAt = (s: number): number =>
        (Math.ceil((left + right) * s) + 2 * PAD_PX) *
        (Math.ceil((ascent + descent) * s) + 2 * PAD_PX);
      if (pixelsAt(scale) > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixelsAt(scale));

      const width = Math.ceil((left + right) * scale) + 2 * PAD_PX;
      const height = Math.ceil((ascent + descent) * scale) + 2 * PAD_PX;
      const originX = PAD_PX + left * scale;
      const baselineY = PAD_PX + ascent * scale;

      const ctx = contextFor(cssFont);
      // Resizing clears the canvas and resets its state, font included.
      ctx.canvas.width = width;
      ctx.canvas.height = height;
      const drawing = contextFor(cssFont);
      drawing.fillStyle = '#000000';
      drawing.setTransform(scale, 0, 0, scale, originX, baselineY);
      drawing.fillText(text, 0, 0);
      drawing.setTransform(1, 0, 0, 1, 0, 0);

      const pixels = drawing.getImageData(0, 0, width, height).data;
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3]!;
      return scale === pxPerUnit
        ? { width, height, alpha, originX, baselineY }
        : { width, height, alpha, originX, baselineY, pxPerUnit: scale };
    },
  };
}

let shared: TextRasterizer | null = null;

/** The rasterizer every PDF page uses unless one is injected. */
export function defaultTextRasterizer(): TextRasterizer {
  shared ??= createCanvasTextRasterizer();
  return shared;
}
