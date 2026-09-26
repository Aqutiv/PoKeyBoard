import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { curveDb } from '@/audio/velocityCurve';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { PREVIEW_VELOCITY_FLOOR, scrubController } from '@/features/notation/scrubController';
import { transportController } from '@/features/transport/transportController';
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

  it('puts the playhead back without a sound when a scrub is called off', () => {
    // A second finger on the score turns the first one's scrub into a pinch.
    const start = transportController.getPlayheadMs();
    const away = start < 250 ? 450 : 50; // across one of the notes either way
    scrubController.update(away);
    expect(transportController.getPlayheadMs()).toBe(away);
    vi.mocked(audioEngine.scheduleNote).mockClear();
    scrubController.cancel(start);
    expect(scrubController.isActive).toBe(false);
    expect(transportController.getPlayheadMs()).toBe(start);
    // Crossing that note again on the way back auditions nothing.
    expect(audioEngine.scheduleNote).not.toHaveBeenCalled();
    expect(scrubController.getActiveHands().size).toBe(0);
  });
});

describe('scrub auditions', () => {
  it('play a soft note at the floor and a louder one at 85% of its velocity', () => {
    const take = createEmptyTake({
      notes: [
        { id: 'soft', midi: 60, startMs: 100, durationMs: 200, velocity: 0.3 },
        { id: 'loud', midi: 64, startMs: 400, durationMs: 200, velocity: 0.9 },
      ],
      durationMs: 5_000,
    });
    useTakeStore.getState().setTake(take);
    expect(scrubController.begin()).toBe(true);
    scrubController.update(0);
    vi.mocked(audioEngine.scheduleNote).mockClear();
    scrubController.update(600);
    const auditioned = vi
      .mocked(audioEngine.scheduleNote)
      .mock.calls.map(([event]) => [event.midi, event.velocity]);
    expect(auditioned).toEqual([
      [60, PREVIEW_VELOCITY_FLOOR],
      [64, 0.9 * 0.85],
    ]);
    scrubController.end();
  });

  it('keep the floor as loud as it was before the grands were calibrated', () => {
    // 0.25 then, heard 4.1 dB under the computer keyboard's velocity on the
    // two grands; on the calibrated curve that takes about 0.51.
    expect(curveDb(PREVIEW_VELOCITY_FLOOR)).toBeCloseTo(-4.1, 9);
    expect(PREVIEW_VELOCITY_FLOOR).toBeCloseTo(0.506, 3);
  });
});
