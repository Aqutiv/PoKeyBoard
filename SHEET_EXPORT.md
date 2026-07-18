# Sheet-music PDF export

Exports a take as printable, engraved-style sheet music (grand staff, black on
white) — one PDF per take, shared or downloaded exactly like the MP3 export.

## Pipeline

```
getTakeForExport(id)
  → layoutScore(notes, { bpm, timeSignature, quantization: grid, minMeasures: 1 })
  → layoutSheet(score, { paper, title, subtitle, bpm, … })   src/features/notation/sheetLayout.ts
  → drawSheetPage(ctx, page) per page                        src/features/notation/sheetRenderer.ts
  → canvas.toBlob(PNG) → pdf-lib embedPng (one image/page)   src/features/export/sheetPdfService.ts
  → Blob → File → shareOrDownloadFile / downloadBlob
```

- `sheetLayout.ts` is pure geometry (unit-tested, no DOM): columns spaced
  roughly proportionally to duration, measures packed greedily into justified
  systems, systems flowed down pages, per-beat beaming (compound meters like
  6/8 group per dotted beat), and dynamic vertical room for ledger notes.
  All positions are in PDF points; `SHEET_GAP_PT` (staff space) scales the
  engraving.
- `sheetRenderer.ts` draws a page onto a canvas whose ctx is scaled so
  1 unit = 1 pt. All music glyphs (clefs, brace, sharp, flags, beams, rests)
  are hand-drawn Béziers — no music font is required, so output is identical
  on every device. Fonts are used only for text (serif stack).
- `sheetPdfService.ts` rasterizes pages sequentially on one reused canvas at
  `RENDER_SCALE` (4× ≈ 288 DPI; 3× above 30 pages) and assembles the PDF with
  **pdf-lib** (MIT, dynamically imported so it code-splits; still precached by
  the service worker, so export works offline).

## UI

`SheetExportDialog` (mounted in `App.tsx`, driven by `useExportUiStore.
openSheetExport(takeId)`) mirrors the audio export dialog: options (paper
size A4/US Letter — persisted via `settings.sheetPaperSize` — and a 1/8 or
1/16 snap grid defaulting from the take's display quantization) with a live
page-1 preview and page estimate → progress with cancel (`AbortSignal`) →
ready with Download PDF / Share PDF. Entry points: the Play header and each
Takes action row (disabled for empty takes). No result caching — generation
takes seconds and never touches the audio engine.

## Limits and guards

- `MAX_SHEET_PAGES = 100` — a typed error with friendly dialog copy; the
  options phase also disables Generate when the estimate exceeds the cap.
- Canvas memory: one page at 4× A4 is ~32 MB RGBA; pages render strictly
  sequentially on a single reused canvas.
- Share must run in the click handler (user activation), same as audio.

## Known limitations (v1)

- Visual quantization to a 1/8 or 1/16 grid; ternary rhythms (triplets) land
  on the nearest binary slot and typically render as dotted values.
- Sharps-only spelling, no key signatures (matches the on-screen score);
  accidentals repeat on every occurrence.
- Whole-measure rests only; no partial rests, ties, dynamics, pedal or
  tuplet marks. Notes longer than a whole note render as a whole note.
- Staff split is fixed at middle C (MIDI 60), like the live score.
