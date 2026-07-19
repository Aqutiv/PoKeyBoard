import { describe, expect, it } from 'vitest';
import {
  applySustainToNotes,
  effectivePlaybackDurationMs,
} from '@/features/transport/sustainPedal';
import { createEmptyTake } from '@/domain/noteEvents';
import { MAX_NOTE_DURATION_MS, type NoteEvent, type PedalEvent } from '@/domain/takeTypes';

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 200, velocity: 0.5, ...partial };
}

describe('applySustainToNotes', () => {
  it('returns notes unchanged without pedal events', () => {
    const notes = [note({})];
    expect(applySustainToNotes(notes, [])).toEqual(notes);
  });

  it('extends a note released while the pedal is down to the pedal-up', () => {
    const pedals: PedalEvent[] = [
      { atMs: 100, down: true },
      { atMs: 1000, down: false },
    ];
    const [extended] = applySustainToNotes([note({ startMs: 0, durationMs: 200 })], pedals);
    expect(extended!.durationMs).toBe(1000);
  });

  it('leaves notes alone when the pedal is up at their release', () => {
    const pedals: PedalEvent[] = [
      { atMs: 500, down: true },
      { atMs: 1000, down: false },
    ];
    const [unchanged] = applySustainToNotes([note({ startMs: 0, durationMs: 200 })], pedals);
    expect(unchanged!.durationMs).toBe(200);
  });

  it('never shortens a note that already rings past the pedal-up', () => {
    const pedals: PedalEvent[] = [
      { atMs: 0, down: true },
      { atMs: 300, down: false },
    ];
    const [kept] = applySustainToNotes([note({ startMs: 100, durationMs: 5000 })], pedals);
    expect(kept!.durationMs).toBe(5000);
  });

  it('rings to a cap when the pedal never comes up', () => {
    const pedals: PedalEvent[] = [{ atMs: 0, down: true }];
    const [ringing] = applySustainToNotes([note({ startMs: 50, durationMs: 100 })], pedals);
    expect(ringing!.durationMs).toBeGreaterThan(100);
    expect(ringing!.durationMs).toBeLessThanOrEqual(MAX_NOTE_DURATION_MS);
  });

  it('handles repeated pedal cycles', () => {
    const pedals: PedalEvent[] = [
      { atMs: 0, down: true },
      { atMs: 400, down: false },
      { atMs: 600, down: true },
      { atMs: 1200, down: false },
    ];
    const notes = [
      note({ id: 'a', startMs: 0, durationMs: 100 }), // released in first cycle → 400
      note({ id: 'b', startMs: 450, durationMs: 50 }), // released while pedal up → unchanged
      note({ id: 'c', startMs: 700, durationMs: 100 }), // second cycle → 1200 − 700
    ];
    const result = applySustainToNotes(notes, pedals);
    expect(result[0]!.durationMs).toBe(400);
    expect(result[1]!.durationMs).toBe(50);
    expect(result[2]!.durationMs).toBe(500);
  });

  it('derives an audible duration that includes a sustained tail', () => {
    const take = createEmptyTake({
      durationMs: 200,
      notes: [note({ startMs: 0, durationMs: 200 })],
      pedalEvents: [
        { atMs: 100, down: true },
        { atMs: 1_000, down: false },
      ],
    });
    expect(effectivePlaybackDurationMs(take)).toBe(1_000);
  });

  it('handles the maximum event count without quadratic rescanning', () => {
    const notes = Array.from({ length: 50_000 }, (_, index) =>
      note({ id: `n-${index}`, startMs: index * 2, durationMs: 1 }),
    );
    const pedals = Array.from({ length: 1_000 }, (_, index) => ({
      atMs: index * 100,
      down: index % 2 === 0,
    }));
    expect(applySustainToNotes(notes, pedals)).toHaveLength(notes.length);
  });
});
