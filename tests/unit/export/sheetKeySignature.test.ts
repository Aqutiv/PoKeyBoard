import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { defaultKeySignatureFor } from '@/features/export/sheetPdfService';

function note(id: string, midi: number, startMs: number, hidden = false): NoteEvent {
  return { id, midi, startMs, durationMs: 250, velocity: 0.6, ...(hidden ? { hidden } : {}) };
}

describe('defaultKeySignatureFor', () => {
  it('reads the key from the written notes, not from the hidden ones', () => {
    // A plain C major line, and a long hidden run in B major playing beside it.
    const written = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => note(`w${i}`, midi, i * 500));
    const hidden = [71, 73, 75, 76, 78, 80, 82, 83].flatMap((midi, i) =>
      [0, 1, 2, 3].map((k) => note(`h${i}-${k}`, midi, i * 500 + k * 120, true)),
    );
    const take = createEmptyTake({ notes: [...written, ...hidden] });
    expect(defaultKeySignatureFor(createEmptyTake({ notes: written }))).toBe(0);
    expect(defaultKeySignatureFor(take)).toBe(0);
    // The hidden run alone would read as a sharp key, so it is really ignored.
    const unhidden = createEmptyTake({
      notes: [...written, ...hidden.map((n) => ({ ...n, hidden: false }))],
    });
    expect(defaultKeySignatureFor(unhidden)).toBeGreaterThan(0);
  });
});
