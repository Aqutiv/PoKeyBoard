import type { DrawSurface } from '@/features/notation/drawSurface';

/**
 * The drawing core behind the vector sheet PDF, and behind the SVG the sheet
 * goldens are written in: a `DrawSurface` that keeps its state and its path
 * exactly the way a canvas does, and hands each paint — a filled or stroked
 * path, a run of text, a text image — to a writer that turns it into operators.
 *
 * Everything here is canvas page space: points, y down, transformed by the
 * current matrix as each call arrives. A writer that needs another space (a
 * PDF's y points up) converts as it writes, so the core never has to know.
 *
 * What makes it faithful, and what each writer can rely on:
 *
 * - The path is buffered here, not in the output. A canvas keeps its path
 *   through `fill()` and `stroke()` while a PDF paint operator consumes it, so
 *   every paint hands over the whole buffer and the writer re-emits it.
 * - Arcs and ellipses become cubic Béziers of at most a quarter turn, built in
 *   user space and then transformed, so a notehead turned by `rotate()` is
 *   exact; a quadratic becomes its exact cubic. A writer only ever sees
 *   M, L, C and Z.
 * - Stroke widths and dashes are scaled by the transform at paint time. That is
 *   only exact for a transform that keeps angles (a rotation and one uniform
 *   scale, as the small clef change uses), so stroking under any other throws
 *   rather than drawing a pen the canvas would not have.
 * - Text is set in the four standard Times faces, measured unkerned — what a
 *   PDF `Tj` advances — and normalized first (`normalizePdfText`). A string
 *   the face cannot encode even then becomes an image instead, drawn as written
 *   by an injectable `TextRasterizer`. `measureText` and `fillText` share one
 *   plan per string, so what is measured is always what is drawn.
 *
 * It is strict where a canvas is lenient: a coordinate that is not a finite
 * number, a colour or font it cannot read, or a baseline other than the
 * alphabetic one throws, because silently drawing something else is worse
 * than an export that fails and says so.
 */

/** A 2D affine transform `[a, b, c, d, e, f]`, as a canvas and a PDF write one. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n`: a point goes through `n` first. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export interface Point {
  x: number;
  y: number;
}

export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** One path construction step, in page space (y down). */
export type PathCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

/** A colour as 0–255 channels. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface StrokePaint {
  color: RgbColor;
  /** Already scaled by the transform: page units. */
  width: number;
  cap: CanvasLineCap;
  /** Already scaled by the transform; empty for a solid line. */
  dash: readonly number[];
}

/** The four standard Times faces a sheet is set in. */
export type FontFaceKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface TextPaint {
  face: FontFaceKey;
  size: number;
  /** Normalized, and every character in the face: see `normalizePdfText`. */
  text: string;
  /**
   * The text's frame on the page (y down): the linear part of the transform,
   * translated to where the aligned text starts on its baseline.
   */
  matrix: Matrix;
  color: RgbColor;
}

export interface ImagePaint {
  /** The text the image stands for. */
  text: string;
  image: RasterText;
  /** Maps image space — the unit square, v up, as a PDF places an image — onto the page (y down). */
  matrix: Matrix;
  color: RgbColor;
}

/** Where a `VectorSurface` sends what it paints. */
export interface PaintSink {
  fillPath(path: readonly PathCommand[], color: RgbColor): void;
  strokePath(path: readonly PathCommand[], stroke: StrokePaint): void;
  fillText(text: TextPaint): void;
  fillImage(image: ImagePaint): void;
}

/** One face's metrics, as the writer's font will set them. */
export interface FontFace {
  /** Whether the face can set this code point as text. */
  covers(codePoint: number): boolean;
  /** How far one character advances at `size`, unkerned — as `Tj` sets it. */
  advance(character: string, size: number): number;
}

export interface FontProvider {
  face(key: FontFaceKey): FontFace;
}

