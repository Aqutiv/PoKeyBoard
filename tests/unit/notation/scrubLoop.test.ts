import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { scrubController } from '@/features/notation/scrubController';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

// What the scrub sounds is the engine's to play; this is about which notes,
// in what order, and where the playhead lands.
vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    scheduleNote: vi.fn(),
    currentTime: 0,
    activeInstrument: { packVersion: 'test-pack' },
    bank: { isCalibrated: vi.fn(() => true) },
  },
}));

function note(id: string, startMs: number, midi: number): NoteEvent {
  return { id, midi, startMs, durationMs: 200, velocity: 0.6 };
}

/** The keys auditioned since the last look, in the order they sounded. */
function sounded(): number[] {
  const calls = vi.mocked(audioEngine.scheduleNote).mock.calls;
  const midis = calls.map(([event]) => event.midi);
  vi.mocked(audioEngine.scheduleNote).mockClear();
  return midis;
}

describe('a scrub round a loop', () => {
  const LOOP = { startMs: 1000, endMs: 2000 };

  beforeEach(() => {
    // The loop's top, its middle, and a note on its end, outside it.
    const notes = [note('top', 1000, 60), note('middle', 1500, 64), note('end', 2000, 67)];
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 3000 }));
    useSettingsStore.getState().setScrubAudition(true);
    transportController.seek(1200);
    vi.mocked(audioEngine.scheduleNote).mockClear();
  });

  afterEach(() => {
    scrubController.end();
  });

  it('comes round past the end to the top, sounding the top but never the note on the end', () => {
    expect(scrubController.begin(LOOP)).toBe(true);
    // 2300 on the run is 1300 on the second pass.
    scrubController.update(2300);
    expect(transportController.getPlayheadMs()).toBe(1300);
    expect(sounded()).toEqual([64, 60]);
  });

  it('begins its pass where it went furthest back, or at the loop’s top once round', () => {
    scrubController.begin(LOOP);
    expect(scrubController.getPassStartMs()).toBe(1200);
    scrubController.update(1100);
    expect(scrubController.getPassStartMs()).toBe(1100);
    scrubController.update(2300);
    expect(scrubController.getPassStartMs()).toBe(1000);
    // Back round into the first pass, which reached 1100.
    scrubController.update(1800);
    expect(transportController.getPlayheadMs()).toBe(1800);
    expect(scrubController.getPassStartMs()).toBe(1100);
  });

  it('runs straight on with no loop, as the score scrubs', () => {
    scrubController.begin();
    scrubController.update(2300);
    expect(transportController.getPlayheadMs()).toBe(2300);
    expect(sounded()).toEqual([64, 67]);
    expect(scrubController.getPassStartMs()).toBe(1200);
  });
});
