import { readFileSync } from 'node:fs';
import { describe, expect, it, afterEach, vi } from 'vitest';
import type { SamplePackManifest } from '@/audio/audioTypes';
import { SampleBank } from '@/audio/SampleBank';
import { readFlacMetadata, parseWurlitzerRegions } from '../../../scripts/lib/wurlitzer.mjs';

const base = 'public/piano/wurlitzer-ep203w-v1/';
const manifest = JSON.parse(readFileSync(`${base}manifest.json`, 'utf8')) as SamplePackManifest;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function makeBank() {
  const buffers: AudioBuffer[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => manifest,
      arrayBuffer: async () => new TextEncoder().encode(url).buffer,
    })),
  );
  const context = {
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => {
      const buffer = {
        duration: 3,
        file: new TextDecoder().decode(bytes),
      } as unknown as AudioBuffer;
      buffers.push(buffer);
      return buffer;
    }),
  } as unknown as BaseAudioContext;
  const bank = new SampleBank('/wurlitzer/');
  await bank.loadCorePack(context);
  return { bank, context, buffers };
}

describe('Wurlitzer source metadata', () => {
  it('extracts every original forward loop in source seconds with an exclusive endpoint', () => {
    for (const entry of manifest.files) {
      const bytes = readFileSync(`${base}${entry.file}`);
      const metadata = readFlacMetadata(bytes);
      expect(metadata).toMatchObject({
        sampleRate: 44100,
        channels: 1,
        bits: 16,
        loop: entry.loop,
      });
      expect(metadata.loop.end).toBeLessThanOrEqual(metadata.totalSamples / metadata.sampleRate);
    }
    const db4 = readFlacMetadata(readFileSync(`${base}db4mp.sample`));
    expect(db4.loop.start).toBe(89564 / 44100);
    expect(db4.loop.end).toBe(91312 / 44100);
  });

  it('rejects corrupt loop metadata instead of shipping an invalid loop', () => {
    const bytes = readFileSync(`${base}db4mp.sample`);
    const smpl = bytes.indexOf(Buffer.from('riffsmpl')) + 12;
    bytes.writeUInt32LE(0xffffffff, smpl + 48);
    expect(() => readFlacMetadata(bytes)).toThrow(/invalid/i);
    expect(() => readFlacMetadata(Buffer.from('fLaC'))).toThrow(/truncated/i);
    expect(() => parseWurlitzerRegions('<group> lovel=1 hivel=127')).toThrow(/unexpected/i);
  });
});

describe('Wurlitzer sample selection', () => {
  it('uses all four exact MIDI velocity bands, tuning, and v² gain', async () => {
    const { bank } = await makeBank();
    for (const velocity of [1, 37, 38, 65, 66, 89, 90, 127]) {
      const region = manifest.regions!.find(
        (r) =>
          r.lowKey <= 61 &&
          r.highKey >= 61 &&
          r.lowVelocity <= velocity &&
          r.highVelocity >= velocity,
      )!;
      const sample = bank.getSample(61, velocity / 127)!;
      expect(sample.buffer).toHaveProperty('file', `/wurlitzer/${region.file}`);
      expect(sample.playbackRate).toBeCloseTo(2 ** (region.tune / 1200), 12);
      expect(sample.gain).toBeCloseTo(
        (velocity / 127) ** 2 * region.gain * manifest.levelMatch!,
        12,
      );
      expect(sample.loop).toEqual(manifest.files.find((f) => f.file === region.file)?.loop);
      expect(sample.envelope).toEqual(manifest.envelope);
    }
  });

  it('loads outer regions by mapping, including notes more than nine semitones from a root', async () => {
    const { bank, context } = await makeBank();
    expect(bank.isMidiPlayable(21)).toBe(false);
    await bank.ensureRangeLoaded(context, 21, 21);
    await bank.ensureRangeLoaded(context, 108, 108);
    for (const key of [21, 108]) {
      expect(bank.isMidiPlayable(key)).toBe(true);
      for (const velocity of [0.1, 0.4, 0.65, 1])
        expect(bank.getSample(key, velocity)).not.toBeNull();
    }
    expect(bank.getSample(20, 1)).toBeNull();
    expect(bank.getSample(109, 1)).toBeNull();
  });

  it('deduplicates shared files and keeps all 88 keys playable after a full load', async () => {
    const { bank, context, buffers } = await makeBank();
    await bank.ensureRangeLoaded(context, 21, 108);
    expect(buffers).toHaveLength(manifest.files.length);
    for (let key = 21; key <= 108; key++) {
      for (const velocity of [0.1, 0.4, 0.65, 1])
        expect(bank.getSample(key, velocity)).not.toBeNull();
    }
    expect(bank.getSample(79, 0.1)?.buffer).toBe(bank.getSample(79, 0.4)?.buffer);
    bank.releaseBuffers();
    expect(bank.isMidiPlayable(61)).toBe(false);
    expect(bank.getSample(61, 1)).toBeNull();
  });

  it('falls back to a loaded velocity for the same key region during partial loading', async () => {
    const { bank, context } = await makeBank();
    bank.releaseBuffers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!url.endsWith('db4pp.sample')) throw new Error('Unavailable');
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      }),
    );
    vi.useFakeTimers();
    const load = bank.ensureRangeLoaded(context, 61, 61);
    const failed = expect(load).rejects.toThrow();
    await vi.runAllTimersAsync();
    await failed;
    expect(bank.getSample(61, 1)).not.toBeNull();
    expect(bank.getSample(108, 1)).toBeNull();
    vi.useRealTimers();
  });
});
