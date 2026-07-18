import type { Take } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  layoutSheet,
  type PaperSize,
  type SheetGrid,
  type SheetLayoutResult,
} from '@/features/notation/sheetLayout';
import {
  drawSheetPage,
  LARGE_DOC_PAGE_COUNT,
  RENDER_SCALE,
  RENDER_SCALE_LARGE_DOC,
} from '@/features/notation/sheetRenderer';
import { AppError } from '@/utils/errors';
import { takeSheetFileName } from '@/utils/filenames';

export const MAX_SHEET_PAGES = 100;
export const SHEET_CREDIT = 'PoKeyBoard';

export interface SheetPdfOptions {
  paper: PaperSize;
  grid: SheetGrid;
  /** Localized subtitle line (e.g. the recording date); the dialog formats it. */
  subtitle: string;
}

export interface SheetPdfProgress {
  stage: 'layout' | 'rendering' | 'assembling';
  /** 0..1 during rendering; -1 when indeterminate. */
  fraction: number;
  page?: number;
  pageCount?: number;
}

export interface SheetPdfResult {
  blob: Blob;
  fileName: string;
  pageCount: number;
  sizeBytes: number;
}

/** Thrown when the caller aborts; the dialog treats it as a silent return. */
export class SheetCancelledError extends Error {
  constructor() {
    super('Sheet export cancelled');
    this.name = 'SheetCancelledError';
  }
}

export class SheetExportError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'Sheet music export failed.', 'sheetExportFailed', options);
  }
}

export class SheetTooManyPagesError extends SheetExportError {
  readonly pageCount: number;

  constructor(pageCount: number) {
    super(`Sheet export needs ${pageCount} pages (max ${MAX_SHEET_PAGES})`);
    this.pageCount = pageCount;
  }
}

/** Sheet layout for a take — shared by the dialog preview and the export. */
export function layoutTakeSheet(
  take: Take,
  paper: PaperSize,
  grid: SheetGrid,
  subtitle: string,
): SheetLayoutResult {
  const score = layoutScore(take.notes, {
    bpm: take.tempo.bpm,
    timeSignature: take.tempo.timeSignature,
    quantization: grid,
    minMeasures: 1,
  });
  return layoutSheet(score, {
    paper,
    timeSignature: take.tempo.timeSignature,
    bpm: take.tempo.bpm,
    title: take.title,
    subtitle,
    credit: SHEET_CREDIT,
  });
}

/**
 * Render a take to a multi-page PDF: layout → one page at a time onto a
 * single reused canvas → PNG → pdf-lib assembly. pdf-lib is imported
 * dynamically so it code-splits out of the main bundle.
 */
export async function generateSheetPdf(
  take: Take,
  options: SheetPdfOptions,
  onProgress?: (progress: SheetPdfProgress) => void,
  signal?: AbortSignal,
): Promise<SheetPdfResult> {
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw new SheetCancelledError();
  };

  onProgress?.({ stage: 'layout', fraction: -1 });
  const layout = layoutTakeSheet(take, options.paper, options.grid, options.subtitle);
  const pageCount = layout.pages.length;
  if (pageCount > MAX_SHEET_PAGES) throw new SheetTooManyPagesError(pageCount);
  throwIfAborted();

  const { PDFDocument } = await import('pdf-lib');
  throwIfAborted();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(take.title);
  // Creator = authoring app; pdf-lib stamps itself as Producer at save time.
  pdfDoc.setCreator(SHEET_CREDIT);

  const scale = pageCount > LARGE_DOC_PAGE_COUNT ? RENDER_SCALE_LARGE_DOC : RENDER_SCALE;
  const metrics = layout.pages[0]!.metrics;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(metrics.pageWidthPt * scale);
  canvas.height = Math.round(metrics.pageHeightPt * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new SheetExportError('2D canvas context unavailable');

  for (let i = 0; i < pageCount; i += 1) {
    throwIfAborted();
    onProgress?.({ stage: 'rendering', fraction: i / pageCount, page: i + 1, pageCount });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawSheetPage(ctx, layout.pages[i]!);
    const pngBlob = await canvasToPngBlob(canvas);
    throwIfAborted();
    const image = await pdfDoc.embedPng(await pngBlob.arrayBuffer());
    const pdfPage = pdfDoc.addPage([metrics.pageWidthPt, metrics.pageHeightPt]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: metrics.pageWidthPt,
      height: metrics.pageHeightPt,
    });
  }

  onProgress?.({ stage: 'assembling', fraction: -1 });
  const bytes = await pdfDoc.save();
  throwIfAborted();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  return {
    blob,
    fileName: takeSheetFileName(take.title),
    pageCount,
    sizeBytes: blob.size,
  };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new SheetExportError('canvas.toBlob produced no data'));
    }, 'image/png');
  });
}
