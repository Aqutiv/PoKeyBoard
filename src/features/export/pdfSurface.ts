import {
  PDFName,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import type { DrawSurface } from '@/features/notation/drawSurface';
import {
  GLYPH_CURVE,
  GLYPH_LINE,
  GLYPH_MOVE,
  glyphControlBox,
  type GlyphOutline,
} from '@/features/notation/glyphs/glyphOutline';
import { defaultTextRasterizer } from './canvasTextRasterizer';
import {
  COLOR_DECIMALS,
  COORD_DECIMALS,
  formatNumber,
  LENGTH_DECIMALS,
  MATRIX_DECIMALS,
  VectorSurface,
  type FontFace,
  type FontFaceKey,
  type FontProvider,
  type GlyphPaint,
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
 * Writes what a `VectorSurface` paints as PDF page content.
 *
 * Only reachable through `sheetPdfWriter.ts`, the one module the export
 * imports dynamically, so pdf-lib still loads only when a PDF is generated.
 *
 * - The canvas's y-down page is flipped (`y → H − y`) only here, as each
 *   operator is written.
 * - A page's operators collect as text and go out as one Flate stream when the
 *   page is finished. Nothing is kept as pdf-lib operator objects, which would
 *   hold every page of a long score in memory until the file is saved.
 * - There is no `q`/`Q` around paths: the writer tracks the line width, cap,
 *   dash and both colours it last wrote and writes them again only when they
 *   change. A new page starts with nothing known.
 * - Text is the four standard Times fonts, which are not embedded — a viewer
 *   supplies its own Times, and the widths are standard. Each is registered on
 *   a page as /F1–/F4 when that page first uses it.
 * - Text no Times font can encode arrives as an image: an RGB XObject filled
 *   with the text colour, with the rendered coverage as its soft mask.
 * - A music glyph is a Form XObject, written once per document — its outline
 *   in font units, filled — and placed on a page as `q <cm> /Gn Do Q` each time
 *   it is drawn. The form sets no colour, so it fills in whatever colour the
 *   page has current, which is written before it as it would be for a path. A
 *   sharp's outline is some 2.4 KB of operators; its use is about 45 bytes, and
 *   a page of piano music draws the same few glyphs hundreds of times.
 */

const FACES: Record<FontFaceKey, { font: StandardFonts; resource: string }> = {
  regular: { font: StandardFonts.TimesRoman, resource: 'F1' },
  bold: { font: StandardFonts.TimesRomanBold, resource: 'F2' },
  italic: { font: StandardFonts.TimesRomanItalic, resource: 'F3' },
  boldItalic: { font: StandardFonts.TimesRomanBoldItalic, resource: 'F4' },
};

class StandardFace implements FontFace {
  readonly font: PDFFont;
  private readonly characters: ReadonlySet<number>;
  /** Each character's width in font units (a size of 1000). */
  private readonly units = new Map<string, number>();

  constructor(font: PDFFont) {
    this.font = font;
    this.characters = new Set(font.getCharacterSet());
  }

  covers(codePoint: number): boolean {
    return this.characters.has(codePoint);
  }

  advance(character: string, size: number): number {
    let units = this.units.get(character);
    if (units === undefined) {
      units = this.font.widthOfTextAtSize(character, 1000);
      this.units.set(character, units);
    }
    // The same arithmetic as pdf-lib's own measure, one character at a time:
    // no kerning, since `Tj` applies none.
    return units * (size / 1000);
  }
}

/** The standard Times fonts of one document, each embedded the first time it is used. */
export class PdfStandardFonts implements FontProvider {
  private readonly doc: PDFDocument;
  private readonly faces = new Map<FontFaceKey, StandardFace>();

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  face(key: FontFaceKey): StandardFace {
    let face = this.faces.get(key);
    if (!face) {
      face = new StandardFace(this.doc.embedStandardFont(FACES[key].font));
      this.faces.set(key, face);
    }
    return face;
  }
}

interface GlyphForm {
  /** The name every page refers to it by: G1, G2 and on, in the order first drawn. */
  resource: string;
  ref: PDFRef;
}

/**
 * A document's music glyphs, each written once as a Form XObject the first
 * time any page draws it. Kept per document, so every page of one export
 * shares them and no other export ever sees them.
 */
class GlyphForms {
  private readonly doc: PDFDocument;
  private readonly forms = new Map<string, GlyphForm>();

  constructor(doc: PDFDocument) {
    this.doc = doc;
  }

  formFor(name: string, outline: GlyphOutline): GlyphForm {
    let form = this.forms.get(name);
    if (!form) {
      const context = this.doc.context;
      const stream = context.flateStream(glyphContent(outline), {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: glyphControlBox(outline),
        Resources: {},
      });
      form = { resource: `G${this.forms.size + 1}`, ref: context.register(stream) };
      this.forms.set(name, form);
    }
    return form;
  }
}

const GLYPH_FORMS = new WeakMap<PDFDocument, GlyphForms>();

function glyphFormsOf(doc: PDFDocument): GlyphForms {
  let forms = GLYPH_FORMS.get(doc);
  if (!forms) {
    forms = new GlyphForms(doc);
    GLYPH_FORMS.set(doc, forms);
  }
  return forms;
}

/** A glyph's outline as form content: its path in font units, filled (nonzero). */
function glyphContent(outline: GlyphOutline): string {
  const { ops, xy } = outline;
  const lines: string[] = [];
  let p = 0;
  for (const op of ops) {
    if (op === GLYPH_MOVE || op === GLYPH_LINE) {
      lines.push(`${xy[p]} ${xy[p + 1]} ${op === GLYPH_MOVE ? 'm' : 'l'}`);
      p += 2;
    } else if (op === GLYPH_CURVE) {
      lines.push(`${Array.from(xy.subarray(p, p + 6)).join(' ')} c`);
      p += 6;
    } else {
      lines.push('h');
    }
  }
  lines.push('f');
  return lines.join('\n');
}

/** A placement flipped onto the PDF page (y up): `[a, −b, c, −d, e, H − f]`. */
function flippedMatrix(m: Matrix, pageHeight: number): string {
  const [a, b, c, d, e, f] = m;
  return `${ratio(a)} ${ratio(-b)} ${ratio(c)} ${ratio(-d)} ${coord(e)} ${coord(pageHeight - f)}`;
}

type TrackedState = 'lineWidth' | 'lineCap' | 'dash' | 'fill' | 'stroke';

const CAP_CODES: Record<CanvasLineCap, number> = { butt: 0, round: 1, square: 2 };

function coord(value: number): string {
  return formatNumber(value, COORD_DECIMALS);
}

function ratio(value: number): string {
  return formatNumber(value, MATRIX_DECIMALS);
}

function length(value: number): string {
  return formatNumber(value, LENGTH_DECIMALS);
}

function rgb(color: RgbColor): string {
  return [color.r, color.g, color.b].map((c) => formatNumber(c / 255, COLOR_DECIMALS)).join(' ');
}

class PdfPageWriter implements PaintSink {
  private readonly doc: PDFDocument;
  private readonly page: PDFPage;
  private readonly fonts: PdfStandardFonts;
  private readonly height: number;
  private readonly ops: string[] = [];
  private readonly written = new Map<TrackedState, string>();
  private readonly pageFonts = new Set<FontFaceKey>();
  private readonly glyphs: GlyphForms;
  /** The glyph forms this page's resources name already. */
  private readonly pageGlyphs = new Set<string>();
  private images = 0;
  private finished = false;

  constructor(doc: PDFDocument, page: PDFPage, fonts: PdfStandardFonts) {
    this.doc = doc;
    this.page = page;
    this.fonts = fonts;
    this.glyphs = glyphFormsOf(doc);
    this.height = page.getHeight();
  }

  fillPath(path: readonly PathCommand[], color: RgbColor): void {
    this.setState('fill', `${rgb(color)} rg`);
    this.writePath(path);
    this.ops.push('f');
  }

  strokePath(path: readonly PathCommand[], stroke: StrokePaint): void {
    this.setState('lineWidth', `${length(stroke.width)} w`);
    this.setState('lineCap', `${CAP_CODES[stroke.cap]} J`);
    this.setState('dash', `[${stroke.dash.map(length).join(' ')}] 0 d`);
    this.setState('stroke', `${rgb(stroke.color)} RG`);
    this.writePath(path);
    this.ops.push('S');
  }

  fillGlyph(paint: GlyphPaint): void {
    this.setState('fill', `${rgb(paint.color)} rg`);
    const form = this.glyphs.formFor(paint.name, paint.outline);
    if (!this.pageGlyphs.has(paint.name)) {
      this.page.node.setXObject(PDFName.of(form.resource), form.ref);
      this.pageGlyphs.add(paint.name);
    }
    this.ops.push(
      'q',
      `${flippedMatrix(paint.matrix, this.height)} cm`,
      `/${form.resource} Do`,
      'Q',
    );
  }

  fillText(paint: TextPaint): void {
    this.setState('fill', `${rgb(paint.color)} rg`);
    const resource = this.useFont(paint.face);
    const [a, b, c, d, e, f] = paint.matrix;
    // Glyphs are drawn y-up and the canvas frame is y-down, so the text matrix
    // is the frame with its y axis turned over, then flipped onto the page.
    this.ops.push(
      'BT',
      `/${resource} ${length(paint.size)} Tf`,
      `${ratio(a)} ${ratio(-b)} ${ratio(-c)} ${ratio(d)} ${coord(e)} ${coord(this.height - f)} Tm`,
      `${this.fonts.face(paint.face).font.encodeText(paint.text).toString()} Tj`,
      'ET',
    );
  }

  fillImage(paint: ImagePaint): void {
    const { image, color } = paint;
    const context = this.doc.context;
    const mask = context.flateStream(image.alpha, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: image.width,
      Height: image.height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    });
    const solid = new Uint8Array(image.width * image.height * 3);
    for (let i = 0; i < solid.length; i += 3) {
      solid[i] = color.r;
      solid[i + 1] = color.g;
      solid[i + 2] = color.b;
    }
    const pixels = context.flateStream(solid, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: image.width,
      Height: image.height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      SMask: context.register(mask),
    });
    this.images += 1;
    const name = `Im${this.images}`;
    this.page.node.setXObject(PDFName.of(name), context.register(pixels));
    this.ops.push('q', `${flippedMatrix(paint.matrix, this.height)} cm`, `/${name} Do`, 'Q');
  }

  /** Hand the page its content: every operator, as one compressed stream. */
  finish(): void {
    if (this.finished) throw new Error('This PDF page is already finished');
    this.finished = true;
    if (this.ops.length === 0) return;
    const context = this.doc.context;
    const stream = context.flateStream(this.ops.join('\n'));
    this.ops.length = 0;
    this.page.node.addContentStream(context.register(stream));
  }

  private setState(key: TrackedState, operator: string): void {
    if (this.written.get(key) === operator) return;
    this.written.set(key, operator);
    this.ops.push(operator);
  }

  private useFont(face: FontFaceKey): string {
    const { resource } = FACES[face];
    if (!this.pageFonts.has(face)) {
      this.page.node.setFontDictionary(PDFName.of(resource), this.fonts.face(face).font.ref);
      this.pageFonts.add(face);
    }
    return resource;
  }

  private writePath(path: readonly PathCommand[]): void {
    const h = this.height;
    for (const command of path) {
      switch (command.op) {
        case 'M':
          this.ops.push(`${coord(command.x)} ${coord(h - command.y)} m`);
          break;
        case 'L':
          this.ops.push(`${coord(command.x)} ${coord(h - command.y)} l`);
          break;
        case 'C':
          this.ops.push(
            `${coord(command.x1)} ${coord(h - command.y1)} ${coord(command.x2)} ${coord(h - command.y2)} ${coord(command.x)} ${coord(h - command.y)} c`,
          );
          break;
        case 'Z':
          this.ops.push('h');
          break;
      }
    }
  }
}

export interface PdfPageSurfaceOptions {
  /** Sets text Times cannot; the browser's own canvas text by default. */
  rasterizer?: TextRasterizer;
}

export interface PdfPageSurface {
  /** What a sheet page is drawn onto, in PDF points with y down. */
  readonly surface: DrawSurface;
  /** Write everything drawn onto the page. Call once, when the page is done. */
  finishPage(): void;
}

/** Start drawing one PDF page: draw onto `surface`, then call `finishPage`. */
export function beginPdfPage(
  doc: PDFDocument,
  page: PDFPage,
  fonts: PdfStandardFonts,
  options: PdfPageSurfaceOptions = {},
): PdfPageSurface {
  const writer = new PdfPageWriter(doc, page, fonts);
  const surface = new VectorSurface({
    sink: writer,
    fonts,
    rasterizer: options.rasterizer ?? defaultTextRasterizer(),
  });
  return { surface, finishPage: () => writer.finish() };
}