/** Text drawn as an alpha coverage image. */
export interface RasterText {
  /** Pixels. Zero when there is nothing to draw. */
  width: number;
  height: number;
  /** `width × height` coverage bytes, row by row from the top. */
  alpha: Uint8Array;
  /** The pixel position of the text's origin: the left end of its baseline. */
  originX: number;
  baselineY: number;
  /**
   * The resolution the image was really drawn at, where a rasterizer had to
   * draw it coarser than asked (a size cap); absent means as asked.
   */
  pxPerUnit?: number;
}

/**
 * Sets text a standard font cannot: `measure` in the same units as a canvas's
 * `measureText`, `rasterize` at `pxPerUnit` pixels to the unit.
 */
export interface TextRasterizer {
  measure(text: string, cssFont: string): number;
  rasterize(text: string, cssFont: string, pxPerUnit: number): RasterText;
}

// --------------------------------------------------------------- numbers --

/** Decimal places a writer keeps: coordinates to 0.01 pt, matrices to 1e−6. */
export const COORD_DECIMALS = 2;
export const MATRIX_DECIMALS = 6;
/** Line widths, dashes and font sizes. */
export const LENGTH_DECIMALS = 3;
export const COLOR_DECIMALS = 4;

/**
 * A number as a PDF or SVG writes it: rounded, trailing zeros trimmed, never
 * in exponent notation and never `-0`. Throws on anything that is not finite.
 */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot write ${value} as a number`);
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  if (rounded === 0) return '0';
  if (Math.abs(rounded) >= 1e15) throw new RangeError(`Cannot write ${value} as a number`);
  const text = rounded.toFixed(decimals);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function assertFinite(...values: number[]): void {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Cannot draw with ${value}: every coordinate must be a finite number`);
    }
  }
}

// ---------------------------------------------------------------- colour --

/** The colours the sheet draws with: `#rgb`, `#rrggbb`, `black` and `white`. */
export function parseCssColor(value: unknown): RgbColor {
  if (typeof value !== 'string') {
    throw new TypeError('Only a colour string can be drawn with here, not a gradient or pattern');
  }
  const text = value.trim().toLowerCase();
  if (text === 'black') return { r: 0, g: 0, b: 0 };
  if (text === 'white') return { r: 255, g: 255, b: 255 };
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [r, g, b] = [short[1]!, short[2]!, short[3]!].map((digit) => parseInt(digit + digit, 16));
    return { r: r!, g: g!, b: b! };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text);
  if (long) {
    return { r: parseInt(long[1]!, 16), g: parseInt(long[2]!, 16), b: parseInt(long[3]!, 16) };
  }
  throw new Error(`Unsupported colour "${value}": use #rgb, #rrggbb, black or white`);
}

/** `#rrggbb`, as a canvas reports a colour back. */
export function colorToHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ------------------------------------------------------------------ font --

export interface ParsedFont {
  face: FontFaceKey;
  size: number;
}

const FONT_SIZE = /(?:^|\s)(\d*\.?\d+(?:e[-+]?\d+)?)px(?=[\s/]|$)/i;
const BOLD_TOKENS = new Set(['bold', 'bolder', '600', '700', '800', '900']);
const IGNORED_TOKENS = new Set(['normal', 'lighter', '100', '200', '300', '400', '500']);

/**
 * A CSS font shorthand as the sheet writes one — `[italic] [600|700|bold] <n>px
 * <family>` — read into a Times face and a size. The family is ignored: the
 * sheet is always set in Times. Anything it cannot read throws.
 */
export function parseCssFont(font: string): ParsedFont {
  const match = FONT_SIZE.exec(font);
  const size = match ? Number(match[1]) : Number.NaN;
  if (!match || !Number.isFinite(size) || size <= 0) {
    throw new Error(`Unreadable font "${font}": it needs a size in px`);
  }
  let bold = false;
  let italic = false;
  for (const token of font.slice(0, match.index).trim().split(/\s+/)) {
    const word = token.toLowerCase();
    if (word === '') continue;
    if (word === 'italic' || word === 'oblique') italic = true;
    else if (BOLD_TOKENS.has(word)) bold = true;
    else if (!IGNORED_TOKENS.has(word)) {
      throw new Error(`Unreadable font "${font}": "${token}" is not a style or weight`);
    }
  }
  const face: FontFaceKey = bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';
  return { face, size };
}

