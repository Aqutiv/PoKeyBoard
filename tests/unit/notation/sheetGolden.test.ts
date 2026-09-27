import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryTakeId } from '@/domain/libraryTakes';
import type { Take } from '@/domain/takeTypes';
import { PdfStandardFonts } from '@/features/export/pdfSurface';
import { defaultKeySignatureFor, layoutTakeSheet } from '@/features/export/sheetPdfService';
import { beginSvgPage } from '@/features/export/svgSurface';
import type { TextRasterizer } from '@/features/export/vectorSurface';
import { getLibraryTake } from '@/features/library/catalog';
import { loadClassicTake, SCORE_PACK_PATH } from '@/features/library/scoreLoader';
import type { SheetGrid, SheetPage } from '@/features/notation/sheetLayout';
import { drawSheetPage } from '@/features/notation/sheetRenderer';
import { buildGoldenStudyTake } from './goldenTakes';

/**
 * Page 1 of three sheets, engraved as SVG through the same vector surface the
 * PDF is drawn with, and compared with the files in `__goldens__/`. Open one in
 * a browser to see the page.
 *
 * A notation change that moves anything on the page changes these. Look at the
 * new page, and when it is right, rewrite them:
 *
 *   npx vitest run tests/unit/notation/sheetGolden.test.ts -u
 */

const SUBTITLE = 'Engraved for the golden test – 15 January 2026';

/** No golden title needs an image; one that did would show up as a failure here. */
const NO_RASTER: TextRasterizer = {
  measure: () => {
    throw new Error('a golden page set text as an image');
  },
  rasterize: () => {
    throw new Error('a golden page set text as an image');
  },
};

function gridOf(take: Take): SheetGrid {
  return take.display.quantization === 'off' ? '1/16' : take.display.quantization;
}

function pageOne(take: Take, grid: SheetGrid = gridOf(take)): SheetPage {
  const layout = layoutTakeSheet(take, 'a4', grid, defaultKeySignatureFor(take), SUBTITLE);
  return layout.pages[0]!;
}

/** Page 1 as SVG, measured with the PDF's own Times metrics. */
async function svgOf(page: SheetPage): Promise<string> {
  const fonts = new PdfStandardFonts(await PDFDocument.create());
  const target = beginSvgPage({
    width: page.metrics.pageWidthPt,
    height: page.metrics.pageHeightPt,
    fonts,
    rasterizer: NO_RASTER,
  });
  drawSheetPage(target.surface, page);
  return target.finish();
}

const PACK_DIR = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);

/** Serve the vendored pack off disk, standing in for the network. */
function stubFetch(): void {
  vi.stubGlobal('fetch', async (input: string) => {
    const file = path.basename(new URL(input, 'http://localhost/').pathname);
    const bytes = await readFile(path.join(PACK_DIR, decodeURIComponent(file)));
    return new Response(new Uint8Array(bytes), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sheet goldens', () => {
  it('engraves the synthetic study, which carries every mark the page can draw', async () => {
    const page = pageOne(buildGoldenStudyTake(), '1/32');
    const systems = page.systems;
    const measures = systems.flatMap((system) => system.measures);
    const notes = measures.flatMap((measure) =>
      measure.columns.flatMap((column) =>
        [...column.treble, ...column.bass].flatMap((chord) => chord.notes),
      ),
    );
    // Guard the golden's coverage: page 1 really has each of these.
    expect(systems.some((system) => system.octaves.some((octave) => octave.up))).toBe(true);
    expect(systems.some((system) => system.pedals.length > 0)).toBe(true);
    expect(systems.some((system) => system.hairpins.length > 0)).toBe(true);
    expect(systems.some((system) => system.dynamics.length > 0)).toBe(true);
    expect(measures.some((measure) => measure.clefChanges.length > 0)).toBe(true);
    expect(notes.some((note) => note.accidental === 'x')).toBe(true);
    expect(notes.some((note) => note.accidental === 'bb')).toBe(true);
    expect(
      measures.some((measure) => measure.beams.some((beam) => (beam.tupletCount ?? 0) >= 10)),
    ).toBe(true);
    expect(page.titleBlock?.title).toContain('♭');

    const svg = await svgOf(page);
    expect(svg).toContain('>8va</text>');
    expect(svg).toContain('>12</text>');
    // The flat in the title is drawn, not typeset.
    expect(svg).toContain('>Golden Study in B</text>');
    expect(svg).not.toMatch(/>[^<]*[♭♯♮𝄪𝄫][^<]*<\/text>/u);
    await expect(svg).toMatchFileSnapshot('./__goldens__/golden-study-p1.svg');
  });

  it('engraves Für Elise', async () => {
    const take = getLibraryTake(libraryTakeId('fur-elise'));
    expect(take).toBeDefined();
    const svg = await svgOf(pageOne(take!));
    await expect(svg).toMatchFileSnapshot('./__goldens__/fur-elise-p1.svg');
  });

  it('engraves the Nocturne in E♭, Op. 9 No. 2 (a vendored score in 12/8)', async () => {
    stubFetch();
    const take = await loadClassicTake('score-chopin-nocturne-op-9-no-2-e-flat-major');
    expect(take?.title).toBe('Nocturne in E♭ major, Op. 9 No. 2');
    expect(take?.tempo.timeSignature).toEqual({ numerator: 12, denominator: 8 });
    const svg = await svgOf(pageOne(take!));
    expect(svg).toContain('>Nocturne in E</text>');
    await expect(svg).toMatchFileSnapshot('./__goldens__/chopin-nocturne-eb-p1.svg');
  });

  it('writes the same file every time', async () => {
    const page = pageOne(buildGoldenStudyTake(), '1/32');
    const first = await svgOf(page);
    expect(await svgOf(page)).toBe(first);
    const lines = first.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="595\.28pt"/);
    expect(lines.at(-1)).toBe('</svg>');
    // One element per line.
    for (const line of lines.slice(1, -1))
      expect(line).toMatch(/^<(path|text|rect) .*(\/>|<\/text>)$/);
  });
});
