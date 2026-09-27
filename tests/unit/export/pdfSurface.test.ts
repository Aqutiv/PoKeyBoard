import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { beginPdfPage, PdfStandardFonts } from '@/features/export/pdfSurface';
import {
  normalizePdfText,
  parseCssFont,
  type RasterText,
  type TextRasterizer,
} from '@/features/export/vectorSurface';
import type { DrawSurface } from '@/features/notation/drawSurface';
import { drawGlyph, glyphOutline } from '@/features/notation/glyphs/drawGlyph';
import { glyphControlBox } from '@/features/notation/glyphs/glyphOutline';

const PAGE_H = 100;

/** A rasterizer for pages that must never need one. */
const NO_RASTER: TextRasterizer = {
  measure: () => {
    throw new Error('measured as an image');
  },
  rasterize: () => {
    throw new Error('drawn as an image');
  },
};

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function rawStream(doc: PDFDocument, ref: PDFObject | undefined): PDFRawStream {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('not a raw stream');
  return stream;
}

/** The page's content streams, decoded and joined; '' for a page with none. */
function contentOf(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  if (contents === undefined) return '';
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => latin1(decodePDFRawStream(rawStream(doc, ref)).decode())).join('\n');
}

async function drawOnPage(
  draw: (surface: DrawSurface) => void,
  rasterizer: TextRasterizer = NO_RASTER,
): Promise<{ doc: PDFDocument; page: PDFPage; ops: string[] }> {
  const doc = await PDFDocument.create();
  const fonts = new PdfStandardFonts(doc);
  const page = doc.addPage([200, PAGE_H]);
  const target = beginPdfPage(doc, page, fonts, { rasterizer });
  draw(target.surface);
  target.finishPage();
  return { doc, page, ops: contentOf(doc, page).split('\n') };
}

/** Index of `needle` as a contiguous run inside `ops`, from `from`. */
function indexOfRun(ops: string[], needle: string[], from = 0): number {
  for (let i = from; i + needle.length <= ops.length; i += 1) {
    if (needle.every((op, j) => ops[i + j] === op)) return i;
  }
  return -1;
}

function count(ops: string[], predicate: (op: string) => boolean): number {
  return ops.filter(predicate).length;
}

const isCurve = (op: string): boolean => op.endsWith(' c');

/** How a writer rounds a coordinate: to 0.01, trailing zeros trimmed. */
function pt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? '0' : String(rounded);
}

