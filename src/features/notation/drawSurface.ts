/**
 * What the printed sheet draws with: exactly the part of
 * `CanvasRenderingContext2D` that `sheetRenderer.ts`, `accidentalGlyph.ts` and
 * `restGlyph.ts` call, and nothing more.
 *
 * A real canvas context satisfies it as it stands, which is how the export
 * dialog's preview draws a page. The PDF export draws the same calls onto a
 * surface that writes vector operators instead (`export/vectorSurface.ts`),
 * so everything named here is something that surface has to reproduce
 * exactly — which is why the list is kept this short. There is deliberately no
 * `clearRect`, `setTransform` or image drawing: a page starts by filling
 * itself white, and every transform is a `translate`, `rotate` or `scale`
 * bracketed by `save`/`restore`.
 *
 * Properties carry the DOM's own types so a canvas context is assignable;
 * `measureText` promises only `width`, the one metric the sheet reads.
 */
export interface DrawSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;

  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;

  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
  setLineDash(segments: number[]): void;
}