// ------------------------------------------------------------------ text --

/**
 * Text as a standard PDF font should get it: NFC-composed, the typographic
 * spaces a date formatter or a pasted title brings (thin, narrow no-break,
 * ideographic and the rest of U+2000–200A) turned into plain spaces, the
 * invisible characters dropped (soft hyphen, zero-width space and joiners,
 * word joiner, byte-order mark, control characters — a tab or line break
 * becomes a space), and the hyphens WinAnsi lacks folded onto the ones it has.
 * The no-break space stays: WinAnsi has it.
 */
export function normalizePdfText(text: string): string {
  let out = '';
  for (const character of text.normalize('NFC')) {
    const code = character.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += ' ';
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    else if (
      code === 0xad ||
      (code >= 0x200b && code <= 0x200d) ||
      code === 0x2060 ||
      code === 0xfeff
    ) {
      continue;
    } else if (
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000
    ) {
      out += ' ';
    } else if (code === 0x2010 || code === 0x2011 || code === 0x2212) out += '-';
    else if (code === 0x2012) out += '\u2013';
    else if (code === 0x2015) out += '\u2014';
    else out += character;
  }
  // Dropping an invisible character can leave a mark next to its base.
  return out.normalize('NFC');
}

type TextPlan =
  | { kind: 'vector'; face: FontFaceKey; size: number; text: string; width: number }
  | { kind: 'raster'; text: string; width: number };

/** Where the aligned text starts, relative to the x it was drawn at. */
function alignOffset(align: CanvasTextAlign, width: number): number {
  switch (align) {
    case 'center':
      return -width / 2;
    case 'right':
    case 'end':
      return -width;
    default:
      return 0;
  }
}

/** Pixels per unit a text image is rendered at, before the transform's own scale. */
const RASTER_PX_PER_UNIT = 4;

// ------------------------------------------------------------------ arcs --

const TAU = Math.PI * 2;

/**
 * How far an arc sweeps, signed, as a canvas decides it: a whole turn at most,
 * the short or long way round according to the direction asked for.
 */
function arcSweep(start: number, end: number, counterclockwise: boolean): number {
  if (!counterclockwise && end - start >= TAU) return TAU;
  if (counterclockwise && start - end >= TAU) return -TAU;
  if (!counterclockwise && start > end) return TAU - ((start - end) % TAU);
  if (counterclockwise && start < end) return -(TAU - ((end - start) % TAU));
  return end - start;
}

/** Cubics needed so none spans more than a quarter turn. */
function arcSegmentCount(sweep: number): number {
  const quarters = Math.abs(sweep) / (Math.PI / 2);
  if (quarters < 1e-12) return 0;
  // Tolerant of the rounding in 1.5π and the like, which must stay 3, not 4.
  return Math.max(1, Math.ceil(quarters - 1e-9));
}

/**
 * The uniform scale of a transform that keeps angles, or a throw where it
 * does not: a stroke's width can only be carried through a conformal map.
 */
function conformalScale(m: Matrix): number {
  const [a, b, c, d] = m;
  const tolerance = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const rotates = Math.abs(a - d) <= tolerance && Math.abs(b + c) <= tolerance;
  const reflects = Math.abs(a + d) <= tolerance && Math.abs(b - c) <= tolerance;
  const scale = Math.sqrt(Math.abs(a * d - b * c));
  if (!(rotates || reflects) || scale === 0) {
    throw new Error(
      'Cannot stroke under a transform that skews or scales unevenly: it is not conformal',
    );
  }
  return scale;
}

// --------------------------------------------------------------- surface --

