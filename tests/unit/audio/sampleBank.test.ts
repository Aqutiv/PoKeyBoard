import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  onsetOffsetOf,
  SampleBank,
  velocityGain,
  velocityToLayer,
  VELOCITY_LAYER_THRESHOLDS,
} from '@/audio/SampleBank';

/** Two channels of silence with a note starting at `onsetS` — enough AudioBuffer for the scan. */
function recording(onsetS: number, rate = 48_000): AudioBuffer {
  const length = rate;
  const channels = [new Float32Array(length), new Float32Array(length)];
  const onset = Math.round(onsetS * rate);
  for (const data of channels) {
    // A little noise floor, 60 dB down, then a decaying strike.
    for (let i = 0; i < onset; i += 1) data[i] = (i % 2 === 0 ? 1 : -1) * 0.0008;
    for (let i = onset; i < length; i += 1) data[i] = 0.8 * Math.exp(-(i - onset) / rate / 0.3);
  }
  return {
    sampleRate: rate,
    length,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel]!,
  } as unknown as AudioBuffer;
}

describe('onsetOffsetOf', () => {
  it('skips the silence before the note, keeping a millisecond of it', () => {
    expect(onsetOffsetOf(recording(0.012))).toBeCloseTo(0.011, 3);
  });

  it('leaves a recording that starts on its note alone', () => {
    expect(onsetOffsetOf(recording(0))).toBe(0);
  });

  it('never trims more than a recording could plausibly need', () => {
    expect(onsetOffsetOf(recording(0.2))).toBe(0.05);
  });

  it('leaves a silent file alone rather than guessing', () => {
    const silent = {
      sampleRate: 48_000,
      length: 480,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(480),
    } as unknown as AudioBuffer;
    expect(onsetOffsetOf(silent)).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('velocityToLayer', () => {
  it('maps velocity bands to the three layers', () => {
    expect(velocityToLayer(0)).toBe(0);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[0] - 0.01)).toBe(0);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[0])).toBe(1);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[1] - 0.01)).toBe(1);
    expect(velocityToLayer(VELOCITY_LAYER_THRESHOLDS[1])).toBe(2);
    expect(velocityToLayer(1)).toBe(2);
  });
});

// The gain of a pack with no velocity calibration. The grands have one, and
// velocityCalibration.test.ts holds them to meeting themselves at every layer
// boundary; these are the looser promises of the fallback.
describe('velocityGain, for a pack with no calibration', () => {
  it('is monotonically non-decreasing within a layer', () => {
    for (let layer = 0; layer < 3; layer += 1) {
      let previous = 0;
      for (let v = 0.05; v <= 1; v += 0.05) {
        const gain = velocityGain(v, layer);
        expect(gain).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = gain;
      }
    }
  });

  it('stays within the safety clamp', () => {
    for (let layer = 0; layer < 3; layer += 1) {
      for (const v of [0, 0.001, 0.3, 0.6, 0.9, 1]) {
        const gain = velocityGain(v, layer);
        expect(gain).toBeGreaterThanOrEqual(0.25);
        expect(gain).toBeLessThanOrEqual(1.7);
      }
    }
  });

  it('does not jump wildly across layer boundaries', () => {
    for (const boundary of VELOCITY_LAYER_THRESHOLDS) {
      const below = velocityGain(boundary - 0.001, velocityToLayer(boundary - 0.001));
      const above = velocityGain(boundary + 0.001, velocityToLayer(boundary + 0.001));
      // The samples themselves get louder across the boundary; the applied
      // gain must not amplify that step by more than ~2x in either direction.
      // Only a bound: one trim per layer cannot match recordings that differ
      // note by note, which is what the calibration is for.
      expect(above / below).toBeGreaterThan(0.5);
      expect(above / below).toBeLessThan(2);
    }
  });
});

function stubManifest(levelMatch?: number) {
  const layer = { index: 0, sourceLayer: 1, label: 'test', ...(levelMatch ? { levelMatch } : {}) };
  return {
    version: 'test',
    source: 'test',
    license: 'test',
    sourceUrl: 'test',
    format: 'test',
    velocityLayers: [layer],
    coreBytes: 100,
    totalBytes: 100,
    files: [{ file: 'c4.sample', midi: 60, layer: 0, pack: 'core' as const, bytes: 100 }],
  };
}

function stubContext(): BaseAudioContext {
  return {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
  } as unknown as BaseAudioContext;
}

async function loadedBank(levelMatch?: number): Promise<SampleBank> {
  const manifest = stubManifest(levelMatch);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
  );
  const bank = new SampleBank('/samples/');
  await bank.loadCorePack(stubContext());
  return bank;
}

