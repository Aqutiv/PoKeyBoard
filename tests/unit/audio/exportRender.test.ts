import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import { estimateRenderSeconds, renderTakeForExport } from '@/audio/OfflineTakeRenderer';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';

/** The engine only has to decode a range of keys and hand out their samples. */
const h = vi.hoisted(() => ({
  ensurePlayableRange: vi.fn<(low: number, high: number, options: object) => Promise<void>>(
    async () => {},
  ),
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    whenSwitchSettled: async () => undefined,
    ensurePlayableRange: h.ensurePlayableRange,
    bank: {
      // The top strings have no damper: theirs ring 20 s, whenever let go.
      getSample: (midi: number): SampleSelection =>
        midi >= 100
          ? { buffer: { duration: 20 } as AudioBuffer, playbackRate: 1, gain: 1, undamped: true }
          : { buffer: { duration: 3 } as AudioBuffer, playbackRate: 1, gain: 1 },
    },
  },
}));

vi.mock('@/audio/PianoGraphFactory', () => ({
  createPianoGraph: () => ({ voiceDestination: {} }),
}));

/** Just enough of an OfflineAudioContext to make voices in and render nothing. */
class FakeOfflineContext {
  readonly currentTime = 0;
  readonly length: number;
  readonly sampleRate: number;

  constructor(options: { length: number; sampleRate: number }) {
    this.length = options.length;
    this.sampleRate = options.sampleRate;
  }

  createBufferSource() {
    return { playbackRate: { value: 1 }, start() {}, stop() {}, connect() {}, disconnect() {} };
  }

  createGain() {
    const gain = {
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      setTargetAtTime() {},
      cancelScheduledValues() {},
    };
    return { gain, connect() {}, disconnect() {} };
  }

  startRendering(): Promise<AudioBuffer> {
    return Promise.resolve({} as AudioBuffer);
  }
}

function note(id: string, midi: number, velocity: number): NoteEvent {
  return { id, midi, velocity, startMs: 0, durationMs: 500 };
}

const OPTIONS = { includeMetronome: false, metronomeVolume: 0 };

describe('an export render', () => {
  beforeEach(() => {
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
    h.ensurePlayableRange.mockClear();
  });

  it('decodes only the keys it plays, not one written but not played', async () => {
    const take = createEmptyTake({
      notes: [note('low', 60, 0.6), note('high', 67, 0.6), note('silent', 21, 0)],
      durationMs: 500,
    });
    await renderTakeForExport(take, OPTIONS);
    expect(h.ensurePlayableRange).toHaveBeenCalledTimes(1);
    expect(h.ensurePlayableRange).toHaveBeenCalledWith(60, 67, { remember: false });
  });

  it('decodes nothing for a take of notes written but not played', async () => {
    const take = createEmptyTake({ notes: [note('silent', 60, 0)], durationMs: 500 });
    await renderTakeForExport(take, OPTIONS);
    expect(h.ensurePlayableRange).not.toHaveBeenCalled();
  });

  it('estimates the length of what it plays, not a silent top string ringing out', () => {
    const played = note('played', 60, 0.6);
    const top = { ...note('top', 105, 0.6), startMs: 400 };
    const estimate = (notes: NoteEvent[]) =>
      estimateRenderSeconds(createEmptyTake({ notes, durationMs: 900 }));
    expect(estimate([played, top])).toBeGreaterThan(20);
    expect(estimate([played, { ...top, velocity: 0 }])).toBe(estimate([played]));
  });
});
