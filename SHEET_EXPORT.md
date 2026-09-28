# Sheet-music PDF export

Exports a take as printable, engraved-style sheet music (grand staff, black on
white) — one PDF per take, shared or downloaded exactly like the MP3 export.

## Pipeline

```
getTakeForExport(id)
  → layoutScore(notes, { bpm, timeSignature, tempoChanges, quantization: grid, minMeasures: 1 })
  → layoutSheet(score, { paper, title, subtitle, bpm, … })   src/features/notation/sheetLayout.ts
  → import('./sheetPdfWriter') on Generate                   src/features/export/sheetPdfService.ts
  → drawSheetPage(surface, page) per page                    src/features/notation/sheetRenderer.ts
      onto a vector surface writing PDF operators            src/features/export/pdfSurface.ts
  → pdf-lib save                                             src/features/export/sheetPdfWriter.ts
  → Blob → File → shareOrDownloadFile / downloadBlob
```

- `sheetLayout.ts` is pure geometry (unit-tested, no DOM): columns spaced
  roughly proportionally to duration, measures packed greedily into justified
  systems, systems flowed down pages, and dynamic vertical room for ledger
  notes, octave lines, pedal brackets and dynamics.
  Spacing and note values follow the tempo in force in
  each measure, so a take whose tempo changes still engraves correctly and
  gets a "♩ = n" mark where the new tempo takes over.
  All positions are in PDF points; `SHEET_GAP_PT` (staff space) scales the
  engraving.
- `sheetRenderer.ts` draws a page onto a `DrawSurface` (`drawSurface.ts`, the
  exact canvas subset it calls) in PDF points, y down: the dialog's scaled
  preview canvas, or the vector surface the PDF is written with, so the preview
  shows what prints. Every music symbol — clefs, brace, noteheads, flags,
  accidentals, rests, dots, time signature and tuplet digits, dynamics, the 8va
  label, the tempo mark's note — is a glyph of the **Bravura** music font (see
  _Music font_ below), placed by its SMuFL metrics and anchors, so the page is
  the same on every device. Staff and bar lines, stems, ledger lines, beams,
  ties, hairpins, pedal brackets and the octave line are drawn directly, and
  words and numbers — title, credit, measure and page numbers, "= n" — are set
  in Times.
  A title's own accidentals ("Nocturne in E♭") are the same glyphs
  (`sheetText.ts`), since Times has no ♭ to print; a title too long for the
  page is cut between whole graphemes. The live score draws the same glyphs
  (`scoreRenderer.ts`; see _Music font_).
- `sheetPdfService.ts` lays out, enforces the page cap and reports progress,
  then dynamically imports `sheetPdfWriter.ts` — the only module that reaches
  **pdf-lib** (MIT), so pdf-lib code-splits out of the dialog and loads on
  Generate; it is still precached by the service worker, so export works
  offline. The writer draws each page through `pdfSurface.ts` over the pure
  `vectorSurface.ts`, which keeps the canvas's state and path the way a canvas
  does and hands every fill, stroke and run of text to the PDF writer:
  - paths are **vectors**: arcs and ellipses become quarter-turn cubics,
    quadratics exact cubics, coordinates are rounded to 0.01 pt, and stroke
    widths follow the transform (a transform that would skew the pen throws);
  - each **music glyph is written once per file**, as a Form XObject holding
    its outline, and placed on a page with `q <cm> /Gn Do Q` wherever it is
    drawn, in the colour current there — a sharp's outline is about 2.4 KB of
    operators, a use about 45 bytes (`fillGlyph` on the surface; the preview's
    canvas, which has none, gets the same outline as a path);
  - text is set in the **standard Times fonts, which are not embedded** — a
    viewer substitutes its own Times, and the widths are standard. Strings are
    measured unkerned, which is what the PDF's `Tj` advances, after folding the
    spaces and hyphens WinAnsi lacks onto ones it has;
  - text Times cannot encode even then (Japanese, emoji) falls back to an
    image: the browser draws it, and it is embedded as a soft-masked image in
    the text colour. `measureText` and drawing share one plan per string, so
    the layout never disagrees with what is drawn.

  The writer yields between pages so progress and Cancel keep working. The
  goldens in `tests/unit/notation/__goldens__/` are page 1 of three sheets
  written through the same vector surface as SVG (`svgSurface.ts`, test-only),
  each glyph a `<defs>` path placed by `<use>`.

