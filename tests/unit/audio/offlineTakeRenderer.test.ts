import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { InstrumentSettings, ReverbRoom, Take } from '@/domain/takeTypes';

/**
 * The export's render without Web Audio: the graph factory, the voices and the
 * offline context are stubs, so what is under test is what the renderer asks of
 * them — which room its graph is built in, and how long it renders for.
 */
const { createPianoGraph, rendered } = vi.hoisted(() => ({
  createPianoGraph: vi.fn(() => ({ voiceDestination: {} })),
  rendered: [] as Array<{ length: number; sampleRate: number }>,
}));

vi.mock('@/audio/PianoGraphFactory', () => ({ createPianoGraph }));
vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    whenSwitchSettled: vi.fn(async () => undefined),
    ensurePlayableRange: vi.fn(async () => undefined),
    bank: {
      getSample: vi.fn(() => ({ buffer: { duration: 4 }, playbackRate: 1, gain: 1 })),
    },
  },
}));
vi.mock('@/audio/sampleVoice', () => ({
  UNDAMPED_FROM_MIDI: 91,
  startSampleVoice: vi.fn(() => ({})),
  releaseSampleVoice: vi.fn(),
  dampSampleVoice: vi.fn(),
  stillSoundingAt: vi.fn(() => false),
}));

/** An offline context that cannot pause, so every voice is made up front. */
class StubOfflineContext {
  readonly length: number;
  readonly sampleRate: number;
  constructor(options: { length: number; sampleRate: number }) {
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    rendered.push({ length: options.length, sampleRate: options.sampleRate });
  }
  startRendering() {
    return Promise.resolve({ length: this.length, sampleRate: this.sampleRate });
  }
}

beforeEach(() => {
  vi.stubGlobal('OfflineAudioContext', StubOfflineContext);
  createPianoGraph.mockClear();
  rendered.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A one-second take, its room as stored — or no room at all, as before rooms. */
function takeIn(room: ReverbRoom | undefined): Take {
  const instrument: InstrumentSettings = { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.3 };
  if (room) instrument.reverbRoom = room;
  return createEmptyTake({
    instrument,
    notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 1000, velocity: 0.7 }],
    durationMs: 1000,
  });
}

describe('rendering a take for export', () => {
  it.each([
    [undefined, 'room', 3],
    ['studio', 'studio', 3],
    ['room', 'room', 3],
    ['hall', 'hall', 3.3],
    ['cathedral', 'cathedral', 5],
  ] as const)(
    'renders a take stored with %s in %s, leaving its tail %s s to ring',
    async (stored, room, tailS) => {
      const { estimateRenderSeconds, renderTakeForExport } =
        await import('@/audio/OfflineTakeRenderer');
      const take = takeIn(stored);
      await renderTakeForExport(take, { includeMetronome: false, metronomeVolume: 0 });

      expect(createPianoGraph).toHaveBeenCalledTimes(1);
      expect(createPianoGraph).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reverbMix: 0.3, reverbRoom: room, peakGuard: false }),
      );
      // The take's last key-up, then the tail: at least 3 s, and the room's
      // RT60 and half a second more where that is longer.
      expect(rendered).toEqual([{ length: Math.ceil((1 + tailS) * 48_000), sampleRate: 48_000 }]);
      expect(estimateRenderSeconds(take)).toBeCloseTo(1 + tailS, 10);
    },
  );

  it('counts a long room’s tail in the memory it warns about', async () => {
    const { estimateRenderMemoryMB } = await import('@/audio/OfflineTakeRenderer');
    // Two of the stereo float copies, 48 000 frames a second.
    expect(estimateRenderMemoryMB(takeIn('cathedral'))).toBe(Math.round((6 * 48_000 * 16) / 1e6));
    expect(estimateRenderMemoryMB(takeIn(undefined))).toBe(Math.round((4 * 48_000 * 16) / 1e6));
  });

  it('rings the room’s tail on from what the take plays, not from a silent note', async () => {
    const { estimateRenderMemoryMB, estimateRenderSeconds, renderTakeForExport } =
      await import('@/audio/OfflineTakeRenderer');
    // A note written but not played, under a pedal held to 8 s: counted, the
    // pedal would hold the render open to 8 s before the tail began.
    const take = createEmptyTake({
      instrument: {
        id: 'grand-piano',
        masterVolume: 0.85,
        reverbMix: 0.3,
        reverbRoom: 'cathedral',
      },
      notes: [
        { id: 'played', midi: 60, startMs: 0, durationMs: 1000, velocity: 0.7 },
        { id: 'silent', midi: 64, startMs: 2000, durationMs: 500, velocity: 0 },
      ],
      pedalEvents: [
        { atMs: 1500, down: true },
        { atMs: 8000, down: false },
      ],
      durationMs: 2500,
    });
    await renderTakeForExport(take, { includeMetronome: false, metronomeVolume: 0 });

    // Its written length, 2.5 s, then the Cathedral's 5 s.
    expect(rendered).toEqual([{ length: Math.ceil(7.5 * 48_000), sampleRate: 48_000 }]);
    expect(estimateRenderSeconds(take)).toBeCloseTo(7.5, 10);
    expect(estimateRenderMemoryMB(take)).toBe(Math.round((7.5 * 48_000 * 16) / 1e6));
  });
});