interface SurfaceState {
  ctm: Matrix;
  fillStyle: string;
  fillColor: RgbColor;
  strokeStyle: string;
  strokeColor: RgbColor;
  lineWidth: number;
  lineCap: CanvasLineCap;
  dash: readonly number[];
  font: string;
  parsedFont: ParsedFont;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

const LINE_CAPS: readonly string[] = ['butt', 'round', 'square'];
const TEXT_ALIGNS: readonly string[] = ['start', 'end', 'left', 'right', 'center'];
const TEXT_BASELINES: readonly string[] = [
  'top',
  'hanging',
  'middle',
  'alphabetic',
  'ideographic',
  'bottom',
];

const DEFAULT_FONT = '10px sans-serif';
const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

export interface VectorSurfaceOptions {
  sink: PaintSink;
  fonts: FontProvider;
  rasterizer: TextRasterizer;
}

export class VectorSurface implements DrawSurface {
  private state: SurfaceState = {
    ctm: IDENTITY,
    fillStyle: '#000000',
    fillColor: BLACK,
    strokeStyle: '#000000',
    strokeColor: BLACK,
    lineWidth: 1,
    lineCap: 'butt',
    dash: [],
    font: DEFAULT_FONT,
    parsedFont: parseCssFont(DEFAULT_FONT),
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  private readonly saved: SurfaceState[] = [];

  private path: PathCommand[] = [];
  /** The last point of the path, or null when there is no subpath. */
  private current: Point | null = null;
  private subpathStart: Point | null = null;
  /** Set by closePath: the next segment has to move to the subpath start first. */
  private closed = false;

  private readonly plans = new Map<string, TextPlan>();
  private readonly sink: PaintSink;
  private readonly fonts: FontProvider;
  private readonly rasterizer: TextRasterizer;

  constructor(options: VectorSurfaceOptions) {
    this.sink = options.sink;
    this.fonts = options.fonts;
    this.rasterizer = options.rasterizer;
  }

  // ------------------------------------------------------------ state --

  get fillStyle(): string {
    return this.state.fillStyle;
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    const color = parseCssColor(value);
    this.state.fillColor = color;
    this.state.fillStyle = colorToHex(color);
  }

  get strokeStyle(): string {
    return this.state.strokeStyle;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    const color = parseCssColor(value);
    this.state.strokeColor = color;
    this.state.strokeStyle = colorToHex(color);
  }

  get lineWidth(): number {
    return this.state.lineWidth;
  }

  set lineWidth(value: number) {
    // As a canvas: a width that is not a positive number is ignored.
    if (Number.isFinite(value) && value > 0) this.state.lineWidth = value;
  }

  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }

  set lineCap(value: CanvasLineCap) {
    if (LINE_CAPS.includes(value)) this.state.lineCap = value;
  }

  get font(): string {
    return this.state.font;
  }

  set font(value: string) {
    this.state.parsedFont = parseCssFont(value);
    this.state.font = value;
  }

  get textAlign(): CanvasTextAlign {
    return this.state.textAlign;
  }

  set textAlign(value: CanvasTextAlign) {
    if (TEXT_ALIGNS.includes(value)) this.state.textAlign = value;
  }

  get textBaseline(): CanvasTextBaseline {
    return this.state.textBaseline;
  }

  set textBaseline(value: CanvasTextBaseline) {
    if (TEXT_BASELINES.includes(value)) this.state.textBaseline = value;
  }

  setLineDash(segments: number[]): void {
    // As a canvas: a list with a negative or non-finite entry is ignored, and
    // an odd one is repeated to make it even.
    if (!segments.every((value) => Number.isFinite(value) && value >= 0)) return;
    this.state.dash = segments.length % 2 === 1 ? [...segments, ...segments] : [...segments];
  }

  save(): void {
    this.saved.push({ ...this.state });
  }

  restore(): void {
    const state = this.saved.pop();
    if (state) this.state = state;
  }

  translate(x: number, y: number): void {
    assertFinite(x, y);
    this.state.ctm = multiply(this.state.ctm, [1, 0, 0, 1, x, y]);
  }

  rotate(angle: number): void {
    assertFinite(angle);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.state.ctm = multiply(this.state.ctm, [cos, sin, -sin, cos, 0, 0]);
  }

  scale(x: number, y: number): void {
    assertFinite(x, y);
    this.state.ctm = multiply(this.state.ctm, [x, 0, 0, y, 0, 0]);
  }

  // ------------------------------------------------------------- path --

  beginPath(): void {
    this.path = [];
    this.current = null;
    this.subpathStart = null;
    this.closed = false;
  }

