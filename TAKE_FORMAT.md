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
  "samplePackVersion": "salamander-grand-v1",
  "tempo": {
    "bpm": 120,
    "timeSignature": { "numerator": 4, "denominator": 4 },
    "countInBars": 1,
    "changes": [{ "atMs": 60000, "bpm": 104 }]
  },
  "instrument": { "id": "grand-piano", "masterVolume": 0.85, "reverbMix": 0.18 },
  "notes": [
    { "id": "uuid", "midi": 60, "startMs": 0, "durationMs": 420, "velocity": 0.78 },
    { "id": "uuid", "midi": 48, "startMs": 0, "durationMs": 420, "velocity": 0.7, "staff": "bass" }
  ],
  "pedalEvents": [
    { "atMs": 1000, "down": true },
    { "atMs": 1800, "down": false }
  ],
  "display": { "quantization": "1/16", "zoom": 1, "playheadMs": 0 }
}
```

## Validation rules (src/domain/takeSchema.ts)

- `midi` 0–127 integer; `velocity` 0–1; `startMs ≥ 0`; `durationMs ≥ 1` (≤ 2 min per note); take timeline capped at 6 h; ≤ 50 000 notes. `NaN`/`Infinity` anywhere is rejected.
- `bpm` 40–240; `countInBars` 0|1|2; denominator 2|4|8|16.
- `tempo.changes` is **optional** (absent means one tempo throughout): sorted, `atMs ≥ 1`, `bpm` 40–240, ≤ 1024 entries. Note timing is always absolute ms, so a tempo map never moves a note — it tells the notation where bar lines fall and which note values to draw. Added without a schema bump: older takes parse untouched, and an older build drops the field.
- `quantization` `off | 1/8 | 1/16 | 1/32 | 1/64` — **display only**; raw performance timing is never quantized. An imported score arrives on the grid that can state its own shortest value — one level finer again where that value is dotted, since a length rounds to a whole number of grid steps (1/16 floor, 1/64 ceiling).
- A note's `staff` (`treble | bass`), `voice` (integer 0–15) and `clef` (`treble | bass`) are
  **optional engraving hints from an imported score**, never audible: `staff` is the hand the
  source wrote the note on and overrides the notation's middle-C split, `voice` says which notes
  share a stem, and `clef` is how that staff is read where the note falls — present only when it
  differs from the staff's own, which is how a high left hand avoids a ladder of ledger lines.
  Recorded takes omit all three and the notation falls back to pitch, written note value, and the
  staff's own clef. Added the same way `tempo.changes` was — no schema bump, older takes parse
  untouched, an older build drops them.
- `samplePackVersion` names the piano the take is heard through — one of the pack directories in `public/piano/` (`salamander-grand-v2`, `headroom-grand-v1`, or a retired one like `salamander-grand-v1`). It is **not** honoured on load: the selected piano wins, and opening a take re-stamps it, so live playback and the exported MP3 always agree. An unknown value is therefore harmless, and a missing one repairs to the default piano. `instrument.id` is unrelated to the choice of piano and stays `grand-piano`.
- Unknown **top-level** keys are preserved through import/export (forward compatibility).

## Import pipeline

`migrate → repair → validate → normalize`:

1. **Migrate:** `schemaVersion` above the app's is rejected with an "update PoKeyBoard" message; older versions run registered migrations (registry in `takeMigrations.ts`; empty at v1). Missing version is treated as v1.
2. **Repair (only clearly recoverable):** round fractional ms; bump zero durations to 1 ms; clamp float-precision drift on 0–1 fields; generate missing ids; default missing title/timestamps/display/pedalEvents; clamp out-of-range bpm/count-in; sort, round, clamp and de-duplicate tempo changes (dropping unsalvageable ones). Every repair is reported in the import preview.
3. **Validate:** Zod schema; failures list human-readable `path: message` issues.
4. **Normalize:** notes sorted by `(startMs, midi, id)`, pedals by time, `durationMs` recomputed from note ends, playhead clamped.

Every entry point — the file pickers, a dropped file, a dropped link, and a pasted link — converges on this one pipeline and the same preview dialog. A dropped link is read from `text/uri-list`, falling back to plain text only when it carries an explicit `http(s)` scheme, so dragging ordinary selected text never starts a download. A downloaded link is classified by its file name first, then `Content-Type`, then a byte sniff, because hosts routinely mislabel MusicXML as `text/plain`.

Imports whose `id` already exists locally become a **copy with a fresh id** unless the user explicitly chooses replacement in the preview dialog.

## Backup files

`PoKeyBoard Backup - YYYY-MM-DD.json`: `{ kind: "pokeyboard-backup", schemaVersion, createdAt, takes: Take[], settings: {…} }`. Restore validates each take through the same pipeline (bad entries are skipped and counted) and merges with fresh ids on collision. Backups never include the piano sample cache or rendered MP3s.