## Music font

The music symbols of the printed sheet and of the live score are Bravura
1.482, Steinberg's SMuFL font, under the SIL Open Font License 1.1 with the
Reserved Font Name "Bravura".

- `scripts/extract-music-glyphs.mjs` (run by hand; `--pin` re-pins) reads the
  60 glyphs the sheet and the score draw out of the font and writes two generated modules
  with neutral names: `glyphs/musicGlyphMetrics.ts` (advances, bounding boxes,
  the stem, flag and optical-centre anchors, the engraving defaults, in staff
  spaces) and `glyphs/musicGlyphOutlines.ts` (each outline as integer deltas in
  font units, 250 to the staff space), apart so layout code can read the
  metrics without loading the outlines. Its sources — the font, its metadata,
  its licence, SMuFL's glyph names — are pinned by URL, size and SHA-256 in
  `scripts/lib/music-glyphs.pins.json` and staged in the ignored
  `music-font-staging/`; opentype.js reads the font and is a devDependency
  only. It checks the font is CFF at 1000 units to the em, every coordinate an
  integer, no quadratics, and each control box within 0.02 spaces of the
  metadata's box.
- The subset is a Modified Version under the OFL, so nothing in it is named
  Bravura. Both modules open with a `/*!` legal comment carrying the copyright
  line, that statement and the whole licence; the build keeps legal comments,
  so it ships in the chunk that carries the glyphs, and the licence is also
  served verbatim at `licenses/music-glyphs-OFL.txt`. The font file itself is
  never shipped. The glyphs load with the notation code the live score and the
  sheet share, so they arrive with the Play page's score.
- `glyphs/drawGlyph.ts` places a glyph by its SMuFL origin at a staff space of
  its own and fills it once (nonzero), in the caller's colour;
  `glyphs/engravingGlyphs.ts` says which glyph draws what and does the
  arithmetic: widths, centres, the advance of a run of digits, and how long an
  unbeamed stem has to be to meet its flag.
- Placement follows the font: noteheads centred on their column, a second
  displaced by a head less a stem; stems 0.12 spaces wide from the far head's
  stem anchor, their centre 0.53 spaces from the head's (`STEM_X_G`); a lone
  32nd's or 64th's stem lengthened as its flag's anchor asks; ledger lines the
  font's thickness, reaching 0.4 spaces past the head except where they would
  run into an accidental; accidentals right-aligned a quarter space before the
  chord; time signatures and tuplet numerals as digit runs centred by their
  advances; dynamics by their optical centre, with a hairpin stopping half a
  space clear of a mark's ink.
- The live score (`scoreRenderer.ts`, on Play and in Learn) places the same
  glyphs by the same rules at 9 px to the staff space, taking every width and
  reach from the metrics. It keeps what the screen asks for: stems 1.6 px wide,
  so a second is displaced by a head less that stem, and a gutter of fixed
  width, so a time signature too wide for it — the 12 of 12/8 — is set smaller
  rather than the gutter growing and Learn's bars per line moving.

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
- Memory: vector, one page of operators at a time. A page's operators are
  compressed into its content stream as soon as it is drawn, so a long score
  never holds more than one page of them; a page averages 4–8 KB in the file
  (Moonlight: 13 pages, 56 KB; the denser Chopin Nocturne in E♭: 8 pages,
  59 KB), since each glyph is written once per file and placed by reference,
  against about 200 KB for the raster pages this replaced.
