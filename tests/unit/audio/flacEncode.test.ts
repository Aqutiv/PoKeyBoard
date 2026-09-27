// @vitest-environment node
import { createHash } from 'node:crypto';
import { FLACDecoder } from '@wasm-audio-decoders/flac';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlacBitDepth } from '@/audio/exportFormats';
import {
  encodeFlacSteps,
  FLAC_BLOCK_SIZE,
  FLAC_HEADER_BYTES,
  FlacEncoder,
  flacFrameCount,
  readFlacStreamInfo,
} from '@/audio/flacEncode';
import { xorshift32 } from '@/utils/random';
import { runToEnd } from '@/utils/steps';

/**
 * Every stream is decoded by libFLAC itself (compiled to WebAssembly), the
 * reference decoder, which checks each frame's CRCs; the samples must come
 * back exactly as they went in.
 *
 * The frames are handed to it one by one, split here at the CRCs that end
 * them. Handed the whole file, the package first splits it with its own
 * parser (codec-parser), which loses a stream's last frame whenever its
 * search for another frame runs one byte past the end — as it does when a
 * 0xFF byte falls just before the end of the file. ffmpeg decodes those
 * same streams exactly.
 */
let decoder: FLACDecoder;
beforeAll(async () => {
  decoder = new FLACDecoder();
  await decoder.ready;
});
afterAll(() => decoder.free());

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function encode(left: Int32Array, right: Int32Array, bits: FlacBitDepth, rate = 48_000) {
  const encoder = new FlacEncoder(rate, bits);
  for (let from = 0; from < left.length; from += FLAC_BLOCK_SIZE) {
    const count = Math.min(FLAC_BLOCK_SIZE, left.length - from);
    encoder.writeFrame(
      left.subarray(from, from + count),
      right.subarray(from, from + count),
      count,
    );
  }
  return join(encoder.finish());
}

const CRC16 = Uint16Array.from({ length: 256 }, (_, byte) => {
  let crc = byte << 8;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? (crc << 1) ^ 0x8005 : crc << 1;
  return crc;
});

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ byte]!;
  return crc;
}

/** The stream's frames: each runs to the next frame sync that its CRC-16 ends right before. */
function frames(stream: Uint8Array): Uint8Array[] {
  const found: Uint8Array[] = [];
  let start = FLAC_HEADER_BYTES;
  while (start < stream.length) {
    let end = stream.length;
    for (let next = start + 2; next < stream.length - 1; next += 1) {
      if (stream[next] !== 0xff || (stream[next + 1]! & 0xfe) !== 0xf8) continue;
      const frame = stream.subarray(start, next);
      if (crc16(frame.subarray(0, -2)) === ((frame.at(-2)! << 8) | frame.at(-1)!)) {
        end = next;
        break;
      }
    }
    found.push(stream.slice(start, end));
    start = end;
  }
  return found;
}

async function decode(stream: Uint8Array) {
  await decoder.reset();
  return decoder.decodeFrames(frames(stream));
}

/** The whole file through the package's own parser; see the note at the top. */
async function decodeFile(stream: Uint8Array) {
  await decoder.reset();
  // The decoder may keep the buffer it is given; hand it a copy.
  return decoder.decodeFile(stream.slice());
}

/**
 * Samples as this decoder gives them back: each divided by 2^(bits − 1) − 1,
 * as a 32-bit float. No two samples of a depth share a float that way, so
 * matching floats is matching samples, even at 24 bits, where rounding a
 * float back up to a sample could be a step out near full scale.
 */
function asDecoded(samples: Int32Array, bits: number): Float32Array {
  const scale = 2 ** (bits - 1) - 1;
  return Float32Array.from(samples, (sample) => sample / scale);
}

/** A decoded channel back as samples, exact wherever |sample| < 2^22. */
function integers(channel: Float32Array | undefined, bits: number): Int32Array {
  const scale = 2 ** (bits - 1) - 1;
  return Int32Array.from(channel ?? [], (value) => Math.round(value * scale));
}

function same(decoded: Float32Array | undefined, expected: Float32Array): boolean {
  return decoded?.length === expected.length && decoded.every((v, i) => v === expected[i]);
}

