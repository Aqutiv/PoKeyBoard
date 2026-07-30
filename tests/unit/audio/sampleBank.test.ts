import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SampleBank,
  velocityGain,
  velocityToLayer,
  VELOCITY_LAYER_THRESHOLDS,
} from '@/audio/SampleBank';

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

describe('velocityGain', () => {
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

describe('a pack level match', () => {
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

    // The core never completes, because the buffer that arrived was dropped.
    await expect(loading).rejects.toThrow(/incomplete/i);
    expect(bank.isMidiPlayable(60)).toBe(false);
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