- Share must run in the click handler (user activation), same as audio.

## Rests, keys, ties, pedal

- **Note values** run from a whole note down to a **64th**, plain or dotted, and
  they are counted in 384ths of a whole note (`rests.ts`) so that every one of
  them — a dotted 64th included, which is what 384 rather than 192 buys — is a
  whole number of units and "may a value of this length start here" stays exact
  integer arithmetic. A 32nd carries three beams or flags and a 64th four
  (`beamCountFor`, read by both layouts and both renderers). Beamed, their stems
  lengthen by the depth the extra beams take up (`extraStemG`) so the innermost
  never arrives at the notehead; a lone one on paper carries a single flag
  glyph, and its stem runs as far as the flag's anchor asks (3.88 spaces up for
  a 32nd, 4.67 for a 64th).
- **Rests** are derived, never stored: a staff is occupied for as long as its
  notes are _written_, and the silence left over is filled with rests, split at
  beat boundaries and never across the middle of an even bar. A wholly silent
  bar takes one whole rest whatever the meter is. Because onsets snap to the
  grid, note _lengths_ snap to it too — otherwise a quarter played detached
  reads as a dotted eighth against a grid that already put the next note on the
  following beat, and the bar stops adding up. Nothing shorter than the grid's
  own step is ever written, so a page read on a 1/16 grid shows no 32nd rest: a
  sliver that survives rounding is residue, not music.
  A length rounds to a _whole_ number of steps, so a **dotted value needs a grid
  one level finer than its base**: a dotted sixteenth on a 1/16 grid rounds up to
  an eighth, and on 1/32 it is itself. An import therefore picks the grid that can
  state its shortest value rather than the one nearest to it
  (`gridForShortestQ`). The floor of the range is a dotted 64th, which would take
  a 1/128 grid and is written as a 32nd instead.
- **Key signatures** are `tempo.keySignature` when the score declared one
  (MusicXML `<key><fifths>`), otherwise a key read from the take's own pitches
  (`keyDetection.ts`, a duration-weighted Krumhansl–Kessler correlation; under
  twelve notes it stays in C major). The export dialog offers all fifteen and
  defaults to that answer. Whether the signature is read as its major key or its
  relative minor is decided the same way (`detectMode`, by correlation).