/** FLAC's MD5: both channels interleaved, little-endian, 2 or 3 bytes a sample. */
function md5Of(left: Int32Array, right: Int32Array, bits: FlacBitDepth): string {
  const bytes = bits / 8;
  const buffer = Buffer.alloc(left.length * 2 * bytes);
  for (let i = 0; i < left.length; i += 1) {
    buffer.writeIntLE(left[i]!, i * 2 * bytes, bytes);
    buffer.writeIntLE(right[i]!, (i * 2 + 1) * bytes, bytes);
  }
  return createHash('md5').update(buffer).digest('hex');
}

async function expectLossless(
  left: Int32Array,
  right: Int32Array,
  bits: FlacBitDepth,
  rate = 48_000,
): Promise<Uint8Array> {
  const bytes = encode(left, right, bits, rate);
  const decoded = await decode(bytes);
  expect(decoded.errors).toEqual([]);
  expect(decoded.samplesDecoded).toBe(left.length);
  expect(decoded.sampleRate).toBe(rate);
  expect(decoded.bitDepth).toBe(bits);
  expect(decoded.channelData).toHaveLength(2);
  // Compared element by element only when it fails, to keep the report short.
  for (const [channel, samples] of [left, right].entries()) {
    const expected = asDecoded(samples, bits);
    if (!same(decoded.channelData[channel], expected)) {
      expect(integers(decoded.channelData[channel], bits)).toEqual(samples);
      expect(decoded.channelData[channel]).toEqual(expected);
    }
  }

  const info = readFlacStreamInfo(bytes)!;
  expect(info).toMatchObject({
    onlyBlock: true,
    minBlockSize: FLAC_BLOCK_SIZE,
    maxBlockSize: FLAC_BLOCK_SIZE,
    sampleRate: rate,
    channels: 2,
    bits,
    totalSamples: left.length,
  });
  expect(Buffer.from(info.md5).toString('hex')).toBe(md5Of(left, right, bits));
  expect(info.minFrameBytes).toBeGreaterThan(0);
  expect(info.minFrameBytes).toBeLessThanOrEqual(info.maxFrameBytes);
  expect(info.maxFrameBytes).toBeLessThanOrEqual(bytes.length - FLAC_HEADER_BYTES);
  if (left.length <= FLAC_BLOCK_SIZE) {
    // One frame: it is both the smallest and the largest.
    expect(info.minFrameBytes).toBe(bytes.length - FLAC_HEADER_BYTES);
    expect(info.maxFrameBytes).toBe(bytes.length - FLAC_HEADER_BYTES);
  }
  return bytes;
}

/** A struck chord: a few decaying partials, the right channel a little apart. */
function chord(length: number, bits: FlacBitDepth, level = 0.4) {
  const scale = 2 ** (bits - 1);
  const left = new Int32Array(length);
  const right = new Int32Array(length);
  const random = xorshift32(7);
  for (let i = 0; i < length; i += 1) {
    const t = i / 48_000;
    const decay = Math.exp(-t * 1.5);
    let l = 0;
    let r = 0;
    for (const [hz, gain] of [
      [261.63, 0.5],
      [329.63, 0.3],
      [392, 0.25],
      [523.25, 0.1],
      [1046.5, 0.05],
    ] as const) {
      l += gain * Math.sin(2 * Math.PI * hz * t);
      r += gain * Math.sin(2 * Math.PI * hz * t + 0.3);
    }
    // A little noise, as a recording has.
    left[i] = Math.round(level * decay * l * scale * 0.8 + (random() - random()) * 3);
    right[i] = Math.round(level * decay * r * scale * 0.8 + (random() - random()) * 3);
  }
  return { left, right };
}

function noise(length: number, amplitude: number, seed: number): Int32Array {
  const random = xorshift32(seed);
  return Int32Array.from({ length }, () => Math.floor((random() * 2 - 1) * amplitude));
}

