// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  finishExport,
  finishExportOnMainThread,
  masteringShare,
  type ExportPcm,
} from '@/audio/exportEncode';
import type { ExportEncoding } from '@/audio/exportFormats';
import { readFlacStreamInfo } from '@/audio/flacEncode';

/** A short synthetic stereo render: two sines, the shape the renderer produces. */
function pcm(seconds: number): ExportPcm {
  const sampleRate = 48_000;
  const length = Math.floor(seconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    left[i] = 0.3 * Math.sin(2 * Math.PI * 440 * t);
    right[i] = 0.3 * Math.sin(2 * Math.PI * 660 * t);
  }
  return { sampleRate, left, right, clicks: null, loudness: 'normalized' };
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const encodings: readonly ExportEncoding[] = [
  { format: 'mp3', kbps: 128 },
  { format: 'flac', bits: 16 },
  { format: 'flac', bits: 24 },
];

describe('compressing a render', () => {
  for (const encoding of encodings) {
    const name = encoding.format === 'mp3' ? 'MP3' : `${encoding.bits}-bit FLAC`;

    it(`fills the bar in whole percents, mastering its first share, to exactly 1 (${name})`, async () => {
      const fractions: number[] = [];
      await finishExport(pcm(3), encoding, (fraction) => fractions.push(fraction));
      const percents = fractions.map((fraction) => Math.round(fraction * 100));
      expect(fractions.every((fraction, i) => fraction === percents[i]! / 100)).toBe(true);
      expect(percents.every((percent, i) => i === 0 || percent > percents[i - 1]!)).toBe(true);
      // Mastering on its own, a percent at a time, before the encoder says a word.
      const masteringPercents = Math.round(masteringShare(encoding) * 100);
      expect(percents.filter((percent) => percent <= masteringPercents)).toEqual(
        Array.from({ length: masteringPercents }, (_, i) => i + 1),
      );
      expect(fractions.at(-1)).toBe(1);
    });

    it(`says the same, and writes the same file, on the main thread as in the worker (${name})`, async () => {
      const inWorker: number[] = [];
      const workerFile = await finishExport(pcm(3), encoding, (fraction) =>
        inWorker.push(fraction),
      );
      const onMainThread: number[] = [];
      const mainFile = await finishExportOnMainThread(
        pcm(3),
        encoding,
        (fraction) => onMainThread.push(fraction),
        new AbortController().signal,
      );
      expect(onMainThread).toEqual(inWorker);
      expect(join(mainFile)).toEqual(join(workerFile));
      // Parts the worker can transfer as they are.
      for (const part of workerFile) expect(part.buffer.byteLength).toBe(part.length);
    });
  }

  it('writes FLAC at the depth asked for, every sample of the render', async () => {
    const render = pcm(2);
    const parts = await finishExport(render, { format: 'flac', bits: 24 });
    expect(readFlacStreamInfo(parts[0]!)).toMatchObject({
      sampleRate: 48_000,
      channels: 2,
      bits: 24,
      totalSamples: render.left.length,
    });
  });

  it('stops encoding FLAC on the main thread once cancelled', async () => {
    const controller = new AbortController();
    const cancelled = finishExportOnMainThread(
      pcm(20),
      { format: 'flac', bits: 16 },
      (fraction) => {
        if (fraction > masteringShare({ format: 'flac', bits: 16 })) {
          controller.abort(new Error('cancelled'));
        }
      },
      controller.signal,
    );
    await expect(cancelled).rejects.toThrow('cancelled');
  });
});
