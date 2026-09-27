import { PDFDocument } from 'pdf-lib';
import type { SheetPage } from '@/features/notation/sheetLayout';
import { drawSheetPage } from '@/features/notation/sheetRenderer';
import { beginPdfPage, PdfStandardFonts } from './pdfSurface';
import type { TextRasterizer } from './vectorSurface';

/**
 * Writes laid-out sheet pages into a PDF, drawing each one as vector content.
 *
 * The one module `sheetPdfService.ts` imports dynamically: pdf-lib and the
 * vector surfaces are only reachable from here, so they stay out of the dialog's
 * chunk and load when a PDF is generated, not when the dialog opens.
 */

export interface SheetPdfWriteOptions {
  title: string;
  creator: string;
  /** Called before each page is drawn (0-based): report progress, or throw to stop. */
  beforePage: (index: number) => void;
  /** Called once every page is drawn, before the file is assembled: likewise. */
  beforeSave: () => void;
  /** Sets text Times cannot; the browser's canvas by default. */
  rasterizer?: TextRasterizer;
}

/**
 * Give the event loop a turn between pages, so progress paints and a Cancel
 * click is heard: `scheduler.yield` where there is one, else a message-channel
 * task, else a timeout.
 */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function writeSheetPdf(
  pages: readonly SheetPage[],
  options: SheetPdfWriteOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(options.title);
  // Creator = authoring app; pdf-lib stamps itself as Producer at save time.
  doc.setCreator(options.creator);
  const fonts = new PdfStandardFonts(doc);

  for (let index = 0; index < pages.length; index += 1) {
    options.beforePage(index);
    const page = pages[index]!;
    const pdfPage = doc.addPage([page.metrics.pageWidthPt, page.metrics.pageHeightPt]);
    const target = beginPdfPage(doc, pdfPage, fonts, { rasterizer: options.rasterizer });
    drawSheetPage(target.surface, page);
    target.finishPage();
    await yieldToMain();
  }

  options.beforeSave();
  return doc.save();
}