/** How each frame codes its first channel, read from the subframe header after the frame's. */
function firstSubframeKinds(stream: Uint8Array): string[] {
  return frames(stream).map((frame) => {
    // Sync, then a byte each of block size and rate, and of channels and
    // depth; then the frame number, coded as UTF-8 codes a character, whose
    // first byte says how many follow.
    const lead = frame[4]!;
    const numberBytes =
      lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : lead < 0xfc ? 5 : 6;
    const sizeCode = frame[2]! >> 4;
    const rateCode = frame[2]! & 0xf;
    const extra =
      (sizeCode === 0b0110 ? 1 : sizeCode === 0b0111 ? 2 : 0) +
      (rateCode === 0b1100 ? 1 : rateCode === 0b1101 || rateCode === 0b1110 ? 2 : 0);
    // Past any block size and rate after the number, and the header's CRC-8.
    const type = (frame[4 + numberBytes + extra + 1]! >> 1) & 0x3f;
    return type === 0 ? 'constant' : type === 1 ? 'verbatim' : type < 0x20 ? 'fixed' : 'lpc';
  });
}

describe('the FLAC encoder', () => {
  for (const bits of [16, 24] as const) {
    it(`gives a chord back exactly at ${bits} bits, a fraction of its size stored plainly`, async () => {
      const { left, right } = chord(48_000, bits);
      const bytes = await expectLossless(left, right, bits);
      expect(bytes.length).toBeLessThan(left.length * 2 * (bits / 8) * 0.7);
      // Read whole, header and all, it is the same stream.
      const whole = await decodeFile(bytes);
      expect(whole.errors).toEqual([]);
      expect(whole.samplesDecoded).toBe(left.length);
      expect(same(whole.channelData[1], asDecoded(right, bits))).toBe(true);
    });

    it(`predicts a chord at ${bits} bits with a linear predictor fitted to each frame`, async () => {
      const { left, right } = chord(8 * FLAC_BLOCK_SIZE + 700, bits);
      const bytes = await expectLossless(left, right, bits);
      const kinds = firstSubframeKinds(bytes);
      expect(kinds).toHaveLength(9);
      // Every frame of a steady tone, the short last one included.
      expect(kinds.filter((kind) => kind === 'lpc')).toHaveLength(9);
    });
  }

  for (const length of [
    1,
    2,
    4,
    5,
    15,
    16,
    255,
    256,
    257,
    4095,
    4096,
    4097,
    3 * 4096,
    3 * 4096 + 1,
  ])
    it(`keeps every sample of a ${length}-sample stream`, async () => {
      const { left, right } = chord(length, 16);
      await expectLossless(left, right, 16);
    });

  it('codes silence, and a channel the same as the other, as next to nothing', async () => {
    const silence = new Int32Array(4 * FLAC_BLOCK_SIZE);
    const quiet = await expectLossless(silence, silence, 16);
    expect(quiet.length).toBeLessThan(FLAC_HEADER_BYTES + 4 * 40);

    const { left } = chord(4 * FLAC_BLOCK_SIZE, 16);
    // A copy of the left channel costs what silence would: the side is all
    // zeros, a constant a frame, not a second channel.
    const mono = await expectLossless(left, left.slice(), 16);
    const alone = await expectLossless(left, silence, 16);
    expect(mono.length).toBeLessThanOrEqual(alone.length + 4);
  });

  it('keeps channels that are each other’s opposite, and full-scale extremes', async () => {
    const { left } = chord(2 * FLAC_BLOCK_SIZE, 16);
    await expectLossless(
      left,
      left.map((v) => -v),
      16,
    );

    for (const bits of [16, 24] as const) {
      const max = 2 ** (bits - 1) - 1;
      const min = -(2 ** (bits - 1));
      const length = FLAC_BLOCK_SIZE + 100;
      const edge = Int32Array.from({ length }, (_, i) => (i % 2 ? max : min));
      const flipped = edge.map((v) => (v === max ? min : max));
      await expectLossless(edge, flipped, bits);
      await expectLossless(edge, edge.slice(), bits);
      const ramp = Int32Array.from({ length }, (_, i) => (i % 7 < 3 ? max : min + (i % 5)));
      await expectLossless(ramp, edge, bits);
    }
  });

  it('stores noise nothing can predict as it is', async () => {
    const length = 2 * FLAC_BLOCK_SIZE;
    const bytes = await expectLossless(noise(length, 32_768, 1), noise(length, 32_768, 2), 16);
    // Stored plainly, plus only the frames' own headers and CRCs.
    expect(bytes.length).toBeLessThan(FLAC_HEADER_BYTES + length * 4 + 2 * 40);
  });

  it('switches to 5-bit Rice parameters for loud 24-bit noise', async () => {
    const length = 2 * FLAC_BLOCK_SIZE;
    // About 20 bits a sample: coded, not stored, and past what 4 bits can say.
    const bytes = await expectLossless(noise(length, 2 ** 19, 3), noise(length, 2 ** 19, 4), 24);
    expect(bytes.length).toBeLessThan(length * 2 * 3 * 0.95);
  });

  it('states other sample rates in each frame, by name or in full', async () => {
    const { left, right } = chord(FLAC_BLOCK_SIZE + 10, 16);
    for (const rate of [44_100, 22_050, 32_000, 22_000, 11_025, 100_000, 250_010]) {
      await expectLossless(left, right, 16, rate);
    }
    expect(() => new FlacEncoder(700_001, 16)).toThrow(RangeError);
  });

  it('is caught out by its own CRCs when a byte is damaged', async () => {
    const { left, right } = chord(3 * FLAC_BLOCK_SIZE, 16);
    const bytes = encode(left, right, 16);
    const damaged = bytes.slice();
    const at = Math.floor(bytes.length * 0.6);
    damaged[at] = damaged[at]! ^ 0x10;
    const decoded = await decodeFile(damaged);
    const intact =
      same(decoded.channelData[0], asDecoded(left, 16)) &&
      same(decoded.channelData[1], asDecoded(right, 16));
    expect(decoded.errors.length > 0 || !intact).toBe(true);
  });
});

