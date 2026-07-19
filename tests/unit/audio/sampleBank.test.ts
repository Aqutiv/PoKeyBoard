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

describe('SampleBank retries', () => {
  it('rejects an incomplete core load and can retry while retaining progress', async () => {
    vi.useFakeTimers();
    const manifest = {
      version: 'test',
      source: 'test',
      license: 'test',
      sourceUrl: 'test',
      format: 'test',
      velocityLayers: [{ index: 0, sourceLayer: 1, label: 'test' }],
      coreBytes: 100,
      totalBytes: 100,
      files: [{ file: 'c4.mp3', midi: 60, layer: 0, pack: 'core' as const, bytes: 100 }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const context = {
      decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
    } as unknown as BaseAudioContext;
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