- **Spelling** — which letter each pitch is written on — comes first from the
  source: an imported note keeps its MusicXML `<step>`/`<alter>`, and a library
  track's note named with an accidental ("Eb4") keeps that name. Everything else
  is spelled in context by `pitchSpelling.ts`: the key's own scale notes (with a
  minor key's raised sixth and seventh) as the scale has them, and the rest on the
  line of fifths — nearest the key, chords kept compact (C7 has a B♭, E7 a G♯),
  and a chromatic note that moves by semitone written a letter away from where
  it goes (rising sharp, falling flat), never at the price of a double
  accidental a key does not call for. Double sharps and flats are drawn where a
  key needs them (G♯ minor's F𝄪). Measured against the spellings the vendored
  scores declare, this writes 96.7% of their notes as written, against 92.8%
  for the old one-table-per-key spelling.
- An accidental holds for the rest of its bar at the line it stands on and the
  bar line forgets it, so repeats are unmarked and a return to the key takes a
  natural.
  Accidentals that would foul each other stack into columns left of the chord,
  topmost nearest. The layout stacks them by the font's glyph boxes
  (`accidentalStacking.ts`), for the live score and the printed sheet alike,
  sharing a column only where the lower sign's top and the upper one's bottom
  fit between their lines — six steps for two sharps, seven for a flat under a
  sharp, five for two flats — and gives a double flat, wider than a column, two.
- **Ties** cut a note at every bar line it crosses, and again wherever no
  single value covers the remainder, so a note longer than a whole note is
  written rather than clamped and a ring-out past the bar line is engraved
  where it actually sounds. A tie carries its accidental with it. A tie whose
  ends land on different systems is drawn as a stub at each end.
- **Pedal** brackets go under the bass staff, in a row of their own, from every
  press to its release; a press outliving the system is left open at that end.
  The events were always recorded and imported — this is where they finally get
  drawn. Like every mark placed by time (dynamics, hairpins, octave lines), a
  press stands under the note it went down with, on a system's first downbeat
  as on any other; only a mark running on from the system before starts where
  the system's music does.
- **Octave lines** (see _Known limitations_ for where they come from) stand 2.6
  spaces off their staff, or further out wherever the music under them reaches
  past that. The whole mark — label, dashed line, and a hook that turns in only
  as far as the label reaches — keeps to one band as tall as the label, and the
  band stands half a space clear of every head and ledger line, accidental,
  dot, stem and flag, beam, tuplet numeral and tie under it, or within half a
  space of it either side. So a chord beside the passage counts where its ink
  reaches in — a flag under the label, ledger lines back under the hook — and
  one standing clear does not, however high it climbs; the printed spacing is
  known, where the live score's changes with zoom. A system reserves exactly
  the room the band needs past its music, with a tempo mark still on top and
  the pedal row under an 8vb. A line running on to the next system, if only to
  its first note, stops open at the end of the staff and picks up at the start
  of the next.
- **Beaming** is decided once, in `layoutScore`, so the printed page and the
  live score group runs the same way and commit a run to the same stem
  direction; `beamGeometry.ts` holds the line arithmetic in staff spaces, read
  as points here and as pixels on screen. Runs break at a rest, a beat group, or
  a voice; compound meters group per dotted beat, and in 4/4 four plain eighths
  beam as one half-bar group (never across the middle of the bar — lesson
  staves keep them in pairs, per beat, as their prose teaches). Different values
  beam together: the first beam spans the run, each further beam joins only the
  notes that carry it, and a note carrying one alone gets a short stub pointing
  toward the note it pairs with (a dotted eighth's sixteenth points back). Inside
  a tuplet a change of value still breaks the run, because its numeral counts
  its notes.
- **Chords struck a little unevenly** — rolled, or one hand behind the other —
  are written from their middle onset, across both staves, so they snap to one
  column instead of splitting across a grid line. The window is 40 ms, never
  more than half a grid step, and nothing with the live score's grid off, so a
  fast run is never read as a chord.
- **Dynamics** are read out of velocity (`dynamics.ts`) and set between the
  staves, which is where a pianist looks for them — a system carrying them
  opens its inter-staff gap, and one without is laid out exactly as before.
  The reading is deliberately deaf to detail, because a mark on every change of
  touch would say nothing: it takes a high percentile over a wide window of
  onsets, holds its band until the level clearly leaves it, and will not speak
  twice inside two bars. A steady climb or fall across a phrase becomes a
  hairpin with the marks kept at each end; a swell too long to taper visibly
  (more than six bars) stays as marks, which is what an edition writes. On
  paper a mark is the font's glyph for the whole of it, centred under its note
  by its optical centre, and a hairpin stops half a space clear of the ink of
  the mark at either end.

## Known limitations

- **Tuplets come from the score where it declares them, and from the playing
  where it does not.** An imported `<time-modification>` is kept on the note and
  is authoritative: it says how the beat divides, and no inference runs on a beat
  that has one. Where the score bracketed its groups, beams stop at the bracket,
  so a beat of six triplet sixteenths written as two threes prints two beams
  numbered 3 rather than one numbered 6.
  A declaration is honoured only where this notation can state it, which is
  every ratio whose slot is a whole number of 384ths of a whole note and divides
  the beat — thirds and sixths and their halvings. **Quintuplets, septuplets and
  ninths cannot be stated** (384 = 2⁷·3 has no 5 or 7), nor can a duplet against
  a compound meter or any tuplet counted in a value longer than the beat. Those
  keep the reading below, exactly as before, and are the ~18% of declared notes
  in the vendored pack that fall through.
  A recording declares nothing, so it is read from the playing: per staff, per
  beat, the onsets are scored against a binary division and a ternary one, and
  the ternary reading has to be substantially better before it is believed —
  writing straight quavers as triplets puts a wrong rhythm on the page, while
  missing a triplet leaves the page as it was. A hand holding too little of a
  beat to tell takes the other hand's answer, and where neither can speak the
  two are pooled; a hand with enough notes keeps its own reading, which is what
  preserves a real three-against-two. Only whole tuplets are numbered: "2" over
  two thirds of a triplet would name a duplet, a different rhythm. Where the
  score bracketed the figure, a beamed part of it takes the tuplet's own
  numeral — its first note shared with another voice, or split onto the other
  staff — since it is still that triplet.
  Two differences follow from where the answer came from. An inferred division
  reads the whole beat, since the beat's onsets are all the evidence there is; a
  declared one is made note by note, so a plain sixteenth written beside a
  sextuplet group keeps the ordinary grid instead of being dragged onto sixths.
  And a tuplet slot never chooses the display grid, because it is not on it.
  A declared tuplet note that starts inside its beat and holds past it — a
  triplet eighth tied into the next beat, which an import stores as one note —
  is written as the tuplet value up to the beat line, tied to plain values
  after it, rather than as one tuplet value too long for a beam to carry.
- A tuplet with no beam — a quarter-note triplet — carries no numeral, because
  the numeral is drawn on the beam and there is nowhere else to hang it.
  `<tuplet show-number="none">` is not honoured either.
- Octave lines are derived from pitch alone. A run of four or more chords
  reaching the second ledger line beyond a staff (C6 over the treble, C2 under
  the bass) is drawn an octave in under an `8va` or `8vb`; a single stray note
  is left where it is, since a line and a label cost a reader more than the
  ledger lines they save.
- Articulations, slurs, ornaments and repeats are still not drawn.
- A tuplet split between the hands — an arpeggio crossing the middle of the
  keyboard — is written with the right values on both staves. A recorded one
  carries no numeral on either, because neither holds a whole one; one the
  score bracketed numbers each beamed part. A single numeral for the whole
  figure would need it assigned to a single staff, which is the same middle-C
  limitation noted below.
- A dynamic mark sits at a fixed height in the inter-staff gap and nothing
  moves it, so a bass note stemming up into that gap can crowd one. It stays
  legible; engraving software nudges marks per-collision, and this does not.
- Staff assignment follows the imported score's own `staff` per note, so a
  left hand written at or above middle C still prints on the bass staff.
  Recorded takes, and sources with a single staff, split at middle C as
  before.
- A staff is read under whichever clef the source gives it, and a clef that
  turns over mid-piece is engraved after the bar line it takes over on (and
  in the prefix of every system that opens under it). Where it turns over on
  a system's first bar, the prefix alone shows it: that bar keeps no room
  after its bar line, so it is spaced, and its system filled, as if nothing
  turned over there. No courtesy clef is set at the end of the system before
  it. Only G and F clefs are supported; a C clef (alto, tenor) drops any
  override and the staff goes back to its own. A clef stands until something replaces it, so a measure with
  nothing on a staff carries the last one forward. The clef rides on the notes
  themselves, and derived rests carry none, so a change the source declares
  during a bar of rest is announced at the next note instead of where it was
  written. Pitches are unaffected either way; only the announcement moves.
- A note the source kept off the page (`hidden`: `print-object="no"` or no
  notehead — MuseScore's written-out trills and turns, and copies that
  complete a voice) is not engraved, and nothing it would have brought comes
  with it: no voice, stem vote, beat division or rest. It still plays, and
  the dynamics are read from every note as played, hidden ones included.
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