describe('a render as FLAC', () => {
  /** A fading tone, and `hiss` of noise under it, at most half of full scale. */
  function render(seconds: number, hiss = 0) {
    const length = Math.round(seconds * 48_000);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const random = xorshift32(11);
    for (let i = 0; i < length; i += 1) {
      left[i] = 0.4 * Math.sin(i / 20) * Math.exp(-i / 60_000) + hiss * (random() - 0.5);
      right[i] = 0.35 * Math.sin(i / 21) * Math.exp(-i / 60_000) + hiss * (random() - 0.5);
    }
    return { left, right };
  }

  it('takes a step a frame and comes out the same every time', () => {
    const { left, right } = render(1.3);
    let steps = 0;
    const counting = encodeFlacSteps(left, right, 48_000, 16);
    let next = counting.next();
    while (!next.done) {
      steps += 1;
      next = counting.next();
    }
    expect(steps).toBe(flacFrameCount(left.length));
    const again = runToEnd(encodeFlacSteps(left, right, 48_000, 16));
    expect(join(again)).toEqual(join(next.value));
  });

  it('hands over parts that each own their buffer, the header first', () => {
    // Enough hiss at 24 bits that the stream runs to a few megabytes.
    const { left, right } = render(12, 0.2);
    const parts = runToEnd(encodeFlacSteps(left, right, 48_000, 24));
    expect(parts[0]).toHaveLength(FLAC_HEADER_BYTES);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      expect(part.byteOffset).toBe(0);
      expect(part.buffer.byteLength).toBe(part.length);
    }
  });

  for (const bits of [16, 24] as const)
    it(`quantizes to ${bits} bits within a step and a half, dither and rounding together`, async () => {
      const { left, right } = render(0.5);
      const bytes = join(runToEnd(encodeFlacSteps(left, right, 48_000, bits)));
      const decoded = await decode(bytes);
      expect(decoded.errors).toEqual([]);
      const scale = 2 ** (bits - 1);
      // Exact: the tone stays under 2^22 even at 24 bits.
      const back = integers(decoded.channelData[0], bits);
      let worst = 0;
      for (let i = 0; i < left.length; i += 1) {
        worst = Math.max(worst, Math.abs(back[i]! - left[i]! * scale));
      }
      expect(worst).toBeLessThanOrEqual(1.5);
      expect(worst).toBeGreaterThan(0.5); // dithered, not merely rounded
    });
});
