import { writtenNotes } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';
import { detectFifths } from '@/features/notation/keyDetection';
import { normalizeFifths } from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  layoutSheet,
  type PaperSize,
  type SheetGrid,
  type SheetLayoutResult,
} from '@/features/notation/sheetLayout';
import { AppError } from '@/utils/errors';
import { takeSheetFileName } from '@/utils/filenames';

export const MAX_SHEET_PAGES = 100;
export const SHEET_CREDIT = 'PoKeyBoard';

export interface SheetPdfOptions {
  paper: PaperSize;
  grid: SheetGrid;
  /** Sharps (positive) or flats (negative); the dialog defaults it and lets it be changed. */
  keySignature: number;
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

/**
 * The key a take is engraved in unless the player says otherwise: what the
 * source score declared, or what its own written pitches read as — a hidden
 * note is no more part of the page's key than of its spelling.
 */
export function defaultKeySignatureFor(take: Take): number {
  return take.tempo.keySignature !== undefined
    ? normalizeFifths(take.tempo.keySignature)
    : detectFifths(writtenNotes(take.notes));
}

/** Sheet layout for a take — shared by the dialog preview and the export. */
export function layoutTakeSheet(
  take: Take,
  paper: PaperSize,
  grid: SheetGrid,
  keySignature: number,
  subtitle: string,
): SheetLayoutResult {
  const score = layoutScore(take.notes, {
    bpm: take.tempo.bpm,
    timeSignature: take.tempo.timeSignature,
    tempoChanges: take.tempo.changes,
    quantization: grid,
    keySignature,
    pedals: take.pedalEvents,
    minMeasures: 1,
  });
  return layoutSheet(score, {
    paper,
    timeSignature: take.tempo.timeSignature,
    keySignature,
    bpm: take.tempo.bpm,
    title: take.title,
    subtitle,
    credit: SHEET_CREDIT,
  });
}

/**
 * Render a take to a multi-page PDF: layout here, then `sheetPdfWriter` draws
 * each page as vector paths and standard-font text, one page of operators at a
 * time. The writer is imported dynamically, and it is the only way pdf-lib is
 * reached, so pdf-lib code-splits out of both the main bundle and the dialog
 * and loads when Generate is pressed.
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
  const layout = layoutTakeSheet(
    take,
    options.paper,
    options.grid,
    options.keySignature,
    options.subtitle,
  );
  const pageCount = layout.pages.length;
  if (pageCount > MAX_SHEET_PAGES) throw new SheetTooManyPagesError(pageCount);
  throwIfAborted();

  const { writeSheetPdf } = await import('./sheetPdfWriter');
  throwIfAborted();
  const bytes = await writeSheetPdf(layout.pages, {
    title: take.title,
    creator: SHEET_CREDIT,
    beforePage: (index) => {
      throwIfAborted();
      onProgress?.({
        stage: 'rendering',
        fraction: index / pageCount,
        page: index + 1,
        pageCount,
      });
    },
    beforeSave: () => {
      throwIfAborted();
      onProgress?.({ stage: 'assembling', fraction: -1 });
    },
  });
  throwIfAborted();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  return {
    blob,
    fileName: takeSheetFileName(take.title),
    pageCount,
    sizeBytes: blob.size,
  };
}
