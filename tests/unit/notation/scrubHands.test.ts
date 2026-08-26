import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { scrubController } from '@/features/notation/scrubController';
import { useTakeStore } from '@/state/useTakeStore';

// The auditions themselves are the engine's business; this is about the
// lights the key bed reads back.
vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    scheduleNote: vi.fn(),
    currentTime: 0,
    activeInstrument: { packVersion: 'test-pack' },
  },
}));

function note(id: string, startMs: number, staff: NoteEvent['staff']): NoteEvent {
  return { id, midi: 60, startMs, durationMs: 200, velocity: 0.6, staff };
}

describe('scrub key lights', () => {
  beforeEach(() => {
    const take = createEmptyTake({
      notes: [note('a', 100, 'bass'), note('b', 400, 'treble')],
      durationMs: 5_000,
    });
    useTakeStore.getState().setTake(take);
    expect(scrubController.begin()).toBe(true);
  });

  it('follows a key that changes hands within one flash', () => {
    scrubController.update(200);
    expect(scrubController.getActiveHands()).toEqual(new Map([[60, 'left']]));
    // The same pitch again from the other staff, well inside the 260ms flash:
    // one key lit either way, so a size check alone would keep it green.
    scrubController.update(500);
    expect(scrubController.getActiveHands()).toEqual(new Map([[60, 'right']]));
    scrubController.end();
  });
});