describe('the PDF surface: paths', () => {
  it('flips y only when it writes the operators', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(10, 20);
      s.lineTo(30, 40);
      s.stroke();
    });
    expect(indexOfRun(ops, ['10 80 m', '30 60 l', 'S'])).toBeGreaterThanOrEqual(0);
  });

  it('re-emits the whole path for each paint, as a canvas keeps it', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(10, 10);
      s.lineTo(50, 10);
      s.lineTo(50, 50);
      s.closePath();
      s.fill();
      s.stroke();
    });
    const path = ['10 90 m', '50 90 l', '50 50 l', 'h'];
    const filled = indexOfRun(ops, [...path, 'f']);
    expect(filled).toBeGreaterThanOrEqual(0);
    const stroked = ops.indexOf('S');
    expect(stroked).toBeGreaterThan(filled);
    expect(ops.slice(stroked - path.length, stroked)).toEqual(path);
  });

  it('starts afresh after beginPath', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.stroke();
      s.beginPath();
      s.moveTo(0, 50);
      s.lineTo(10, 50);
      s.stroke();
    });
    const second = ops.lastIndexOf('S');
    expect(ops.slice(second - 3, second)).toEqual(['S', '0 50 m', '10 50 l']);
  });

  it('fills a rectangle without touching the path being built', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 10);
      s.fillRect(20, 20, 5, 5);
      s.stroke();
    });
    expect(
      indexOfRun(ops, ['20 80 m', '25 80 l', '25 75 l', '20 75 l', 'h', 'f']),
    ).toBeGreaterThanOrEqual(0);
    const stroked = ops.indexOf('S');
    expect(ops.slice(stroked - 2, stroked)).toEqual(['0 100 m', '10 90 l']);
    expect(count(ops, (op) => op.endsWith(' m'))).toBe(2);
  });

  it('writes a full circle as four quarter curves and the treble clef arc as three', async () => {
    const full = await drawOnPage((s) => {
      s.beginPath();
      s.arc(50, 50, 10, 0, Math.PI * 2);
      s.fill();
    });
    expect(count(full.ops, isCurve)).toBe(4);

    // sheetRenderer's spiral: 0.25π → 1.75π, clockwise.
    const spiral = await drawOnPage((s) => {
      s.beginPath();
      s.arc(50, 50, 1.05 * 5.4, 0.25 * Math.PI, 1.75 * Math.PI);
      s.stroke();
    });
    expect(count(spiral.ops, isCurve)).toBe(3);
    // It starts at 45° below the x axis (y points down on a canvas) and ends
    // 45° above it, going the long way round through the left.
    const r = 1.05 * 5.4;
    const start = `${pt(50 + r * Math.cos(0.25 * Math.PI))} ${pt(PAGE_H - (50 + r * Math.sin(0.25 * Math.PI)))} m`;
    expect(spiral.ops).toContain(start);
    const last = spiral.ops.filter(isCurve).at(-1)!.split(' ');
    expect(last.slice(4, 6)).toEqual([
      pt(50 + r * Math.cos(1.75 * Math.PI)),
      pt(PAGE_H - (50 + r * Math.sin(1.75 * Math.PI))),
    ]);
  });

  it('joins an arc to the point before it with a straight line, as a canvas does', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(0, 50);
      s.arc(50, 50, 10, 0, Math.PI);
      s.stroke();
    });
    expect(indexOfRun(ops, ['0 50 m', '60 50 l'])).toBeGreaterThanOrEqual(0);
    expect(count(ops, isCurve)).toBe(2);
  });

  it('builds a rotated notehead in user space, so its points land exactly', async () => {
    const [cx, cy, rx, ry, turn] = [100, 50, 3.1, 2.3, -0.32];
    const { ops } = await drawOnPage((s) => {
      s.save();
      s.translate(cx, cy);
      s.rotate(turn);
      s.beginPath();
      s.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      s.fill();
      s.restore();
    });
    const curves = ops.filter(isCurve);
    expect(curves).toHaveLength(4);
    // t = 0 is (rx, 0) turned by the rotation; t = π/2 is (0, ry) turned.
    const at = (ux: number, uy: number): string =>
      `${pt(cx + ux * Math.cos(turn) - uy * Math.sin(turn))} ${pt(PAGE_H - (cy + ux * Math.sin(turn) + uy * Math.cos(turn)))}`;
    expect(ops).toContain(`${at(rx, 0)} m`);
    expect(curves[0]!.split(' ').slice(4, 6).join(' ')).toBe(at(0, ry));
    expect(curves[1]!.split(' ').slice(4, 6).join(' ')).toBe(at(-rx, 0));
  });

  it('turns a quadratic into its exact cubic and never writes v', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(0, 0);
      s.quadraticCurveTo(30, 60, 60, 0);
      s.fill();
    });
    // C1 = P0 + ⅔(Q − P0) = (20, 40); C2 = P + ⅔(Q − P) = (40, 40).
    expect(indexOfRun(ops, ['0 100 m', '20 60 40 60 60 100 c'])).toBeGreaterThanOrEqual(0);
    expect(ops.some((op) => op === 'v' || op.endsWith(' v') || op.endsWith(' y'))).toBe(false);
  });

  it('starts a segment with no current point where a canvas would', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.lineTo(10, 10); // a moveTo
      s.lineTo(20, 20);
      s.stroke();
      s.beginPath();
      s.bezierCurveTo(1, 2, 3, 4, 5, 6); // moves to its first control point
      s.stroke();
      s.beginPath();
      s.quadraticCurveTo(10, 20, 30, 40); // likewise
      s.stroke();
    });
    expect(indexOfRun(ops, ['10 90 m', '20 80 l', 'S'])).toBeGreaterThanOrEqual(0);
    expect(indexOfRun(ops, ['1 98 m', '1 98 3 96 5 94 c', 'S'])).toBeGreaterThanOrEqual(0);
    expect(indexOfRun(ops, ['10 80 m', '10 80 16.67 73.33 30 60 c', 'S'])).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('moves back to the start of a closed subpath before drawing on from it', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.lineTo(10, 10);
      s.closePath();
      s.lineTo(20, 20);
      s.stroke();
    });
    expect(
      indexOfRun(ops, ['0 100 m', '10 100 l', '10 90 l', 'h', '0 100 m', '20 80 l', 'S']),
    ).toBeGreaterThanOrEqual(0);
  });

  it('paints nothing for an empty path', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.fill();
      s.stroke();
      s.moveTo(5, 5);
      s.fill();
    });
    expect(ops.some((op) => op === 'f' || op === 'S')).toBe(false);
  });

  it('refuses negative radii, as a canvas does', async () => {
    await drawOnPage((s) => {
      expect(() => s.arc(0, 0, -1, 0, 1)).toThrow();
      expect(() => s.ellipse(0, 0, 1, -1, 0, 0, 1)).toThrow();
    });
  });
});

