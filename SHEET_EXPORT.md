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
  systems, systems flowed down pages, and dynamic vertical room for ledger
  notes, pedal brackets and dynamics.
  Spacing and note values follow the tempo in force in
  each measure, so a take whose tempo changes still engraves correctly and
  gets a "♩ = n" mark where the new tempo takes over.
  All positions are in PDF points; `SHEET_GAP_PT` (staff space) scales the
  engraving.
- `sheetRenderer.ts` draws a page onto a canvas whose ctx is scaled so
  1 unit = 1 pt. All music glyphs (clefs, brace, accidentals, flags, beams,
  rests, ties, pedal brackets, hairpins) are hand-drawn Béziers — no music font
  is required, so output is identical on every device. Fonts are used only for
  text (serif stack), which includes dynamic marks: `p` and `f` are letters,
  and editions have always set them in bold italic. Rests and accidentals live in `restGlyph.ts` and
  `accidentalGlyph.ts`, shared with the live score so both views draw the same
  shapes at their own staff-space scale.
- `sheetPdfService.ts` rasterizes pages sequentially on one reused canvas at
  `RENDER_SCALE` (4× ≈ 288 DPI; 3× above 30 pages) and assembles the PDF with
  **pdf-lib** (MIT, dynamically imported so it code-splits; still precached by
  the service worker, so export works offline).

## UI

`SheetExportDialog` (mounted in `App.tsx`, driven by `useExportUiStore.
openSheetExport(takeId)`) mirrors the audio export dialog: options (paper
size A4/US Letter — persisted via `settings.sheetPaperSize`, a 1/8, 1/16, 1/32 or
1/64 snap grid defaulting from the take's display quantization, which an import
sets from the shortest value its score contains, and a key signature
defaulting to the declared or detected one, per piece and not persisted) with a live
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

## Rests, keys, ties, pedal

- **Note values** run from a whole note down to a **64th**, plain or dotted, and
  they are counted in 384ths of a whole note (`rests.ts`) so that every one of
  them — a dotted 64th included, which is what 384 rather than 192 buys — is a
  whole number of units and "may a value of this length start here" stays exact
  integer arithmetic. A 32nd carries three beams or flags and a 64th four
  (`beamCountFor`, read by both layouts and both renderers), and their stems
  lengthen by the depth the extra beams take up (`extraStemG`) so the innermost
  never arrives at the notehead.
- **Rests** are derived, never stored: a staff is occupied for as long as its
  notes are _written_, and the silence left over is filled with rests, split at
  beat boundaries and never across the middle of an even bar. A wholly silent
  bar takes one whole rest whatever the meter is. Because onsets snap to the
  grid, note _lengths_ snap to it too — otherwise a quarter played detached
  reads as a dotted eighth against a grid that already put the next note on the
  following beat, and the bar stops adding up. Nothing shorter than the grid's
  own step is ever written, so a page read on a 1/16 grid shows no 32nd rest: a
  sliver that survives rounding is residue, not music.
- **Key signatures** decide spelling: `tempo.keySignature` when the score
  declared one (MusicXML `<key><fifths>`), otherwise a key read from the
  take's own pitches (`keyDetection.ts`, a duration-weighted
  Krumhansl–Kessler correlation; under twelve notes it stays in C major). The
  export dialog offers all fifteen and defaults to that answer. An accidental
  holds for the rest of its bar at the line it stands on and the bar line
  forgets it, so repeats are unmarked and a return to the key takes a natural.
  Accidentals that would foul each other — closer than five steps, about the
  height of the glyph — stack into columns left of the chord, topmost nearest.
- **Ties** cut a note at every bar line it crosses, and again wherever no
  single value covers the remainder, so a note longer than a whole note is
  written rather than clamped and a ring-out past the bar line is engraved
  where it actually sounds. A tie carries its accidental with it. A tie whose
  ends land on different systems is drawn as a stub at each end.
- **Pedal** brackets go under the bass staff, in a row of their own, from every
  press to its release; a press outliving the system is left open at that end.
  The events were always recorded and imported — this is where they finally get
  drawn.
- **Beaming** is decided once, in `layoutScore`, so the printed page and the
  live score group runs the same way and commit a run to the same stem
  direction; `beamGeometry.ts` holds the line arithmetic in staff spaces, read
  as points here and as pixels on screen. Runs break at a rest, a change of
  note value, a beat group, or a voice; compound meters group per dotted beat.
- **Dynamics** are read out of velocity (`dynamics.ts`) and set between the
  staves, which is where a pianist looks for them — a system carrying them
  opens its inter-staff gap, and one without is laid out exactly as before.
  The reading is deliberately deaf to detail, because a mark on every change of
  touch would say nothing: it takes a high percentile over a wide window of
  onsets, holds its band until the level clearly leaves it, and will not speak
  twice inside two bars. A steady climb or fall across a phrase becomes a
  hairpin with the marks kept at each end; a swell too long to taper visibly
  (more than six bars) stays as marks, which is what an edition writes.

## Known limitations

- Triplets are read from the playing rather than declared: per staff, per beat,
  the onsets are scored against a binary division and a ternary one, and the
  ternary reading has to be substantially better before it is believed —
  writing straight quavers as triplets puts a wrong rhythm on the page, while
  missing a triplet leaves the page as it was. A hand holding too little of a
  beat to tell takes the other hand's answer, and where neither can speak the
  two are pooled; a hand with enough notes keeps its own reading, which is what
  preserves a real three-against-two. Only whole tuplets are numbered: "2" over
  two thirds of a triplet would name a duplet, a different rhythm.
- Octave lines are derived from pitch alone. A run of chords sitting three
  ledger lines or more beyond a staff is drawn an octave in under an `8va` or
  `8vb`; a single stray note is left where it is, since a line and a label cost
  a reader more than the ledger lines they save.
- Articulations, slurs, ornaments and repeats are still not drawn.
- A tuplet split between the hands — an arpeggio crossing the middle of the
  keyboard — is written with the right values on both staves and no numeral on
  either, because neither holds a whole one. The figure would need to be
  assigned to a single staff for that, which is the same middle-C limitation
  noted below.
- A dynamic mark sits at a fixed height in the inter-staff gap and nothing
  moves it, so a bass note stemming up into that gap can crowd one. It stays
  legible; engraving software nudges marks per-collision, and this does not.
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
  themselves, and derived rests carry none, so a change the source declares
  during a bar of rest is announced at the next note instead of where it was
  written. Pitches are unaffected either way; only the announcement moves.
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
