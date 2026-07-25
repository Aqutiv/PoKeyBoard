# Sheet-music PDF export

Exports a take as printable, engraved-style sheet music (grand staff, black on
white) — one PDF per take, shared or downloaded exactly like the MP3 export.

## Pipeline

```
getTakeForExport(id)
  → layoutScore(notes, { bpm, timeSignature, tempoChanges, quantization: grid, minMeasures: 1 })
  → layoutSheet(score, { paper, title, subtitle, bpm, … })   src/features/notation/sheetLayout.ts
  → drawSheetPage(ctx, page) per page                        src/features/notation/sheetRenderer.ts
  → canvas.toBlob(PNG) → pdf-lib embedPng (one image/page)   src/features/export/sheetPdfService.ts
  → Blob → File → shareOrDownloadFile / downloadBlob
```

- `sheetLayout.ts` is pure geometry (unit-tested, no DOM): columns spaced
  roughly proportionally to duration, measures packed greedily into justified
  systems, systems flowed down pages, per-beat beaming (compound meters like
  6/8 group per dotted beat), and dynamic vertical room for ledger notes.
  Spacing, note values, and beam grouping all follow the tempo in force in
  each measure, so a take whose tempo changes still engraves correctly and
  gets a "♩ = n" mark where the new tempo takes over.
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
  accidentals repeat on every occurrence. Sharps that would foul each other —
  closer than five steps, about the height of the glyph — stack into columns
  left of the chord, the topmost nearest.
- Whole-measure rests only; no partial rests, ties, dynamics, pedal or
  tuplet marks. Notes longer than a whole note render as a whole note.
- Because there are no ties, a final chord that rings past its bar line is
  drawn only where it is struck. The layout prints up to the last measure
  that starts a note and closes there, so neither that ring-out nor the
  spare bar the on-screen score keeps for recording reaches the page; rest
  bars inside the piece are untouched.
- Staff assignment follows the imported score's own `staff` per note, so a
  left hand written at or above middle C still prints on the bass staff.
  Recorded takes, and sources with a single staff, split at middle C as
  before.
- A staff is read under whichever clef the source gives it, and a clef that
  turns over mid-piece is engraved after the bar line it takes over on (and
  in the prefix of every system that opens under it). Only G and F clefs are
  supported; a C clef (alto, tenor) drops any override and the staff goes back
  to its own. A clef stands until something replaces it, so a measure with
  nothing on a staff carries the last one forward. The clef rides on the notes
  themselves — takes hold no rests — so a change the source declares during a
  bar of rest is announced at the next note instead of where it was written.
  Pitches are unaffected either way; only the announcement moves.
- Notes struck together on one staff engrave as one chord per voice, stemmed
  apart, rather than as a single stem carrying the longest value. Imported
  voices beam continuously; where a take has none, voices are derived from
  the written note values per column, and a beam breaks where a second voice
  joins or leaves.
- Heads that would collide — a shared step, or steps one apart — are displaced
  a head-width clear of the column: the far side of the stem for a second
  inside a chord, and the up-stem voice where two voices clash. Stems never
  move with them, so beams are unaffected; accidentals hang off the left of
  the whole chord and dots off its right, so neither lands on a displaced
  head. Only one displacement is available, so a cluster alternates on and off
  the column rather than fanning out.