describe('the PDF surface: graphics state', () => {
  it('scales stroke widths and dashes by the transform (the small clef change)', async () => {
    const { ops } = await drawOnPage((s) => {
      s.lineWidth = 1.15;
      s.setLineDash([2.2, 2]);
      s.scale(0.72, 0.72);
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.stroke();
    });
    expect(ops).toContain('0.828 w');
    expect(ops).toContain('[1.584 1.44] 0 d');
  });

  it('refuses to stroke under a transform that would skew the pen', async () => {
    await drawOnPage((s) => {
      s.scale(1, 2);
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      expect(() => s.stroke()).toThrow(/conformal|skew/i);
      // A fill has no pen, so it is still exact.
      expect(() => s.fill()).not.toThrow();
    });
  });

  it('strokes at the same width under a pure rotation', async () => {
    const { ops } = await drawOnPage((s) => {
      s.lineWidth = 2;
      s.rotate(0.7);
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.stroke();
    });
    expect(ops).toContain('2 w');
  });

  it('saves and restores every piece of state', async () => {
    let restored: Record<string, unknown> = {};
    const { ops } = await drawOnPage((s) => {
      s.fillStyle = '#112233';
      s.strokeStyle = '#445566';
      s.lineWidth = 3;
      s.lineCap = 'round';
      s.font = 'italic 12px serif';
      s.textAlign = 'right';
      s.textBaseline = 'alphabetic';
      s.setLineDash([4, 2]);
      s.translate(10, 0);
      s.save();
      s.fillStyle = '#000000';
      s.strokeStyle = '#ffffff';
      s.lineWidth = 1;
      s.lineCap = 'butt';
      s.font = 'bold 8px serif';
      s.textAlign = 'left';
      s.textBaseline = 'top';
      s.setLineDash([]);
      s.translate(50, 30);
      s.restore();
      s.restore(); // nothing left to restore: ignored, as a canvas does
      restored = {
        fillStyle: s.fillStyle,
        strokeStyle: s.strokeStyle,
        lineWidth: s.lineWidth,
        lineCap: s.lineCap,
        font: s.font,
        textAlign: s.textAlign,
        textBaseline: s.textBaseline,
      };
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.stroke();
      s.fillText('A', 20, 50);
    });
    expect(restored).toEqual({
      fillStyle: '#112233',
      strokeStyle: '#445566',
      lineWidth: 3,
      lineCap: 'round',
      font: 'italic 12px serif',
      textAlign: 'right',
      textBaseline: 'alphabetic',
    });
    expect(ops).toContain('3 w');
    expect(ops).toContain('1 J');
    expect(ops).toContain('[4 2] 0 d');
    expect(ops).toContain('0.2667 0.3333 0.4 RG');
    expect(ops).toContain('0.0667 0.1333 0.2 rg');
    expect(indexOfRun(ops, ['10 100 m', '20 100 l', 'S'])).toBeGreaterThanOrEqual(0);
    expect(ops).toContain('/F3 12 Tf');
    // Right-aligned at x = 20 + 10: the text ends there.
    const italic = (await PDFDocument.create()).embedStandardFont(StandardFonts.TimesRomanItalic);
    const tm = ops.find((op) => op.endsWith(' Tm'))!.split(' ');
    expect(Number(tm[4]) + italic.widthOfTextAtSize('A', 12)).toBeCloseTo(30, 2);
    expect(tm[5]).toBe('50');
  });

  it('writes w, J, d, rg and RG only when they change', async () => {
    const { ops } = await drawOnPage((s) => {
      for (let i = 0; i < 3; i += 1) {
        s.beginPath();
        s.moveTo(0, i * 10);
        s.lineTo(10, i * 10);
        s.stroke();
        s.fillRect(20, i * 10, 5, 5);
      }
      s.lineWidth = 2;
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(1, 1);
      s.stroke();
    });
    expect(count(ops, (op) => op.endsWith(' w'))).toBe(2);
    expect(count(ops, (op) => op.endsWith(' J'))).toBe(1);
    expect(count(ops, (op) => op.endsWith(' d'))).toBe(1);
    expect(count(ops, (op) => op.endsWith(' RG'))).toBe(1);
    expect(count(ops, (op) => op.endsWith(' rg'))).toBe(1);
  });

  it('ignores a line width or dash a canvas would ignore', async () => {
    const { ops } = await drawOnPage((s) => {
      s.lineWidth = 2;
      s.lineWidth = 0;
      s.lineWidth = -1;
      s.lineWidth = Number.NaN;
      s.setLineDash([3]); // odd: doubled
      s.setLineDash([1, -1]);
      s.setLineDash([1, Number.POSITIVE_INFINITY]);
      expect(s.lineWidth).toBe(2);
      s.beginPath();
      s.moveTo(0, 0);
      s.lineTo(10, 0);
      s.stroke();
    });
    expect(ops).toContain('2 w');
    expect(ops).toContain('[3 3] 0 d');
  });

  it('reads the colours the sheet uses and refuses the rest', async () => {
    const { ops } = await drawOnPage((s) => {
      for (const [style, expected] of [
        ['#ffffff', '#ffffff'],
        ['#fff', '#ffffff'],
        ['white', '#ffffff'],
        ['black', '#000000'],
        ['#336699', '#336699'],
        ['#ABCDEF', '#abcdef'],
      ] as const) {
        s.fillStyle = style;
        expect(s.fillStyle).toBe(expected);
        s.fillRect(0, 0, 1, 1);
      }
      for (const style of ['red', 'rgb(0, 0, 0)', '#12', '#1234567', '']) {
        expect(() => {
          s.fillStyle = style;
        }).toThrow();
        expect(() => {
          s.strokeStyle = style;
        }).toThrow();
      }
      expect(() => {
        s.fillStyle = {} as CanvasPattern;
      }).toThrow();
    });
    expect(ops).toContain('1 1 1 rg');
    expect(ops).toContain('0 0 0 rg');
    expect(ops).toContain('0.2 0.4 0.6 rg');
    expect(ops).toContain('0.6706 0.8039 0.9373 rg');
  });
});