// The stub manifest's version has no calibration, so it plays by the fallback.
describe('a pack level match, where there is no calibration', () => {
  it('scales the voice gain past velocityGain’s own ceiling', async () => {
    const plain = await loadedBank();
    const base = plain.getSample(60, 0.9)?.gain;
    expect(base).toBeCloseTo(velocityGain(0.9, 2), 10);

    vi.unstubAllGlobals();
    const lifted = await loadedBank(5.3114);
    // velocityGain clamps at 1.7, so a quietly mastered pack can only be
    // brought up to the reference level outside that clamp.
    expect(lifted.getSample(60, 0.9)?.gain).toBeCloseTo((base as number) * 5.3114, 10);
  });

  it('uses the resolved layer’s correction, not the requested one', async () => {
    // Only the soft layer is loaded, so a loud note falls back to it and must
    // take the soft layer's level match with it.
    const bank = await loadedBank(5.3114);
    expect(bank.getSample(60, 0.9)?.gain).toBeCloseTo(velocityGain(0.9, 2) * 5.3114, 10);
  });

  it('defaults to no correction for a manifest that predates the measurement', async () => {
    const bank = await loadedBank();
    expect(bank.getSample(60, 0.5)?.gain).toBeCloseTo(velocityGain(0.5, 1), 10);
  });
});

describe('SampleBank.releaseBuffers', () => {
  it('frees the decoded audio and can reload afterwards', async () => {
    const bank = await loadedBank();
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.isMidiPlayable(60)).toBe(true);
    expect(bank.getProgress().loadedBytes).toBe(100);

    bank.releaseBuffers();
    expect(bank.isCoreReady()).toBe(false);
    expect(bank.isMidiPlayable(60)).toBe(false);
    expect(bank.getSample(60, 0.7)).toBeNull();
    expect(bank.getProgress().phase).toBe('idle');
    expect(bank.getProgress().loadedBytes).toBe(0);

    // The manifest is kept, so recovery re-decodes without refetching it.
    await bank.loadCorePack(stubContext());
    expect(bank.isCoreReady()).toBe(true);
  });

  it('discards a decode that lands after the release', async () => {
    const manifest = stubManifest();
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(1));
    bank.releaseBuffers();
    decodes[0]?.({ duration: 1 } as AudioBuffer);

    // The buffer that arrived is dropped. A load called off like this — a piano
    // switch overtaken by another — is no failure, so it reports none.
    await expect(loading).resolves.toBeUndefined();
    expect(bank.isMidiPlayable(60)).toBe(false);
    expect(bank.isCoreReady()).toBe(false);
    expect(bank.getProgress().phase).toBe('idle');
    expect(bank.getProgress().error).toBeUndefined();
  });

  it('stops a released load before the files still queued, which would keep what they decode', async () => {
    const manifest = {
      ...stubManifest(),
      // More files than the bank fetches at once, so some wait in the queue.
      files: [48, 51, 54, 57, 60, 63, 66, 69].map((midi) => ({
        file: `m${midi}.sample`,
        midi,
        layer: 0,
        pack: 'core' as const,
        bytes: 1,
      })),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    vi.stubGlobal('fetch', fetchMock);
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(4));
    bank.releaseBuffers();
    for (const decode of decodes) decode({ duration: 1 } as AudioBuffer);
    await loading;

    // The manifest and the four under way; the four queued are never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(bank.getProgress().loadedFiles).toBe(0);
    expect(bank.isMidiPlayable(60)).toBe(false);
  });

  it('decodes afresh for a load that starts after the release, not waiting on the dropped one', async () => {
    const manifest = stubManifest();
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    // Chosen, called off, and chosen again before the first decode lands.
    const first = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(1));
    bank.releaseBuffers();
    const second = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(2));

    decodes[0]?.({ duration: 1 } as AudioBuffer);
    await first;
    expect(bank.isCoreReady()).toBe(false);
    decodes[1]?.({ duration: 1 } as AudioBuffer);
    await second;
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.getProgress().phase).toBe('core-ready');
  });
});

describe('SampleBank progress', () => {
  it('counts the core pack apart from the extras loaded on demand', async () => {
    const manifest = {
      ...stubManifest(),
      coreBytes: 100,
      totalBytes: 400,
      files: [
        { file: 'c4.sample', midi: 60, layer: 0, pack: 'core' as const, bytes: 100 },
        { file: 'c2.sample', midi: 36, layer: 0, pack: 'full' as const, bytes: 300 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const bank = new SampleBank('/samples/');
    const context = stubContext();

    await bank.loadCorePack(context);
    // Readiness waits on the core alone, so a loading readout has to count the
    // core alone — counted against the whole pack it stalled at a fraction.
    expect(bank.getProgress()).toMatchObject({
      phase: 'core-ready',
      coreLoadedBytes: 100,
      coreTotalBytes: 100,
      loadedBytes: 100,
      totalBytes: 400,
    });

    await bank.ensureRangeLoaded(context, 36, 36);
    expect(bank.getProgress()).toMatchObject({
      coreLoadedBytes: 100,
      coreTotalBytes: 100,
      loadedBytes: 400,
    });

    bank.releaseBuffers();
    expect(bank.getProgress()).toMatchObject({ coreLoadedBytes: 0, coreTotalBytes: 100 });
  });
});

describe('SampleBank retries', () => {
  it('rejects an incomplete core load and can retry while retaining progress', async () => {
    vi.useFakeTimers();
    const manifest = stubManifest();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const context = stubContext();
    const bank = new SampleBank('/samples/');

    const failed = bank.loadCorePack(context);
    const failedAssertion = expect(failed).rejects.toThrow(/could not be loaded/);
    await vi.runAllTimersAsync();
    await failedAssertion;
    expect(bank.getProgress().phase).toBe('error');

    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    await bank.loadCorePack(context);
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.getProgress().phase).toBe('core-ready');
  });
});
