import type { DrawSurface } from '@/features/notation/drawSurface';
import {
  COORD_DECIMALS,
  colorToHex,
  formatNumber,
  LENGTH_DECIMALS,
  MATRIX_DECIMALS,
  VectorSurface,
  type FontFaceKey,
  type FontProvider,
  type ImagePaint,
  type Matrix,
  type PaintSink,
  type PathCommand,
  type RgbColor,
  type StrokePaint,
  type TextPaint,
  type TextRasterizer,
} from './vectorSurface';

/**
 * The sheet goldens' writer: what a `VectorSurface` paints, as an SVG a person
 * can open and a test can diff. Test-only — no app code imports it, so it is
 * never bundled.
 *
 * It sees exactly what the PDF writer sees, and writes it the same way: paths
 * already flattened to M, L, C and Z in page space and rounded to 0.01, strokes
 * with the widths and dashes the transform left them, text at the x its
 * alignment put it, set in Times. A string that would be an image in the PDF is
 * a `<rect data-raster-text>` of the image's box. One element per line, and
 * nothing that varies from run to run, so a golden changes only when the page
 * does.
 */

const WEIGHT: Record<FontFaceKey, string> = {
  regular: 'normal',
  bold: 'bold',
  italic: 'normal',
  boldItalic: 'bold',
};

const STYLE: Record<FontFaceKey, string> = {
  regular: 'normal',
  bold: 'normal',
  italic: 'italic',
  boldItalic: 'italic',
};

function coord(value: number): string {
  return formatNumber(value, COORD_DECIMALS);
}

function length(value: number): string {
  return formatNumber(value, LENGTH_DECIMALS);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAxisAligned(m: Matrix): boolean {
  return m[1] === 0 && m[2] === 0;
}

function matrixAttribute(m: Matrix): string {
  const linear = [m[0], m[1], m[2], m[3]].map((v) => formatNumber(v, MATRIX_DECIMALS));
  return `matrix(${[...linear, coord(m[4]), coord(m[5])].join(' ')})`;
}

class SvgWriter implements PaintSink {
  readonly lines: string[] = [];

  fillPath(path: readonly PathCommand[], color: RgbColor): void {
    this.lines.push(`<path d="${pathData(path)}" fill="${colorToHex(color)}"/>`);
  }

  strokePath(path: readonly PathCommand[], stroke: StrokePaint): void {
    const extras = [
      stroke.dash.length > 0 ? ` stroke-dasharray="${stroke.dash.map(length).join(' ')}"` : '',
      stroke.cap !== 'butt' ? ` stroke-linecap="${stroke.cap}"` : '',
    ].join('');
    this.lines.push(
      `<path d="${pathData(path)}" fill="none" stroke="${colorToHex(stroke.color)}" stroke-width="${length(stroke.width)}"${extras}/>`,
    );
  }

  fillText(paint: TextPaint): void {
    const m = paint.matrix;
    const place =
      m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1
        ? `x="${coord(m[4])}" y="${coord(m[5])}"`
        : `transform="${matrixAttribute(m)}"`;
    this.lines.push(
      `<text ${place} font-family="Times" font-size="${length(paint.size)}" font-weight="${WEIGHT[paint.face]}" font-style="${STYLE[paint.face]}" fill="${colorToHex(paint.color)}" xml:space="preserve">${escapeXml(paint.text)}</text>`,
    );
  }

  fillImage(paint: ImagePaint): void {
    const m = paint.matrix;
    const text = escapeXml(paint.text);
    const fill = colorToHex(paint.color);
    if (isAxisAligned(m)) {
      // The unit square's corners, (0, 0) and (1, 1), wherever they landed.
      const [x0, x1] = [m[4], m[4] + m[0]].sort((a, b) => a - b) as [number, number];
      const [y0, y1] = [m[5], m[5] + m[3]].sort((a, b) => a - b) as [number, number];
      this.lines.push(
        `<rect data-raster-text="${text}" x="${coord(x0)}" y="${coord(y0)}" width="${coord(x1 - x0)}" height="${coord(y1 - y0)}" fill="${fill}"/>`,
      );
      return;
    }
    this.lines.push(
      `<rect data-raster-text="${text}" width="1" height="1" transform="${matrixAttribute(m)}" fill="${fill}"/>`,
    );
  }
}

function pathData(path: readonly PathCommand[]): string {
  return path
    .map((command) => {
      switch (command.op) {
        case 'M':
          return `M${coord(command.x)} ${coord(command.y)}`;
        case 'L':
          return `L${coord(command.x)} ${coord(command.y)}`;
        case 'C':
          return `C${coord(command.x1)} ${coord(command.y1)} ${coord(command.x2)} ${coord(command.y2)} ${coord(command.x)} ${coord(command.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

export interface SvgPageOptions {
  /** Page size in points. */
  width: number;
  height: number;
  /** Metrics to set text with: pass the PDF's own fonts so widths match it. */
  fonts: FontProvider;
  rasterizer: TextRasterizer;
}

export interface SvgPageSurface {
  readonly surface: DrawSurface;
  /** The finished SVG document. */
  finish(): string;
}

/** Start an SVG page: draw onto `surface`, then take the document from `finish`. */
export function beginSvgPage(options: SvgPageOptions): SvgPageSurface {
  const writer = new SvgWriter();
  const surface = new VectorSurface({
    sink: writer,
    fonts: options.fonts,
    rasterizer: options.rasterizer,
  });
  const width = coord(options.width);
  const height = coord(options.height);
  return {
    surface,
    finish: () =>
      [
        // A canvas and a PDF both miter up to ten line widths; SVG defaults to four.
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}pt" height="${height}pt" viewBox="0 0 ${width} ${height}" stroke-miterlimit="10">`,
        ...writer.lines,
        '</svg>',
        '',
      ].join('\n'),
  };
}