describe('the PDF surface: numbers', () => {
  it('rounds coordinates to a hundredth of a point', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(1.23456, 2.34567);
      s.lineTo(123456.789, 50);
      s.stroke();
    });
    expect(ops).toContain('1.23 97.65 m');
    expect(ops).toContain('123456.79 50 l');
  });

  it('never writes exponents or negative zero', async () => {
    const { ops } = await drawOnPage((s) => {
      s.beginPath();
      s.moveTo(1e-7, PAGE_H - 1e-9);
      s.lineTo(-0.001, 50);
      s.lineTo(5e-3, 50.004);
      s.stroke();
      s.rotate(1e-9);
      s.fillText('x', 0, 0);
    });
    expect(ops).toContain('0 0 m');
    expect(ops).toContain('0 50 l');
    expect(ops).toContain('0.01 50 l');
    const text = ops.join('\n');
    expect(text).not.toMatch(/\d[eE][+-]?\d/);
    expect(text).not.toMatch(/(^|[\s[])-0(\s|$|])/m);
  });

  it('rounds a text matrix to a millionth', async () => {
    const { ops } = await drawOnPage((s) => {
      s.rotate(0.1);
      s.fillText('x', 0, 0);
    });
    // The canvas turns clockwise (y down); on the flipped page that is
    // [cos, −sin, sin, cos].
    const a = Math.cos(0.1).toFixed(6);
    const b = Math.sin(0.1).toFixed(6);
    expect(ops).toContain(`${a} -${b} ${b} ${a} 0 100 Tm`);
  });

  it('throws on a coordinate that is not a number', async () => {
    await drawOnPage((s) => {
      expect(() => s.moveTo(Number.NaN, 0)).toThrow();
      expect(() => s.lineTo(0, Number.POSITIVE_INFINITY)).toThrow();
      expect(() => s.bezierCurveTo(0, 0, Number.NaN, 0, 1, 1)).toThrow();
      expect(() => s.arc(0, 0, Number.NaN, 0, 1)).toThrow();
      expect(() => s.translate(Number.NaN, 0)).toThrow();
      expect(() => s.fillRect(0, 0, Number.NaN, 1)).toThrow();
      expect(() => s.fillText('x', Number.NaN, 0)).toThrow();
    });
  });
});

