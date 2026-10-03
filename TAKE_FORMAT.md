# Take format

Takes are versioned JSON. Files use the extension `.pokeyboard.json` (plain `.json` also imports). All times are **integer milliseconds** from the start of the take; pitch is canonical **MIDI** (note names are always derived, never trusted).

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "title": "My Take",
  "createdAt": "2026-07-17T10:00:00.000Z",
  "updatedAt": "2026-07-17T10:05:00.000Z",
  "durationMs": 12345,
  "samplePackVersion": "salamander-grand-v4",
  "tempo": {
    "bpm": 120,
    "timeSignature": { "numerator": 4, "denominator": 4 },
    "countInBars": 1,
    "changes": [{ "atMs": 60000, "bpm": 104 }]
  },
  "instrument": {
    "id": "grand-piano",
    "masterVolume": 0.85,
    "reverbMix": 0.18,
    "reverbRoom": "room"
  },
  "notes": [
    { "id": "uuid", "midi": 60, "startMs": 0, "durationMs": 420, "velocity": 0.78 },
    { "id": "uuid", "midi": 48, "startMs": 0, "durationMs": 420, "velocity": 0.7, "staff": "bass" },
    {
      "id": "uuid",
      "midi": 70,
      "startMs": 420,
      "durationMs": 420,
      "velocity": 0.7,
      "spelling": { "step": "B", "alter": -1 }
    }
  ],
  "pedalEvents": [
    { "atMs": 1000, "down": true },
    { "atMs": 1800, "down": false }
  ],
  "display": { "quantization": "1/16", "zoom": 1, "playheadMs": 0 }
}
```

## Validation rules (src/domain/takeSchema.ts)

- `midi` 0–127 integer; `velocity` 0–1, where 0 means written but not played (a score's `dynamics="0"`: engraved, and asked for in practice, but never sounded); `startMs ≥ 0`; `durationMs ≥ 1` (≤ 2 min per note); take timeline capped at 6 h; ≤ 50 000 notes. `NaN`/`Infinity` anywhere is rejected.
- `bpm` 20–240; `countInBars` 0|1|2; denominator 2|4|8|16. An import clamps the score’s marked tempo into this range **before** converting anything to milliseconds, so the tempo a take carries and the timing it stores always agree.
- `tempo.changes` is **optional** (absent means one tempo throughout): sorted, `atMs ≥ 1`, `bpm` 20–240, ≤ 1024 entries. Note timing is always absolute ms, so a tempo map never moves a note — it tells the notation where bar lines fall and which note values to draw. Added without a schema bump: older takes parse untouched, and an older build drops the field.
- `tempo.keySignature` (sharps positive, flats negative, −7…7) and `tempo.keyMode` (`major | minor`) are **optional** and never audible: the key an imported score declares in its first `<key>` — its `<fifths>`, and its `<mode>` when that names major or minor. The signature decides how pitches are spelled. A MIDI export declares a minor mode as the score gave it, but reads a major one from the pitches again, since "major" is often just what the exporting program wrote. Absent means the score never said, and each is read from the pitches instead. Added the same way `tempo.changes` was.
- `display.speed` (0.25–1.5, absent meaning 1) and `display.loop` (`{ startMs, endMs }`, end after start) are **practice state**, never audible in an export: how fast playback runs and the passage it repeats. Added without a schema bump; a speed out of range is clamped and a loop that cannot play is dropped rather than failing the take.
- `quantization` `off | 1/8 | 1/16 | 1/32 | 1/64` — **display only**; raw performance timing is never quantized. An imported score arrives on the grid that can state its own shortest value — one level finer again where that value is dotted, since a length rounds to a whole number of grid steps (1/16 floor, 1/64 ceiling).
- A note's `staff` (`treble | bass`), `voice` (integer 0–15) and `clef` (`treble | bass`) are
  **optional engraving hints from an imported score**, never audible: `staff` is the hand the
  source wrote the note on and overrides the notation's middle-C split, `voice` says which notes
  share a stem, and `clef` is how that staff is read where the note falls — present only when it
  differs from the staff's own, which is how a high left hand avoids a ladder of ledger lines.
  Recorded takes omit all three and the notation falls back to pitch, written note value, and the
  staff's own clef. Added the same way `tempo.changes` was — no schema bump, older takes parse
  untouched, an older build drops them.
- A note's `tuplet` is a fourth such hint: the `<time-modification>` the source declared, as
  `{ actual, normal, unit, group? }` — `actual` notes in the time of `normal`, counted in the note
  `unit` divides a whole note into (8 = eighth; a power of two, like a time signature's
  denominator), with `group` numbering the written `<tuplet>` bracket it belongs to so beams break
  where the score breaks them. It says how the beat this note falls in is _divided_, which the
  notation would otherwise have to infer from where the onsets landed — and inferring it wrong
  writes a sextuplet sixteenth as a dotted 32nd. Never audible: exports hash the same with it and
  without it. Recorded takes omit it and inference takes over.
- A note's `spelling` is a fifth hint: how the source wrote the pitch, as `{ step, alter }` —
  MusicXML's `<step>` letter (`C`…`B`) and `<alter>` (−2 double flat … 2 double sharp). `midi` 70
  is B♭ or A♯ only on paper, and a composer's choice beats any guess, so a note that carries one
  is written exactly that way. A spelling that names some other pitch is dropped on import rather
  than failing the take. Recorded takes omit it and are spelled from their key and context
  (`pitchSpelling.ts`). Never audible.
- A note's `hidden` is a sixth hint: `true` where the source kept the note off the page — MusicXML's
  `print-object="no"`, or a `<notehead>none</notehead>`. That is how MuseScore writes out a trill
  or a turn for playback beside the note carrying its sign, or completes a voice with a copy of a
  note another voice holds. A hidden note plays like any other — playback, scrubbing, the keyboard
  and both exports sound it, and it hashes the same as a printed one — but the notation never draws
  it and a training hold never waits for it. The mirror of velocity 0, which is written but never
  played. A tied note is hidden only if every link of it was. Only an import sets it, and only ever
  to `true`; `false` reads as printed. Takes imported before it existed draw their hidden notes
  until the score is imported again.
- `instrument.reverbRoom` (`studio | room | hall | cathedral`) is **optional**, and audible: the room the reverb models, which the export renders in and hashes (see AUDIO_EXPORT.md, Reverb). Absent means `room` — every take saved before there was a choice was heard there, through a reverb Room is calibrated to match — and new takes always carry it. A room this build does not know is dropped on import with a repair notice, and the take plays in `room`. Added without a schema bump, like `tempo.changes`: older takes parse untouched, and an older build drops the field and plays every take in its one room.
- `samplePackVersion` names the piano the take is heard through — one of the pack directories in `public/piano/` (`salamander-grand-v4`, `headroom-grand-v2`, `bitklavier-grand-v2`, `wurlitzer-ep203w-v1`, or a retired one like `salamander-grand-v3`). It is **not** honoured on load: the selected piano wins, and opening a take re-stamps it, so live playback and the exported MP3 always agree. An unknown value is therefore harmless, and a missing one repairs to the default piano. `instrument.id` is unrelated to the choice of piano and stays `grand-piano`.
- Unknown **top-level** keys are preserved through import/export (forward compatibility).

## Import pipeline

`migrate → repair → validate → normalize`:

1. **Migrate:** `schemaVersion` above the app's is rejected with an "update PoKeyBoard" message; older versions run registered migrations (registry in `takeMigrations.ts`; empty at v1). Missing version is treated as v1.
2. **Repair (only clearly recoverable):** round fractional ms; bump zero durations to 1 ms; clamp float-precision drift on 0–1 fields; generate missing ids; default missing title/timestamps/display/pedalEvents; clamp out-of-range bpm/count-in; sort, round, clamp and de-duplicate tempo changes (dropping unsalvageable ones); drop a reverb room this build does not know. Every repair is reported in the import preview.
3. **Validate:** Zod schema; failures list human-readable `path: message` issues.
4. **Normalize:** notes sorted by `(startMs, midi, id)` — a score import numbers its notes in the order the score is read, so two copies of one key at one moment keep the score's order — pedals by time, `durationMs` recomputed from note ends, playhead clamped.

Every entry point — the file pickers, a dropped file, a dropped link, and a pasted link — converges on this one pipeline and the same preview dialog. A dropped link is read from `text/uri-list`, falling back to plain text only when it carries an explicit `http(s)` scheme, so dragging ordinary selected text never starts a download. A downloaded link is classified by its file name first, then `Content-Type`, then a byte sniff, because hosts routinely mislabel MusicXML as `text/plain`.

Imports whose `id` already exists locally become a **copy with a fresh id** unless the user explicitly chooses replacement in the preview dialog.

## MIDI import

A Standard MIDI File (`.mid`, `.midi`) comes in through the same pickers, drops and links as a score. It is known by its `MThd` header whatever it is called, by a `.mid` name, or by an `audio/midi`, `audio/x-midi` or `audio/mid` Content-Type. `smfReader.ts` reads the bytes; `midiImport.ts` makes them a take, through the same last step as MusicXML (`importedTake.ts`), so the result passes the import pipeline with **no repairs**.

- **What is read:** types 0 and 1, timed in ticks per quarter. Type 2 (independent patterns) and SMPTE timing are refused with a message to save the file again as type 0 or 1; a damaged file (cut off mid-event, a data byte with no status, a number longer than four bytes) is refused as not MIDI. Unknown chunks and system exclusive are skipped; running status is followed, and kept across meta and system exclusive events — the standard says they end it, but some writers carry on using it, and in a file that follows the standard a status byte comes next anyway; a last track whose declared length runs past the file is read to its end.
- **Notes:** every note-on paired with the first note-off for the same key on the same channel of the same track (first in, first out); a note-on at velocity 0 is a note-off; a note never let go ends with its track. Channel 10 is drums and is left out — a file of nothing else is refused. Velocity is `v / 127`. At most 50,000 notes.
- **Time:** every millisecond comes from the file's own tempo map (♩=120 until the first tempo event), so the take plays exactly as the file does.
- **The tempo the take carries — folded, not clamped:** a take holds ♩=20–240, a file any tempo. Each tempo is folded into range by octaves (♩=400 is stored as ♩=200, ♩=10 as ♩=20): the notes keep their length and are written in values twice as long or half as long. One factor for the whole piece when one fits, so every bar keeps its length on the page, and the meter is restated to match (4/4 at ♩=400 becomes 4/8, at ♩=10 4/2); otherwise each tempo is folded on its own. Changes that round to one millisecond keep the later, and a change to the tempo already in force is dropped. A stored tempo comes back as the bpm with the fewest decimals (up to four) that rounds to the same microseconds — ♩=72 is stored as 833,333 µs and read as 72, not 72.0000288.
- **Grid — a written score or a performance:** only onsets are asked, never lengths. When at least 90% of distinct onsets (all of them under 8) sit on a binary position down to a 64th or on a triplet down to a 16th triplet — within 2.5 ticks at 960 to the quarter, the most the app's own export moves a note by rounding it to a millisecond — the file is a score, and gets the coarsest of 1/16, 1/32 and 1/64 its binary onsets fit, one step finer for each halving fold (coarser for each doubling, down to the 1/16 floor). "Fit" allows for chance: irregular tuplets (a run of 39 in the time of 32) put onsets on no written position, and a few of those land near a 64th anyway, so a finer grid is chosen only when the onsets that need it are more than twice what the off-grid onsets would put there by chance. A file with no off-grid onsets expects none, and one onset decides. Otherwise it is a performance, and gets 1/16 like a fresh recording.
- **Hands, as `staff`:** a file shaped like the app's own export — notes only on channels 1 and 2, each in a track of its own — is read back by channel (1 → treble, 2 → bass), even where the hands cross. Any other file with exactly two note sources (two tracks, or two channels of one) gives the treble to the one with the higher mean pitch. One source, or three or more, leaves `staff` unset, and the middle-C split decides as it does for a recording.
- **Pedal:** controller 64 at 64 or more is down. The pedal is down while any channel holds it — which also merges the copy the export writes into each hand's track — and where one channel lets go and another presses on the same tick, the letting go comes first.
- **The rest:** the title is the first track's name (UTF-8, else Windows-1252), else the file name. The first time signature and the first key signature are kept, except a key of C major, which many programs write whatever the music is in; the pitches then decide. No spelling, voices or tuplets are read: the notation's own readers supply them.

## Backup files

`PoKeyBoard Backup - YYYY-MM-DD.json`: `{ kind: "pokeyboard-backup", schemaVersion, createdAt, takes: Take[], settings: {…} }`. Restore validates each take through the same pipeline (bad entries are skipped and counted) and merges with fresh ids on collision. Backups never include the piano sample cache or rendered MP3s.
