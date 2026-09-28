import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import { AudioEngine } from '@/audio/AudioEngine';

vi.mock('@/audio/PianoGraphFactory', () => ({
  createPianoGraph: () => ({
    voiceDestination: {},
    outputDestination: {},
    setMasterVolume: () => undefined,
    setReverbMix: () => undefined,
    setReverbRoom: () => undefined,
    dispose: () => undefined,
  }),
}));

/** Enough of a running AudioContext for voices to start, fade and stop. */
class FakeAudioContext {
  readonly state = 'running';
  readonly currentTime = 0;
  readonly sampleRate = 48_000;
  addEventListener(): void {}
  createBufferSource() {
    return {
      playbackRate: { value: 1 },
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}

const SAMPLE: SampleSelection = {
  buffer: { duration: 3 } as AudioBuffer,
  playbackRate: 1,
  gain: 0.8,
};

/**
 * An engine with a context and a piano that always has a recording to hand.
 * Its own core load waits for a restore that never comes, so nothing is fetched.
 */
function engineWithPiano(): AudioEngine {
  const engine = new AudioEngine();
  engine.initialize();
  vi.spyOn(engine.bank, 'getSample').mockReturnValue(SAMPLE);
  return engine;
}

/** Every snapshot the engine announces, as it announces it. */
function recordSnapshots(engine: AudioEngine): Array<ReadonlyMap<number, number>> {
  const seen: Array<ReadonlyMap<number, number>> = [];
  engine.subscribeActiveNotes(() => seen.push(engine.getActiveVelocities()));
  return seen;
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the velocities of the keys played live', () => {
  it('lights a key with the velocity it was struck at', () => {
    const engine = engineWithPiano();
    expect(engine.noteOn(60, 0.3, 'pointer:1')).toBe(true);
    expect(engine.noteOn(64, 0.9, 'kbd')).toBe(true);
    expect(engine.getActiveVelocities()).toEqual(
      new Map([
        [60, 0.3],
        [64, 0.9],
      ]),
    );
    expect([...engine.getActiveVelocities().keys()]).toEqual([...engine.getActiveNotes()]);
  });

  it('shows a key struck again at the new strike, in every snapshot it sends', () => {
    const engine = engineWithPiano();
    engine.noteOn(60, 0.3, 'midi');
    const seen = recordSnapshots(engine);
    // Another source on the same key: the old voice gives way, the new one lights.
    engine.noteOn(60, 0.95, 'pointer:1');
    expect(engine.getActiveVelocities().get(60)).toBe(0.95);
    for (const snapshot of seen) {
      if (snapshot.has(60)) expect(snapshot.get(60)).toBe(0.95);
    }
  });

  it('lets a key go dark when it is let go', () => {
    const engine = engineWithPiano();
    engine.noteOn(60, 0.5, 'kbd');
    engine.noteOff(60, 'kbd');
    expect(engine.getActiveVelocities().size).toBe(0);
    engine.noteOn(62, 0.6, 'kbd');
    engine.allNotesOff();
    expect(engine.getActiveVelocities().size).toBe(0);
  });

  it('keeps one snapshot until something changes', () => {
    const engine = engineWithPiano();
    engine.noteOn(60, 0.5, 'kbd');
    const snapshot = engine.getActiveVelocities();
    expect(engine.getActiveVelocities()).toBe(snapshot);
    engine.noteOn(62, 0.5, 'kbd');
    expect(engine.getActiveVelocities()).not.toBe(snapshot);
  });

  it('records nothing for a key with no recording to play', () => {
    const engine = engineWithPiano();
    vi.mocked(engine.bank.getSample).mockReturnValueOnce(null);
    expect(engine.noteOn(60, 0.2, 'kbd')).toBe(false);
    expect(engine.getActiveVelocities().size).toBe(0);
    engine.noteOn(60, 0.7, 'kbd');
    expect(engine.getActiveVelocities().get(60)).toBe(0.7);
  });
});