  moveTo(x: number, y: number): void {
    assertFinite(x, y);
    this.moveToPoint(this.toPage(x, y));
  }

  lineTo(x: number, y: number): void {
    assertFinite(x, y);
    const point = this.toPage(x, y);
    // With no subpath yet a canvas starts one here, which is a moveTo.
    if (this.current === null) this.moveToPoint(point);
    else this.lineToPoint(point);
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    assertFinite(cp1x, cp1y, cp2x, cp2y, x, y);
    const c1 = this.toPage(cp1x, cp1y);
    // With no subpath a canvas starts one at the first control point.
    if (this.current === null) this.moveToPoint(c1);
    this.curveToPoints(c1, this.toPage(cp2x, cp2y), this.toPage(x, y));
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    assertFinite(cpx, cpy, x, y);
    const q = this.toPage(cpx, cpy);
    if (this.current === null) this.moveToPoint(q);
    const from = this.current!;
    const to = this.toPage(x, y);
    // The exact cubic: each control point two thirds of the way to Q.
    this.curveToPoints(
      { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) },
      { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
      to,
    );
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    assertFinite(x, y, radius, startAngle, endAngle);
    if (radius < 0) throw new RangeError(`The radius provided (${radius}) is negative`);
    this.ellipticalArc(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): void {
    assertFinite(x, y, radiusX, radiusY, rotation, startAngle, endAngle);
    if (radiusX < 0 || radiusY < 0) {
      throw new RangeError(`The radii provided (${radiusX}, ${radiusY}) are negative`);
    }
    this.ellipticalArc(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
  }

  closePath(): void {
    if (this.current === null || this.closed) return;
    this.path.push({ op: 'Z' });
    // As a canvas: the next subpath starts where the closed one did.
    this.current = this.subpathStart;
    this.closed = true;
  }

  fill(): void {
    if (!this.hasSegments()) return;
    this.sink.fillPath(this.path, this.state.fillColor);
  }

  stroke(): void {
    if (!this.hasSegments()) return;
    const scale = conformalScale(this.state.ctm);
    const dash = this.state.dash.some((value) => value > 0)
      ? this.state.dash.map((value) => value * scale)
      : [];
    this.sink.strokePath(this.path, {
      color: this.state.strokeColor,
      width: this.state.lineWidth * scale,
      cap: this.state.lineCap,
      dash,
    });
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    assertFinite(x, y, width, height);
    if (width === 0 || height === 0) return;
    // A path of its own: the one being built is left exactly as it was.
    const corners = [
      this.toPage(x, y),
      this.toPage(x + width, y),
      this.toPage(x + width, y + height),
      this.toPage(x, y + height),
    ];
    this.sink.fillPath(
      [
        { op: 'M', ...corners[0]! },
        { op: 'L', ...corners[1]! },
        { op: 'L', ...corners[2]! },
        { op: 'L', ...corners[3]! },
        { op: 'Z' },
      ],
      this.state.fillColor,
    );
  }

  // ------------------------------------------------------------- text --

  measureText(text: string): { readonly width: number } {
    return { width: this.planFor(text).width };
  }

  fillText(text: string, x: number, y: number): void {
    assertFinite(x, y);
    if (this.state.textBaseline !== 'alphabetic') {
      throw new Error(
        `Only the alphabetic baseline can be drawn here, not "${this.state.textBaseline}"`,
      );
    }
    const plan = this.planFor(text);
    const originX = x + alignOffset(this.state.textAlign, plan.width);
    const ctm = this.state.ctm;
    if (plan.kind === 'vector') {
      if (plan.text === '') return;
      const origin = applyMatrix(ctm, originX, y);
      this.sink.fillText({
        face: plan.face,
        size: plan.size,
        text: plan.text,
        matrix: [ctm[0], ctm[1], ctm[2], ctm[3], origin.x, origin.y],
        color: this.state.fillColor,
      });
      return;
    }

    const asked = RASTER_PX_PER_UNIT * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
    if (plan.text === '' || asked === 0) return;
    const image = this.rasterizer.rasterize(plan.text, this.state.font, asked);
    if (image.width <= 0 || image.height <= 0) return;
    const px = image.pxPerUnit ?? asked;
    // Pixel (i, j) lands at the origin plus ((i − originX), (j − baselineY)) / px;
    // image space puts its top row at v = 1.
    const unitSquare: Matrix = [
      image.width / px,
      0,
      0,
      -image.height / px,
      originX - image.originX / px,
      y + (image.height - image.baselineY) / px,
    ];
    this.sink.fillImage({
      text: plan.text,
      image,
      matrix: multiply(ctm, unitSquare),
      color: this.state.fillColor,
    });
  }

  /** How one string is set in the current font: planned once, then reused. */
  private planFor(text: string): TextPlan {
    const key = `${this.state.font}\u0000${text}`;
    const cached = this.plans.get(key);
    if (cached) return cached;

    const { face, size } = this.state.parsedFont;
    const normalized = normalizePdfText(text);
    const metrics = this.fonts.face(face);
    const characters = Array.from(normalized);
    let plan: TextPlan;
    if (characters.every((character) => metrics.covers(character.codePointAt(0)!))) {
      let width = 0;
      for (const character of characters) width += metrics.advance(character, size);
      plan = { kind: 'vector', face, size, text: normalized, width };
    } else {
      // The browser draws the string as written: normalizing is for what a
      // standard font can encode, and would split an emoji's joined sequence.
      plan = { kind: 'raster', text, width: this.rasterizer.measure(text, this.state.font) };
    }
    this.plans.set(key, plan);
    return plan;
  }

  // ---------------------------------------------------------- helpers --

  private toPage(x: number, y: number): Point {
    return applyMatrix(this.state.ctm, x, y);
  }

  private hasSegments(): boolean {
    return this.path.some((command) => command.op === 'L' || command.op === 'C');
  }

  private moveToPoint(point: Point): void {
    this.path.push({ op: 'M', x: point.x, y: point.y });
    this.current = point;
    this.subpathStart = point;
    this.closed = false;
  }

  /** A segment after closePath starts with an explicit move to where it resumes. */
  private beforeSegment(): void {
    if (this.closed && this.current) this.moveToPoint(this.current);
  }

  private lineToPoint(point: Point): void {
    this.beforeSegment();
    this.path.push({ op: 'L', x: point.x, y: point.y });
    this.current = point;
  }

  private curveToPoints(c1: Point, c2: Point, to: Point): void {
    this.beforeSegment();
    this.path.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: to.x, y: to.y });
    this.current = to;
  }

