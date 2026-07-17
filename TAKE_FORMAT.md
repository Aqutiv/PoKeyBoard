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
    "countInBars": 1
  },
  "instrument": { "id": "grand-piano", "masterVolume": 0.85, "reverbMix": 0.18 },
  "notes": [{ "id": "uuid", "midi": 60, "startMs": 0, "durationMs": 420, "velocity": 0.78 }],
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
- `quantization` `off | 1/8 | 1/16` — **display only**; raw performance timing is never quantized.
- Unknown **top-level** keys are preserved through import/export (forward compatibility).

## Import pipeline

`migrate → repair → validate → normalize`:

1. **Migrate:** `schemaVersion` above the app's is rejected with an "update PoKeyBoard" message; older versions run registered migrations (registry in `takeMigrations.ts`; empty at v1). Missing version is treated as v1.
2. **Repair (only clearly recoverable):** round fractional ms; bump zero durations to 1 ms; clamp float-precision drift on 0–1 fields; generate missing ids; default missing title/timestamps/display/pedalEvents; clamp out-of-range bpm/count-in. Every repair is reported in the import preview.
3. **Validate:** Zod schema; failures list human-readable `path: message` issues.
4. **Normalize:** notes sorted by `(startMs, midi, id)`, pedals by time, `durationMs` recomputed from note ends, playhead clamped.

Imports whose `id` already exists locally become a **copy with a fresh id** unless the user explicitly chooses replacement in the preview dialog.

## Backup files

`PoKeyBoard Backup - YYYY-MM-DD.json`: `{ kind: "pokeyboard-backup", schemaVersion, createdAt, takes: Take[], settings: {…} }`. Restore validates each take through the same pipeline (bad entries are skipped and counted) and merges with fresh ids on collision. Backups never include the piano sample cache or rendered MP3s.
