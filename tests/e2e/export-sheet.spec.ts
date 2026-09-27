import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFObject,
} from 'pdf-lib';
import { expect, test } from './fixtures';
import { gotoAppReady, nav, recordShortTake } from './helpers';

/**
 * The most a page of the vector sheet may take on average: 1.5× the densest
 * measured, rounded up to a multiple of 10 KB. That is Chopin's Nocturne in E♭
 * at 19,560 bytes a page; Moonlight, exported here, takes 13,781. The raster
 * pages this replaced were about 200 KB each.
 */
const PAGE_BUDGET_BYTES = 30 * 1024;

/** The one chunk the sheet export imports dynamically; pdf-lib lives in it. */
const WRITER_CHUNK = /\/assets\/sheetPdfWriter-[\w-]+\.js$/;

interface PdfInspection {
  doc: PDFDocument;
  bytes: number;
  pageCount: number;
  bytesPerPage: number;
  imageCount: number;
  softMaskedImages: number;
  baseFonts: Set<string>;
  pageOneContent: string;
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** What a sheet PDF is made of: its images, its fonts, and page 1's operators. */
async function inspectPdf(file: Uint8Array): Promise<PdfInspection> {
  const doc = await PDFDocument.load(file);
  let imageCount = 0;
  let softMaskedImages = 0;
  const baseFonts = new Set<string>();
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict =
      object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (!dict) continue;
    if (dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      imageCount += 1;
      if (dict.get(PDFName.of('SMask'))) softMaskedImages += 1;
    }
    const baseFont = dict.get(PDFName.of('BaseFont'));
    if (baseFont) baseFonts.add(baseFont.toString());
  }
  const contents = doc.getPage(0).node.Contents();
  const streams: (PDFObject | undefined)[] =
    contents instanceof PDFArray ? contents.asArray() : [contents];
  const pageOneContent = streams
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      return stream instanceof PDFRawStream ? latin1(decodePDFRawStream(stream).decode()) : '';
    })
    .join('\n');
  const pageCount = doc.getPageCount();
  return {
    doc,
    bytes: file.length,
    pageCount,
    bytesPerPage: Math.round(file.length / pageCount),
    imageCount,
    softMaskedImages,
    baseFonts,
    pageOneContent,
  };
}

/** Everything a vector sheet PDF must be, recorded against the test for size tracking. */
function expectVectorSheet(pdf: PdfInspection): void {
  test.info().annotations.push({
    type: 'sheet PDF size',
    description: `${pdf.bytes} bytes, ${pdf.pageCount} pages, ${pdf.bytesPerPage} bytes a page`,
  });
  expect(pdf.imageCount).toBe(0);
  expect(pdf.baseFonts).toContain('/Times-Roman');
  expect(pdf.baseFonts).toContain('/Times-Bold');
  // Text set in a font, curves, and filled paths.
  expect(pdf.pageOneContent).toMatch(/ Tf$/m);
  expect(pdf.pageOneContent).toMatch(/ Tj$/m);
  expect(pdf.pageOneContent).toMatch(/ c$/m);
  expect(pdf.pageOneContent).toMatch(/^f$/m);
  expect(pdf.bytesPerPage).toBeLessThanOrEqual(PAGE_BUDGET_BYTES);
}