  /**
   * An arc of an ellipse as quarter-turn cubics, built in user space and only
   * then transformed. Joined to the path by a straight line from its last point,
   * or starting a subpath where there is none, as a canvas does.
   */
  private ellipticalArc(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise: boolean,
  ): void {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const pointAt = (t: number): Point => {
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      return { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos };
    };
    const tangentAt = (t: number): Point => {
      const dx = -rx * Math.sin(t);
      const dy = ry * Math.cos(t);
      return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    };

    const sweep = arcSweep(startAngle, endAngle, counterclockwise);
    const start = pointAt(startAngle);
    const startOnPage = this.toPage(start.x, start.y);
    if (this.current === null) this.moveToPoint(startOnPage);
    else if (startOnPage.x !== this.current.x || startOnPage.y !== this.current.y) {
      this.lineToPoint(startOnPage);
    }

    const count = arcSegmentCount(sweep);
    if (count === 0) return;
    const step = sweep / count;
    // The control-arm length that makes a cubic follow a circle over `step`.
    const k = (4 / 3) * Math.tan(step / 4);
    let t0 = startAngle;
    for (let i = 0; i < count; i += 1) {
      const t1 = i === count - 1 ? startAngle + sweep : t0 + step;
      const p0 = pointAt(t0);
      const d0 = tangentAt(t0);
      const p1 = pointAt(t1);
      const d1 = tangentAt(t1);
      this.curveToPoints(
        this.toPage(p0.x + k * d0.x, p0.y + k * d0.y),
        this.toPage(p1.x - k * d1.x, p1.y - k * d1.y),
        this.toPage(p1.x, p1.y),
      );
      t0 = t1;
    }
  }
}
