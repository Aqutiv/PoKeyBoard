// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { encodePcmToMp3 } from '@/audio/mp3Encode';

/** A short synthetic stereo sine, the same shape the renderer produces. */
function makeStereoSine(seconds: number, sampleRate = 48_000) {
  const length = Math.floor(seconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    left[i] = 0.3 * Math.sin(2 * Math.PI * 440 * t);
    right[i] = 0.3 * Math.sin(2 * Math.PI * 660 * t);
  }
  return { left, right, sampleRate };
}

function isMp3(bytes: Uint8Array): boolean {
  // MPEG audio frame sync (0xFFEx) or an ID3 tag header.
  const frameSync = bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  return frameSync || id3;
}

describe('encodePcmToMp3', () => {
  it('encodes stereo PCM into a valid, plausibly sized MP3', async () => {
    const { left, right, sampleRate } = makeStereoSine(0.4);
    const mp3 = await encodePcmToMp3(sampleRate, 128, left, right);
    expect(mp3.length).toBeGreaterThan(2_000);
    expect(isMp3(mp3)).toBe(true);
  });

  it('reports monotonic progress up to 1', async () => {
    const { left, right, sampleRate } = makeStereoSine(0.6);
    const fractions: number[] = [];
    await encodePcmToMp3(sampleRate, 192, left, right, (f) => fractions.push(f));
    expect(fractions.length).toBeGreaterThan(0);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]!).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
    expect(fractions[fractions.length - 1]!).toBeCloseTo(1, 5);
  });

  it('produces a larger file at the higher bitrate', async () => {
    const { left, right, sampleRate } = makeStereoSine(0.8);
    const low = await encodePcmToMp3(sampleRate, 128, left, right);
    const high = await encodePcmToMp3(sampleRate, 192, left, right);
    expect(high.length).toBeGreaterThan(low.length);
  });
});