async function openSheetDialog(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadedBytes(download: Download): Promise<Uint8Array> {
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  return new Uint8Array(readFileSync(filePath!));
}

test.describe('Sheet music export', () => {
  test('exports a recorded take to a valid one-page PDF', async ({ page }) => {
    await gotoAppReady(page);
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeDisabled();
    await recordShortTake(page);

    const dialog = await openSheetDialog(page);
    await expect(dialog.getByText(/≈ 1 page/)).toBeVisible();
    await expect(dialog.locator('.sheet-preview__canvas')).toBeVisible();

    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 30_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^PoKeyBoard - .*\.pdf$/);

    const bytes = await downloadedBytes(download);
    expect(latin1(bytes.subarray(0, 5))).toBe('%PDF-');
    const pdf = await inspectPdf(bytes);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.doc.getCreator()).toBe('PoKeyBoard');
    expectVectorSheet(pdf);
  });

  test('loads pdf-lib only when Generate is pressed', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    // Whichever chunk carries pdf-lib, by its own code rather than its name.
    const pdfLibChunks: string[] = [];
    page.on('response', async (response) => {
      const url = new URL(response.url()).pathname;
      if (!url.endsWith('.js')) return;
      const body = await response.text().catch(() => '');
      if (body.includes('github.com/Hopding/pdf-lib')) pdfLibChunks.push(url);
    });

    await gotoAppReady(page);
    await recordShortTake(page);
    const dialog = await openSheetDialog(page);
    await expect(dialog.getByText(/≈ 1 page/)).toBeVisible();
    await expect(dialog.locator('.sheet-preview__canvas')).toBeVisible();
    // The preview is drawn by the renderer the export uses; pdf-lib is not needed for it.
    await expect
      .poll(() => dialog.locator('.sheet-preview__canvas').evaluate((c) => c.clientWidth))
      .toBeGreaterThan(0);
    expect(requested.filter((path) => WRITER_CHUNK.test(path))).toEqual([]);
    expect(pdfLibChunks).toEqual([]);

    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 30_000 });
    expect(requested.filter((path) => WRITER_CHUNK.test(path))).toHaveLength(1);
    await expect.poll(() => pdfLibChunks).toEqual([expect.stringMatching(WRITER_CHUNK)]);
  });

  test('sets a title Times cannot encode as a soft-masked image', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();
    const take = {
      schemaVersion: 1,
      id: 'e2e-sheet-title-0000-000000000001',
      title: '夜想曲 Nocturne',
      createdAt: '2026-07-17T10:00:00.000Z',
      updatedAt: '2026-07-17T10:00:00.000Z',
      durationMs: 1400,
      samplePackVersion: 'salamander-grand-v3',
      tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 0 },
      instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
      notes: [
        { id: 'a', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
        { id: 'b', midi: 64, startMs: 500, durationMs: 400, velocity: 0.7 },
        { id: 'c', midi: 67, startMs: 1000, durationMs: 400, velocity: 0.7 },
      ],
      pedalEvents: [],
      display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
    };
    await page.getByLabel('Import take JSON file').setInputFiles({
      name: 'nocturne.pokeyboard.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(take)),
    });
    await page
      .getByRole('dialog', { name: 'Import take' })
      .getByRole('button', { name: 'Import', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: take.title })).toBeVisible();

    const dialog = await openSheetDialog(page);
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF' }).click();
    const pdf = await inspectPdf(await downloadedBytes(await downloadPromise));

    // The browser draws the title — one image in the text colour, and its
    // coverage as the soft mask, itself an image — and everything else stays vector.
    expect(pdf.imageCount).toBe(2);
    expect(pdf.softMaskedImages).toBe(1);
    expect(pdf.pageOneContent).toMatch(/^\/Im1 Do$/m);
    expect(pdf.pageOneContent).toMatch(/ Tj$/m);
    expect(pdf.doc.getTitle()).toBe(take.title);
  });

  test('opens the dialog from a Takes action row', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    await nav(page).getByRole('button', { name: 'Takes' }).click();

    await page.getByRole('button', { name: /More actions for/ }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Generate PDF' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('leaves the piano keyboard alone while the dialog is open', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);
    const range = page.locator('.piano__range');
    const before = await range.textContent();

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export sheet music' });
    await expect(dialog).toBeVisible();

    // The dialog owns the page keys; the piano behind it must not move.
    await page.keyboard.press('PageUp');
    await page.keyboard.press('ArrowRight');
    await expect(range).toHaveText(before!);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // The shortcuts come back once the dialog is gone.
    await page.keyboard.press('ArrowRight');
    await expect(range).not.toHaveText(before!);
  });

  test('does not pedal the piano behind the dialog', async ({ page }) => {
    await gotoAppReady(page);
    await recordShortTake(page);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sheet music (PDF)' }).click();
    await expect(page.getByRole('dialog', { name: 'Export sheet music' })).toBeVisible();

    // Space belongs to the dialog's focused button, not to the hidden piano.
    // That activation is why this assertion gets a test of its own: it leaves
    // the dialog in whatever state the button dictates.
    await page.keyboard.down('Space');
    await expect(page.getByRole('button', { name: 'Sustain' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.keyboard.up('Space');
  });

  test('exports the library Moonlight Sonata across multiple pages', async ({ page }) => {
    await gotoAppReady(page);
    await nav(page).getByRole('button', { name: 'Library' }).click();
    // Moonlight lives in the Classics folder; Originals is what opens by default.
    const folders = page.getByRole('group', { name: 'Library folder' });
    await folders.getByRole('button', { name: 'Classics' }).click();
    await page.getByRole('button', { name: 'Open Moonlight Sonata (1st Movement)' }).click();
    await page.locator('section[data-piano-ready="true"]').waitFor({ timeout: 30_000 });

    const dialog = await openSheetDialog(page);
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByText(/PDF ready/)).toBeVisible({ timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PDF' }).click();
    const download = await downloadPromise;
    const pdf = await inspectPdf(await downloadedBytes(download));
    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(pdf.doc.getTitle()).toBe('Moonlight Sonata (1st Movement)');
    expectVectorSheet(pdf);
    // Kept as a test artifact for visual inspection of the engraving.
    await download.saveAs('test-results/moonlight-sheet.pdf');
  });
});
