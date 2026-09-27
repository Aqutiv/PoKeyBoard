import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent, Take } from '@/domain/takeTypes';
import {
  generateSheetPdf,
  layoutTakeSheet,
  MAX_SHEET_PAGES,
  SheetCancelledError,
  SheetTooManyPagesError,
  type SheetPdfOptions,
  type SheetPdfProgress,
} from '@/features/export/sheetPdfService';
import { buildGoldenStudyTake } from '../notation/goldenTakes';

const OPTIONS: SheetPdfOptions = {
  paper: 'a4',
  grid: '1/32',
  keySignature: -2,
  subtitle: 'A fixed subtitle',
};

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Whether any object in the file is an image. */
function hasImage(doc: PDFDocument): boolean {
  return doc.context.enumerateIndirectObjects().some(([, object]) => {
    const dict =
      object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    return dict?.get(PDFName.of('Subtype')) === PDFName.of('Image');
  });
}

/** A take `bars` bars long with a run of sixteenths in each, to fill pages fast. */
function longTake(bars: number): Take {
  const notes: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let i = 0; i < 16; i += 1) {
      notes.push({
        id: `n${bar}-${i}`,
        midi: 60 + ((bar + i) % 12),
        startMs: bar * 2000 + i * 125,
        durationMs: 120,
        velocity: 0.6,
      });
    }
  }
  return createEmptyTake({
    title: 'Long study',
    tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
    notes,
    durationMs: bars * 2000,
  });
}

describe('generateSheetPdf', () => {
  it('writes every page as vector content, titled and credited', async () => {
    const take = buildGoldenStudyTake();
    const expectedPages = layoutTakeSheet(take, 'a4', '1/32', -2, 'A fixed subtitle').pages.length;
    expect(expectedPages).toBeGreaterThan(1);

    const progress: SheetPdfProgress[] = [];
    const result = await generateSheetPdf(take, OPTIONS, (step) => progress.push(step));

    expect(result.pageCount).toBe(expectedPages);
    expect(result.fileName).toMatch(/\.pdf$/);
    const bytes = await bytesOf(result.blob);
    expect(result.sizeBytes).toBe(bytes.length);
    expect(result.blob.type).toBe('application/pdf');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(expectedPages);
    expect(doc.getTitle()).toBe(take.title);
    expect(doc.getCreator()).toBe('PoKeyBoard');
    expect(hasImage(doc)).toBe(false);
    const [width, height] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect([width, height]).toEqual([595.28, 841.89]);

    expect(progress).toEqual([
      { stage: 'layout', fraction: -1 },
      ...Array.from({ length: expectedPages }, (_, i) => ({
        stage: 'rendering',
        fraction: i / expectedPages,
        page: i + 1,
        pageCount: expectedPages,
      })),
      { stage: 'assembling', fraction: -1 },
    ]);
  });

  it('stops with SheetCancelledError when cancelled after the first page starts', async () => {
    const controller = new AbortController();
    const progress: SheetPdfProgress[] = [];
    const pending = generateSheetPdf(
      buildGoldenStudyTake(),
      OPTIONS,
      (step) => {
        progress.push(step);
        if (step.stage === 'rendering') controller.abort();
      },
      controller.signal,
    );
    await expect(pending).rejects.toBeInstanceOf(SheetCancelledError);
    expect(progress.filter((step) => step.stage === 'rendering')).toHaveLength(1);
    expect(progress.some((step) => step.stage === 'assembling')).toBe(false);
  });

  it('stops before assembling a one-page sheet cancelled on its only page', async () => {
    const controller = new AbortController();
    const take = createEmptyTake({
      title: 'One page',
      notes: [{ id: 'a', midi: 60, startMs: 0, durationMs: 400, velocity: 0.6 }],
      durationMs: 400,
    });
    const pending = generateSheetPdf(
      take,
      OPTIONS,
      (step) => {
        if (step.stage === 'rendering') controller.abort();
      },
      controller.signal,
    );
    await expect(pending).rejects.toBeInstanceOf(SheetCancelledError);
  });

  it(`refuses a sheet longer than ${MAX_SHEET_PAGES} pages before drawing any`, async () => {
    const take = longTake(700);
    const progress: SheetPdfProgress[] = [];
    const pending = generateSheetPdf(take, { ...OPTIONS, grid: '1/16', keySignature: 0 }, (step) =>
      progress.push(step),
    );
    await expect(pending).rejects.toBeInstanceOf(SheetTooManyPagesError);
    await expect(pending).rejects.toMatchObject({ pageCount: expect.any(Number) as number });
    expect(progress.map((step) => step.stage)).toEqual(['layout']);
  });
});
