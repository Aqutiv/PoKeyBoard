import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { PdfStandardFonts } from '@/features/export/pdfSurface';
import { beginSvgPage } from '@/features/export/svgSurface';
import type { TextRasterizer } from '@/features/export/vectorSurface';
import type { DrawSurface, GlyphMatrix } from '@/features/notation/drawSurface';
import { drawGlyph, glyphOutline } from '@/features/notation/glyphs/drawGlyph';
import { decodeGlyphOutline, glyphControlBox } from '@/features/notation/glyphs/glyphOutline';
import { GLYPH_UNITS_PER_SPACE } from '@/features/notation/glyphs/musicGlyphMetrics';
import { MUSIC_GLYPH_OUTLINES } from '@/features/notation/glyphs/musicGlyphOutlines';

interface Call {
  op: string;
  args: number[];
}

/** Records every call a glyph makes, and every write to the fill colour. */
class RecordingSurface implements DrawSurface {
  calls: Call[] = [];
  fillWrites = 0;
  private fill_: string | CanvasGradient | CanvasPattern = '#123456';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  font = '10px serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.fill_;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.fillWrites += 1;
    this.fill_ = value;
  }

  private record(op: string, ...args: number[]): void {
    this.calls.push({ op, args });
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  translate(x: number, y: number): void {
    this.record('translate', x, y);
  }
  rotate(angle: number): void {
    this.record('rotate', angle);
  }
  scale(x: number, y: number): void {
    this.record('scale', x, y);
  }
  beginPath(): void {
    this.record('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y);
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void {
    this.record('bezierCurveTo', a, b, c, d, x, y);
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number): void {
    this.record('quadraticCurveTo', a, b, x, y);
  }
  arc(x: number, y: number): void {
    this.record('arc', x, y);
  }
  ellipse(x: number, y: number): void {
    this.record('ellipse', x, y);
  }
  closePath(): void {
    this.record('closePath');
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', x, y, w, h);
  }
  fillText(): void {
    this.record('fillText');
  }
  measureText(): { readonly width: number } {
    return { width: 0 };
  }
  setLineDash(): void {
    this.record('setLineDash');
  }

  /** Every point the path went through, control points included. */
  points(): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    for (const call of this.calls) {
      for (let i = 0; i + 1 < call.args.length; i += 2) {
        if (call.op === 'moveTo' || call.op === 'lineTo' || call.op === 'bezierCurveTo') {
          points.push({ x: call.args[i]!, y: call.args[i + 1]! });
        }
      }
    }
    return points;
  }
}

function extent(points: { x: number; y: number }[]) {
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}

const NO_RASTER: TextRasterizer = {
  measure: () => {
    throw new Error('no text here');
  },
  rasterize: () => {
    throw new Error('no text here');
  },
};

describe('drawGlyph', () => {
  it('draws a glyph as one path, filled once, in the colour the caller set', () => {
    const surface = new RecordingSurface();
    drawGlyph(surface, 'accidentalSharp', 10, 20, 5.4);
    const ops = surface.calls.map((call) => call.op);
    expect(ops[0]).toBe('beginPath');
    expect(ops.at(-1)).toBe('fill');
    expect(ops.filter((op) => op === 'beginPath')).toHaveLength(1);
    expect(ops.filter((op) => op === 'fill')).toHaveLength(1);
    // Only path construction between the two: no pen, no transform, no state.
    const between = new Set(ops.slice(1, -1));
    for (const op of between) {
      expect(['moveTo', 'lineTo', 'bezierCurveTo', 'closePath']).toContain(op);
    }
    expect(between.has('bezierCurveTo')).toBe(true);
    expect(surface.fillWrites).toBe(0);
    expect(surface.fillStyle).toBe('#123456');
  });

  it("puts the glyph's origin at (x, y), a staff space to `space`, and turns y down", () => {
    const surface = new RecordingSurface();
    const [x, y, space] = [100, 50, 5.4];
    drawGlyph(surface, 'noteheadBlack', x, y, space);
    const box = extent(surface.points());
    // A black notehead is 1.18 spaces wide from its origin and a space tall,
    // centred on it.
    expect(box.left).toBeCloseTo(x, 9);
    expect(box.right).toBeCloseTo(x + 1.18 * space, 9);
    expect(box.top).toBeCloseTo(y - 0.5 * space, 9);
    expect(box.bottom).toBeCloseTo(y + 0.5 * space, 9);

    // Its first point is the outline's first, scaled and flipped.
    const outline = decodeGlyphOutline(MUSIC_GLYPH_OUTLINES.noteheadBlack);
    const k = space / GLYPH_UNITS_PER_SPACE;
    const move = surface.calls.find((call) => call.op === 'moveTo')!;
    expect(move.args[0]).toBeCloseTo(x + outline.xy[0]! * k, 9);
    expect(move.args[1]).toBeCloseTo(y - outline.xy[1]! * k, 9);
  });

  it('scales only y by `spaceY`, which is how the brace is stretched to a system', () => {
    const surface = new RecordingSurface();
    drawGlyph(surface, 'brace', 0, 0, 2, 10);
    const box = extent(surface.points());
    const [left, bottom, right, top] = glyphControlBox(glyphOutline('brace')).map(
      (units) => units / GLYPH_UNITS_PER_SPACE,
    ) as [number, number, number, number];
    expect(box.left).toBeCloseTo(left * 2, 9);
    expect(box.right).toBeCloseTo(right * 2, 9);
    expect(box.top).toBeCloseTo(-top * 10, 9);
    expect(box.bottom).toBeCloseTo(-bottom * 10, 9);
    expect(box.bottom - box.top).toBeCloseTo((top - bottom) * 10, 9);
  });

  it('hands the whole glyph to a surface that can fill it at once, and does nothing else', () => {
    const surface = new RecordingSurface();
    const fillGlyph = vi.fn();
    const withGlyphs: DrawSurface = Object.assign(surface, { fillGlyph });
    drawGlyph(withGlyphs, 'accidentalFlat', 30, 40, 5.4, 4);
    expect(fillGlyph).toHaveBeenCalledTimes(1);
    const [name, outline, matrix] = fillGlyph.mock.calls[0] as [string, unknown, GlyphMatrix];
    expect(name).toBe('accidentalFlat');
    expect(outline).toBe(glyphOutline('accidentalFlat'));
    expect(matrix).toEqual([5.4 / 250, 0, 0, -4 / 250, 30, 40]);
    expect(surface.calls).toEqual([]);
    expect(surface.fillWrites).toBe(0);
  });

  it('decodes each glyph once and reuses it', () => {
    expect(glyphOutline('gClef')).toBe(glyphOutline('gClef'));
    expect(glyphOutline('gClef')).not.toBe(glyphOutline('fClef'));
  });
});

describe('a glyph on the SVG surface', () => {
  it('is defined once and placed by <use> each time it is drawn', async () => {
    const fonts = new PdfStandardFonts(await PDFDocument.create());
    const target = beginSvgPage({ width: 200, height: 100, fonts, rasterizer: NO_RASTER });
    const s = target.surface;
    s.fillStyle = '#000000';
    drawGlyph(s, 'accidentalSharp', 10, 50, 5.4);
    drawGlyph(s, 'accidentalSharp', 30, 50, 5.4);
    s.fillStyle = '#336699';
    s.save();
    s.translate(100, 0);
    drawGlyph(s, 'accidentalFlat', 10, 60, 5.4);
    s.restore();
    const svg = target.finish();

    expect(svg.match(/<defs>/g)).toHaveLength(2);
    expect(svg).toMatch(/^<defs><path id="accidentalSharp" d="M-?\d[^"]*Z"\/><\/defs>$/m);
    expect(svg).toMatch(/^<defs><path id="accidentalFlat" d="M/m);
    const uses = svg.match(/<use [^>]*\/>/g) ?? [];
    expect(uses).toEqual([
      '<use href="#accidentalSharp" transform="matrix(0.0216 0 0 -0.0216 10 50)" fill="#000000"/>',
      '<use href="#accidentalSharp" transform="matrix(0.0216 0 0 -0.0216 30 50)" fill="#000000"/>',
      // Under the translate, and in the colour set when it was drawn.
      '<use href="#accidentalFlat" transform="matrix(0.0216 0 0 -0.0216 110 60)" fill="#336699"/>',
    ]);
    // The definitions come before anything is drawn with them.
    expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<use '));
  });
});