describe('the PDF surface: text', () => {
  const SERIF = '"Times New Roman", Times, serif';
  const G = 5.4;
  // Every font string sheetRenderer sets, and what it has to become.
  const TABLE: [string, string, number][] = [
    [`700 21px ${SERIF}`, 'bold', 21],
    [`italic 10px ${SERIF}`, 'italic', 10],
    [`9px ${SERIF}`, 'regular', 9],
    [`11px ${SERIF}`, 'regular', 11],
    [`9.5px ${SERIF}`, 'regular', 9.5],
    [`8px ${SERIF}`, 'regular', 8],
    [`italic 600 ${1.9 * G}px ${SERIF}`, 'boldItalic', 1.9 * G],
    [`bold italic ${2.4 * G}px ${SERIF}`, 'boldItalic', 2.4 * G],
    [`700 ${2.6 * G}px ${SERIF}`, 'bold', 2.6 * G],
    ['10px sans-serif', 'regular', 10],
  ];

  it.each(TABLE)('reads the font string %s', (font, face, size) => {
    expect(parseCssFont(font)).toEqual({ face, size });
  });

  it('reads the other spellings of bold and italic, and refuses nonsense', () => {
    expect(parseCssFont('oblique 800 12px serif')).toEqual({ face: 'boldItalic', size: 12 });
    expect(parseCssFont('normal 400 12px serif')).toEqual({ face: 'regular', size: 12 });
    expect(parseCssFont('bolder 1.5e1px serif')).toEqual({ face: 'bold', size: 15 });
    expect(parseCssFont('14.040000000000001px serif').size).toBeCloseTo(14.04, 12);
    for (const font of ['bold', '12pt serif', 'wibble 12px serif', '', '0px serif']) {
      expect(() => parseCssFont(font)).toThrow();
    }
  });

  it('sets each face in its own standard Times font, registered as F1 to F4', async () => {
    const { doc, page, ops } = await drawOnPage((s) => {
      for (const [font] of TABLE) {
        s.font = font;
        s.fillText('Ab', 10, 10);
      }
    });
    expect(ops).toContain('/F2 21 Tf');
    expect(ops).toContain('/F3 10 Tf');
    expect(ops).toContain('/F1 9.5 Tf');
    expect(ops).toContain('/F4 10.26 Tf');
    expect(ops).toContain('/F4 12.96 Tf');
    expect(ops).toContain('/F2 14.04 Tf');
    expect(count(ops, (op) => op === 'BT')).toBe(TABLE.length);
    expect(count(ops, (op) => op === 'ET')).toBe(TABLE.length);

    const reloaded = await PDFDocument.load(await doc.save());
    const fonts = reloaded.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const baseFont = (name: string): string => {
      const dict = reloaded.context.lookup(fonts.get(PDFName.of(name)), PDFDict);
      return dict.get(PDFName.of('BaseFont'))!.toString();
    };
    expect(baseFont('F1')).toBe('/Times-Roman');
    expect(baseFont('F2')).toBe('/Times-Bold');
    expect(baseFont('F3')).toBe('/Times-Italic');
    expect(baseFont('F4')).toBe('/Times-BoldItalic');
    expect(page.getSize().height).toBe(PAGE_H);
  });

  it('aligns by the unkerned width, which is what Tj advances', async () => {
    const doc = await PDFDocument.create();
    const times = doc.embedStandardFont(StandardFonts.TimesRoman);
    const unkerned = times.widthOfTextAtSize('A', 10) + times.widthOfTextAtSize('V', 10);
    // pdf-lib's own measure kerns the pair, which Tj does not do.
    expect(times.widthOfTextAtSize('AV', 10)).toBeLessThan(unkerned - 1);

    let measured = 0;
    const { ops } = await drawOnPage((s) => {
      s.font = '10px serif';
      measured = s.measureText('AV').width;
      s.textAlign = 'center';
      s.fillText('AV', 100, 50);
      s.textAlign = 'right';
      s.fillText('AV', 100, 60);
      s.textAlign = 'end';
      s.fillText('AV', 100, 70);
      s.textAlign = 'start';
      s.fillText('AV', 100, 80);
    });
    expect(measured).toBeCloseTo(unkerned, 10);
    expect(ops).toContain(`1 0 0 1 ${pt(100 - unkerned / 2)} 50 Tm`);
    expect(ops).toContain(`1 0 0 1 ${pt(100 - unkerned)} 40 Tm`);
    expect(ops).toContain(`1 0 0 1 ${pt(100 - unkerned)} 30 Tm`);
    expect(ops).toContain('1 0 0 1 100 20 Tm');
    expect(ops).toContain('<4156> Tj');
  });

  it('refuses a baseline other than the alphabetic one', async () => {
    await drawOnPage((s) => {
      s.textBaseline = 'top';
      expect(() => s.fillText('x', 0, 0)).toThrow(/baseline/i);
      expect(s.measureText('x').width).toBeGreaterThan(0);
    });
  });

  it.each([
    ['e\u0301', '\u00e9'],
    ['a\u2009b\u202fc\u3000d\u205fe\u2000f\u200ag', 'a b c d e f g'],
    ['a\u00a0b', 'a\u00a0b'],
    ['soft\u00adhyphen', 'softhyphen'],
    ['zero\u200bwidth\u200cjoin\u200dword\u2060\ufeff', 'zerowidthjoinword'],
    ['tab\tcr\rlf\n', 'tab cr lf '],
    ['bell\u0007del\u007fnel\u0085end', 'belldelnelend'],
    ['a\u2010b\u2011c\u2212d', 'a-b-c-d'],
    ['1\u20122', '1\u20132'],
    ['a\u2015b', 'a\u2014b'],
  ])('normalizes %j for a WinAnsi font', (input, expected) => {
    expect(normalizePdfText(input)).toBe(expected);
  });

  it('sets normalized text as vector text rather than an image', async () => {
    const { ops } = await drawOnPage((s) => {
      s.font = '10px serif';
      s.fillText('27\u202fseptembre\u00a0— “8va” – é\u2212', 10, 10);
    });
    expect(ops.some((op) => op.endsWith(' Tj'))).toBe(true);
    expect(ops.some((op) => op.endsWith(' Do'))).toBe(false);
  });

  it('draws text a standard font cannot encode as an image with a soft mask', async () => {
    const bitmap: RasterText = {
      width: 8,
      height: 4,
      alpha: new Uint8Array(32).fill(255),
      originX: 1,
      baselineY: 3,
    };
    const rasterizer: TextRasterizer = {
      measure: vi.fn(() => 30),
      rasterize: vi.fn(() => bitmap),
    };
    let measured = 0;
    const { doc, page, ops } = await drawOnPage((s) => {
      s.font = 'bold 20px serif';
      s.fillStyle = '#000000';
      measured = s.measureText('音楽').width;
      s.textAlign = 'center';
      s.fillText('音楽', 100, 50);
    }, rasterizer);
    expect(measured).toBe(30);
    expect(rasterizer.measure).toHaveBeenCalledWith('音楽', 'bold 20px serif');
    // Four pixels to the point at identity, so the 8×4 image is 2×1 pt.
    expect(rasterizer.rasterize).toHaveBeenCalledWith('音楽', 'bold 20px serif', 4);
    // Centred on 100 by the stub's own width: the origin lands at 85.
    expect(indexOfRun(ops, ['q', '2 0 0 1 84.75 49.75 cm', '/Im1 Do', 'Q'])).toBeGreaterThanOrEqual(
      0,
    );

    const xObjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const imageRef = xObjects.get(PDFName.of('Im1'));
    expect(imageRef).toBeInstanceOf(PDFRef);
    const image = rawStream(doc, imageRef);
    expect(image.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('Image'));
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect(image.dict.get(PDFName.of('Width'))!.toString()).toBe('8');
    const mask = rawStream(doc, image.dict.get(PDFName.of('SMask')));
    expect(mask.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
    expect(decodePDFRawStream(mask).decode()).toEqual(bitmap.alpha);
    expect(decodePDFRawStream(image).decode()).toHaveLength(8 * 4 * 3);
  });

  it('hands an image string to the browser as written, joined emoji and all', async () => {
    const rasterizer: TextRasterizer = {
      measure: vi.fn(() => 12),
      rasterize: vi.fn(() => ({
        width: 2,
        height: 2,
        alpha: new Uint8Array(4),
        originX: 0,
        baselineY: 2,
      })),
    };
    const coder = '👩\u200d💻';
    const { ops } = await drawOnPage((s) => {
      s.fillText(coder, 0, 50);
    }, rasterizer);
    expect(rasterizer.measure).toHaveBeenCalledWith(coder, '10px sans-serif');
    expect(rasterizer.rasterize).toHaveBeenCalledWith(coder, '10px sans-serif', 4);
    expect(ops).toContain('/Im1 Do');
  });

  it('draws an image of text at the resolution a rasterizer reports', async () => {
    // Capped at 2 px to the point instead of the 4 asked for: the image is
    // placed at its real size, twice as large per pixel.
    const rasterizer: TextRasterizer = {
      measure: () => 10,
      rasterize: () => ({
        width: 8,
        height: 4,
        alpha: new Uint8Array(32),
        originX: 0,
        baselineY: 4,
        pxPerUnit: 2,
      }),
    };
    const { ops } = await drawOnPage((s) => {
      s.fillText('音', 10, 50);
    }, rasterizer);
    expect(ops).toContain('4 0 0 2 10 50 cm');
  });
});

describe('the PDF surface: music glyphs', () => {
  /** Draw each page's calls onto a page of one document, and hand back every page's operators. */
  async function drawPages(
    pages: ((surface: DrawSurface) => void)[],
  ): Promise<{ doc: PDFDocument; pdfPages: PDFPage[]; ops: string[][] }> {
    const doc = await PDFDocument.create();
    const fonts = new PdfStandardFonts(doc);
    const pdfPages: PDFPage[] = [];
    for (const draw of pages) {
      const page = doc.addPage([200, PAGE_H]);
      const target = beginPdfPage(doc, page, fonts, { rasterizer: NO_RASTER });
      draw(target.surface);
      target.finishPage();
      pdfPages.push(page);
    }
    return { doc, pdfPages, ops: pdfPages.map((page) => contentOf(doc, page).split('\n')) };
  }

  function formsIn(doc: PDFDocument): PDFRawStream[] {
    const forms: PDFRawStream[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')
      ) {
        forms.push(object);
      }
    }
    return forms;
  }

  function xObjectsOf(page: PDFPage): PDFDict {
    return page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  }

  it('writes each glyph once per document as a Form XObject, and places it with Do', async () => {
    const { doc, pdfPages, ops } = await drawPages([
      (s) => {
        drawGlyph(s, 'accidentalSharp', 10, 20, 5.4);
        drawGlyph(s, 'accidentalSharp', 30, 20, 5.4);
        drawGlyph(s, 'accidentalFlat', 50, 20, 5.4);
        drawGlyph(s, 'accidentalSharp', 70, 20, 5.4);
      },
      (s) => {
        drawGlyph(s, 'accidentalSharp', 10, 30, 5.4);
      },
    ]);
    // Two glyphs, two forms, however many pages and uses.
    expect(formsIn(doc)).toHaveLength(2);

    const [one, two] = ops as [string[], string[]];
    expect(count(one, (op) => op === '/G1 Do')).toBe(3);
    expect(count(one, (op) => op === '/G2 Do')).toBe(1);
    expect(count(two, (op) => op === '/G1 Do')).toBe(1);
    // A use is the glyph's frame — font units, y up — put on the page and
    // bracketed so it leaves no trace: here 5.4 pt to 250 units.
    expect(
      indexOfRun(one, ['q', '0.0216 0 0 0.0216 10 80 cm', '/G1 Do', 'Q']),
    ).toBeGreaterThanOrEqual(0);
    expect(
      indexOfRun(two, ['q', '0.0216 0 0 0.0216 10 70 cm', '/G1 Do', 'Q']),
    ).toBeGreaterThanOrEqual(0);
    // No path is written on the page itself: every glyph is a Do.
    expect(one.some((op) => op.endsWith(' c') || op === 'f')).toBe(false);

    // Each page names what it uses, and both pages name the one sharp form.
    const sharpOnOne = xObjectsOf(pdfPages[0]!).get(PDFName.of('G1'));
    expect(sharpOnOne).toBeInstanceOf(PDFRef);
    expect(xObjectsOf(pdfPages[0]!).get(PDFName.of('G2'))).toBeInstanceOf(PDFRef);
    expect(xObjectsOf(pdfPages[1]!).get(PDFName.of('G1'))).toBe(sharpOnOne);
    expect(xObjectsOf(pdfPages[1]!).get(PDFName.of('G2'))).toBeUndefined();
  });

  it('draws the form as the outline in font units, boxed by its control points', async () => {
    const { doc } = await drawPages([(s) => drawGlyph(s, 'noteheadBlack', 10, 20, 5.4)]);
    const [form] = formsIn(doc) as [PDFRawStream];
    expect(form.dict.get(PDFName.of('Type'))).toBe(PDFName.of('XObject'));
    const bbox = form.dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map(String);
    expect(bbox).toEqual(glyphControlBox(glyphOutline('noteheadBlack')).map(String));
    const content = latin1(decodePDFRawStream(form).decode()).split('\n');
    const outline = glyphOutline('noteheadBlack');
    expect(content[0]).toBe(`${outline.xy[0]} ${outline.xy[1]} m`);
    expect(content.filter((op) => op.endsWith(' c'))).toHaveLength(4);
    expect(content.at(-2)).toBe('h');
    // Filled with the nonzero rule, and in no colour of its own.
    expect(content.at(-1)).toBe('f');
    expect(content.some((op) => / (rg|RG|g|G|k|K|sc|scn|cs)$/.test(op))).toBe(false);
  });

  it('fills a glyph in the colour current where it is drawn', async () => {
    const { ops } = await drawPages([
      (s) => {
        s.fillStyle = '#336699';
        drawGlyph(s, 'augmentationDot', 10, 20, 5.4);
        s.fillStyle = '#000000';
        drawGlyph(s, 'augmentationDot', 20, 20, 5.4);
      },
    ]);
    const [page] = ops as [string[]];
    const first = page.indexOf('/G1 Do');
    const blue = page.indexOf('0.2 0.4 0.6 rg');
    const black = page.indexOf('0 0 0 rg');
    expect(blue).toBeGreaterThanOrEqual(0);
    expect(blue).toBeLessThan(first);
    expect(black).toBeGreaterThan(first);
    expect(black).toBeLessThan(page.lastIndexOf('/G1 Do'));
  });

  it('places a glyph through the current transform, and leaves the path being built alone', async () => {
    const { ops } = await drawPages([
      (s) => {
        s.beginPath();
        s.moveTo(0, 0);
        s.lineTo(10, 10);
        s.save();
        s.translate(40, 10);
        s.scale(2, 2);
        drawGlyph(s, 'augmentationDot', 5, 5, 5.4, 2.7);
        s.restore();
        s.stroke();
      },
    ]);
    const [page] = ops as [string[]];
    // x: 40 + 2·5 = 50, y: 10 + 2·5 = 20 → 80 on the page; scales doubled.
    expect(page).toContain('0.0432 0 0 0.0216 50 80 cm');
    const stroked = page.indexOf('S');
    expect(page.slice(stroked - 2, stroked)).toEqual(['0 100 m', '10 90 l']);
  });
});
