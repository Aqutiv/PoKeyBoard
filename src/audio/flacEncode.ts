import type { FlacBitDepth } from './exportFormats';
import { Md5 } from './md5';
import { createQuantizer } from './pcmQuantize';
import type { Steps } from '@/utils/steps';

/**
 * A FLAC encoder for the audio export: lossless, and small enough to write
 * here rather than ship a codec for. It uses a plain subset of the format
 * (RFC 9639), one every decoder reads:
 *
 * - Frames of 4096 samples, the last one shorter, each with the sample rate
 *   and bit depth in its header, so a player can start at any frame.
 * - Stereo coded as left and right, or as either of them with their
 *   difference (side), or as their average (mid) with side: whichever is
 *   smallest for the frame. A piano's two channels are much alike, so the
 *   difference is usually far smaller than either.
 * - Each channel as the prediction error of the best of FLAC's five fixed
 *   predictors (none, or the last sample carried on straight or along a
 *   curve of order two to four), Rice-coded in up to 256 partitions, each
 *   with its own parameter. A channel that never changes is one number; one
 *   that prediction cannot shrink is stored as it is.
 * - The MD5 of the samples in the stream's header, so `flac -t` and players
 *   that check can tell the file is intact.
 *
 * What it leaves out is what makes libFLAC's and ffmpeg's files about a
 * tenth smaller on the library's pieces: linear prediction fitted to each
 * frame. With only fixed predictors, ffmpeg's come out the same size as
 * these; see AUDIO_EXPORT.md.
 */

/** Samples in a frame: libFLAC's own choice at 44.1 and 48 kHz. */
export const FLAC_BLOCK_SIZE = 4096;

/** `fLaC`, the STREAMINFO block's header, and its 34 bytes. */
export const FLAC_HEADER_BYTES = 42;

/** The most partitions tried, as a power of two: 16 samples each in a full frame. */
const MAX_PARTITION_ORDER = 8;

/** The parameter a 4-bit Rice partition can carry; 15 is the escape code. */
const MAX_RICE4 = 14;

/** Output is handed over in parts about this big, each holding whole frames. */
const PART_BYTES = 1 << 20;

/** Channel assignments: which two subframes a frame holds, first first. */
const LEFT_RIGHT = 0b0001;
const LEFT_SIDE = 0b1000;
const SIDE_RIGHT = 0b1001;
const MID_SIDE = 0b1010;

/** Frame header codes for the sample rates FLAC names outright. */
const RATE_CODES: ReadonlyMap<number, number> = new Map([
  [88_200, 0b0001],
  [176_400, 0b0010],
  [192_000, 0b0011],
  [8_000, 0b0100],
  [16_000, 0b0101],
  [22_050, 0b0110],
  [24_000, 0b0111],
  [32_000, 0b1000],
  [44_100, 0b1001],
  [48_000, 0b1010],
  [96_000, 0b1011],
]);

const DEPTH_CODES: Readonly<Record<FlacBitDepth, number>> = { 16: 0b100, 24: 0b110 };

/** How a frame header states the sample rate: a code, and any number after the header. */
interface FrameRate {
  code: number;
  extra: number;
  extraBits: number;
}

/**
 * Every frame states its rate, rather than leaving it to STREAMINFO, so a
 * player can start from any frame: by name where FLAC has one, else in kHz,
 * Hz or tens of Hz after the header.
 */
function frameRate(sampleRate: number): FrameRate {
  const named = RATE_CODES.get(sampleRate);
  if (named !== undefined) return { code: named, extra: 0, extraBits: 0 };
  if (sampleRate % 1000 === 0 && sampleRate / 1000 <= 0xff) {
    return { code: 0b1100, extra: sampleRate / 1000, extraBits: 8 };
  }
  if (sampleRate <= 0xffff) return { code: 0b1101, extra: sampleRate, extraBits: 16 };
  if (sampleRate % 10 === 0 && sampleRate / 10 <= 0xffff) {
    return { code: 0b1110, extra: sampleRate / 10, extraBits: 16 };
  }
  throw new RangeError(`FLAC frames cannot state a sample rate of ${sampleRate} Hz`);
}

/** CRC-8, polynomial x⁸ + x² + x + 1, what a frame header ends with. */
const CRC8 = new Uint8Array(256);
/** CRC-16, polynomial x¹⁶ + x¹⁵ + x² + 1, what a whole frame ends with. */
const CRC16 = new Uint16Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  let crc8 = byte;
  let crc16 = byte << 8;
  for (let bit = 0; bit < 8; bit += 1) {
    crc8 = crc8 & 0x80 ? (crc8 << 1) ^ 0x07 : crc8 << 1;
    crc16 = crc16 & 0x8000 ? (crc16 << 1) ^ 0x8005 : crc16 << 1;
  }
  CRC8[byte] = crc8;
  CRC16[byte] = crc16;
}

/**
 * Bits written most significant first into a buffer big enough for a frame.
 * JavaScript's bit operators work on 32 bits, so a write carries at most 24,
 * on top of the up to 7 still waiting to fill a byte.
 */
class BitWriter {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** Whole bytes written. */
  length = 0;
  private waiting = 0;
  private waitingBits = 0;

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity);
  }

  reset(): void {
    this.length = 0;
    this.waiting = 0;
    this.waitingBits = 0;
  }

  /** The low `count` bits of `value`, `count` at most 24. */
  write(value: number, count: number): void {
    this.waiting = (this.waiting << count) | (value & ((1 << count) - 1));
    this.waitingBits += count;
    while (this.waitingBits >= 8) {
      this.waitingBits -= 8;
      // A Uint8Array keeps the low 8 bits of what it is given.
      this.bytes[this.length++] = this.waiting >>> this.waitingBits;
    }
    this.waiting &= (1 << this.waitingBits) - 1;
  }

  /** The low `count` bits of `value`, as many as 32: a sample, say. */
  writeWide(value: number, count: number): void {
    if (count > 24) {
      this.write(value >> 16, count - 16);
      this.write(value, 16);
    } else {
      this.write(value, count);
    }
  }

  /** A Rice code: `folded >> k` zeros, a one, then the low `k` bits. */
  rice(folded: number, k: number): void {
    const zeros = folded >>> k;
    if (zeros + 1 + k <= 24) {
      this.write((1 << k) | (folded & ((1 << k) - 1)), zeros + 1 + k);
      return;
    }
    let left = zeros;
    for (; left >= 24; left -= 24) this.write(0, 24);
    this.write(1, left + 1);
    this.writeWide(folded, k);
  }

  /** Fill the byte under way with zeros. */
  align(): void {
    if (this.waitingBits > 0) this.write(0, 8 - this.waitingBits);
  }
}

/** A residual as the unsigned number Rice coding takes: 0, −1, 1, −2 … as 0, 1, 2, 3 … */
function fold(residual: number): number {
  return (residual << 1) ^ (residual >> 31);
}

/**
 * The Rice parameter for a partition of `count` folded residuals adding to
 * `sum`, and the bits it would take: the parameter near log₂ of the mean
 * times ln 2, where a geometric spread of values codes shortest, and the
 * better of it and the next one up by the usual estimate.
 */
function riceParameter(sum: number, count: number): { k: number; bits: number } {
  const target = (sum / count) * Math.LN2;
  const low = target > 1 ? Math.min(30, Math.floor(Math.log2(target))) : 0;
  const bitsAt = (k: number) => count * (k + 1) + sum / 2 ** k;
  const high = Math.min(30, low + 1);
  return bitsAt(high) < bitsAt(low)
    ? { k: high, bits: bitsAt(high) }
    : { k: low, bits: bitsAt(low) };
}

/** How a subframe will be coded, as `planSubframe` chose it. */
interface SubframePlan {
  /** −1 for a constant channel; otherwise the fixed predictor's order. */
  order: number;
  /** The estimated size, to compare stereo arrangements by. */
  bits: number;
}

/**
 * Pick the fixed predictor whose errors add up smallest, and estimate the
 * subframe's size from them. The errors are summed over the same samples for
 * every order, so they compare fairly.
 */
function planSubframe(x: Int32Array, n: number, depth: number): SubframePlan {
  const first = x[0] as number;
  let constant = true;
  for (let i = 1; i < n; i += 1) {
    if (x[i] !== first) {
      constant = false;
      break;
    }
  }
  if (constant) return { order: -1, bits: 8 + depth };

  const verbatim = 8 + n * depth;
  if (n <= 4) {
    // Too short for the higher orders; what order 0 would take, or as it is.
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += 2 * Math.abs(x[i] as number);
    return { order: 0, bits: Math.min(verbatim, 18 + riceParameter(sum, n).bits) };
  }

  // Each order's error is the difference of the order below's, from sample 4 on.
  let e0 = x[3] as number;
  let e1 = e0 - (x[2] as number);
  let e2 = e1 - ((x[2] as number) - (x[1] as number));
  let e3 = e2 - ((x[2] as number) - (x[1] as number) - ((x[1] as number) - (x[0] as number)));
  let sum0 = 0;
  let sum1 = 0;
  let sum2 = 0;
  let sum3 = 0;
  let sum4 = 0;
  for (let i = 4; i < n; i += 1) {
    const s0 = x[i] as number;
    const s1 = s0 - e0;
    const s2 = s1 - e1;
    const s3 = s2 - e2;
    const s4 = s3 - e3;
    sum0 += Math.abs(s0);
    sum1 += Math.abs(s1);
    sum2 += Math.abs(s2);
    sum3 += Math.abs(s3);
    sum4 += Math.abs(s4);
    e0 = s0;
    e1 = s1;
    e2 = s2;
    e3 = s3;
  }
  const sums = [sum0, sum1, sum2, sum3, sum4];
  let order = 0;
  for (let o = 1; o <= 4; o += 1) if ((sums[o] as number) < (sums[order] as number)) order = o;
  const estimate =
    8 + order * depth + 6 + 4 + riceParameter(2 * (sums[order] as number), n - 4).bits;
  return { order, bits: Math.min(verbatim, estimate) };
}

/**
 * Writes a FLAC stream frame by frame. Give it every block of samples in
 * order through `writeFrame`, then take the stream from `finish`.
 */
export class FlacEncoder {
  private readonly sampleRate: number;
  private readonly depth: FlacBitDepth;
  private readonly depthCode: number;
  private readonly rate: FrameRate;
  private readonly frame: BitWriter;
  private readonly parts: Uint8Array<ArrayBuffer>[] = [];
  private part = new Uint8Array(PART_BYTES);
  private partLength = 0;
  private readonly md5 = new Md5();
  private readonly md5Bytes: Uint8Array;
  private readonly mid = new Int32Array(FLAC_BLOCK_SIZE);
  private readonly side = new Int32Array(FLAC_BLOCK_SIZE);
  private readonly folded = new Int32Array(FLAC_BLOCK_SIZE);
  private readonly partitionSums = new Float64Array(1 << MAX_PARTITION_ORDER);
  private frames = 0;
  private samples = 0;
  private minFrameBytes = Number.POSITIVE_INFINITY;
  private maxFrameBytes = 0;

  constructor(sampleRate: number, depth: FlacBitDepth) {
    this.sampleRate = sampleRate;
    this.depth = depth;
    this.depthCode = DEPTH_CODES[depth];
    this.rate = frameRate(sampleRate);
    // The header, the two subframes at their largest (stored as they are,
    // side one bit wider) and the frame's CRC.
    this.frame = new BitWriter(16 + 2 * (2 + Math.ceil((FLAC_BLOCK_SIZE * 25) / 8)) + 2);
    this.md5Bytes = new Uint8Array(FLAC_BLOCK_SIZE * 2 * (depth / 8));
  }

  /**
   * One frame of `count` (1 to 4096) samples a channel, every sample inside
   * the stream's bit depth. Only the last frame may be shorter than 4096.
   */
  writeFrame(left: Int32Array, right: Int32Array, count: number): void {
    this.hash(left, right, count);
    const { mid, side } = this;
    for (let i = 0; i < count; i += 1) {
      const l = left[i] as number;
      const r = right[i] as number;
      side[i] = l - r;
      mid[i] = (l + r) >> 1;
    }
    const depth = this.depth;
    const plans = {
      left: planSubframe(left, count, depth),
      right: planSubframe(right, count, depth),
      mid: planSubframe(mid, count, depth),
      side: planSubframe(side, count, depth + 1),
    };
    let assignment = LEFT_RIGHT;
    let best = plans.left.bits + plans.right.bits;
    for (const [candidate, bits] of [
      [LEFT_SIDE, plans.left.bits + plans.side.bits],
      [SIDE_RIGHT, plans.side.bits + plans.right.bits],
      [MID_SIDE, plans.mid.bits + plans.side.bits],
    ]) {
      if ((bits as number) < best) {
        assignment = candidate as number;
        best = bits as number;
      }
    }

    const w = this.frame;
    w.reset();
    this.frameHeader(count, assignment);
    if (assignment === LEFT_RIGHT) {
      this.subframe(left, count, depth, plans.left);
      this.subframe(right, count, depth, plans.right);
    } else if (assignment === LEFT_SIDE) {
      this.subframe(left, count, depth, plans.left);
      this.subframe(side, count, depth + 1, plans.side);
    } else if (assignment === SIDE_RIGHT) {
      this.subframe(side, count, depth + 1, plans.side);
      this.subframe(right, count, depth, plans.right);
    } else {
      this.subframe(mid, count, depth, plans.mid);
      this.subframe(side, count, depth + 1, plans.side);
    }
    w.align();
    let crc = 0;
    for (let i = 0; i < w.length; i += 1) {
      crc = ((crc << 8) & 0xffff) ^ (CRC16[(crc >> 8) ^ (w.bytes[i] as number)] as number);
    }
    w.write(crc, 16);

    this.append(w.bytes.subarray(0, w.length));
    this.minFrameBytes = Math.min(this.minFrameBytes, w.length);
    this.maxFrameBytes = Math.max(this.maxFrameBytes, w.length);
    this.frames += 1;
    this.samples += count;
  }

  /**
   * The stream, as parts to hand over as they are: the 42 header bytes first
   * (`fLaC` and STREAMINFO, the only metadata block, so marked last), then
   * the frames, in parts of about a megabyte that each own their buffer.
   */
  finish(): Uint8Array<ArrayBuffer>[] {
    if (this.partLength > 0) this.parts.push(this.part.slice(0, this.partLength));
    const header = new Uint8Array(FLAC_HEADER_BYTES);
    const view = new DataView(header.buffer);
    header.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
    view.setUint16(8, FLAC_BLOCK_SIZE);
    view.setUint16(10, FLAC_BLOCK_SIZE);
    // The smallest and largest frame, 24 bits each; unknown (0) with no frames.
    const known = this.frames > 0;
    for (const [at, bytes] of [
      [12, known ? this.minFrameBytes : 0],
      [15, known ? this.maxFrameBytes : 0],
    ] as const) {
      header[at] = bytes >>> 16;
      header[at + 1] = bytes >>> 8;
      header[at + 2] = bytes;
    }
    // 20 bits of sample rate, 3 of channels − 1, 5 of bit depth − 1, 36 of samples.
    const rate = this.sampleRate;
    const depth = this.depth - 1;
    header[18] = rate >>> 12;
    header[19] = rate >>> 4;
    header[20] = ((rate & 0xf) << 4) | (1 << 1) | (depth >>> 4);
    header[21] = ((depth & 0xf) << 4) | (Math.floor(this.samples / 0x1_0000_0000) & 0xf);
    view.setUint32(22, this.samples >>> 0);
    header.set(this.md5.digest(), 26);
    return [header, ...this.parts];
  }

  /** The samples as FLAC's MD5 takes them: interleaved, little-endian, whole bytes. */
  private hash(left: Int32Array, right: Int32Array, count: number): void {
    const out = this.md5Bytes;
    let at = 0;
    if (this.depth === 16) {
      for (let i = 0; i < count; i += 1) {
        const l = left[i] as number;
        const r = right[i] as number;
        out[at] = l;
        out[at + 1] = l >> 8;
        out[at + 2] = r;
        out[at + 3] = r >> 8;
        at += 4;
      }
    } else {
      for (let i = 0; i < count; i += 1) {
        const l = left[i] as number;
        const r = right[i] as number;
        out[at] = l;
        out[at + 1] = l >> 8;
        out[at + 2] = l >> 16;
        out[at + 3] = r;
        out[at + 4] = r >> 8;
        out[at + 5] = r >> 16;
        at += 6;
      }
    }
    this.md5.update(out.subarray(0, at));
  }

  private frameHeader(count: number, assignment: number): void {
    const w = this.frame;
    // Sync code, then a fixed block size throughout the stream.
    w.write(0xfff8, 16);
    const sizeCode = count === FLAC_BLOCK_SIZE ? 0b1100 : count <= 256 ? 0b0110 : 0b0111;
    w.write((sizeCode << 4) | this.rate.code, 8);
    w.write((assignment << 4) | (this.depthCode << 1), 8);
    // The frame's number, coded the way UTF-8 codes a character.
    const number = this.frames;
    const more =
      number < 0x80
        ? 0
        : number < 0x800
          ? 1
          : number < 0x1_0000
            ? 2
            : number < 0x20_0000
              ? 3
              : number < 0x400_0000
                ? 4
                : 5;
    if (more === 0) {
      w.write(number, 8);
    } else {
      w.write(((0xff00 >> (more + 1)) & 0xff) | (number >>> (6 * more)), 8);
      for (let at = more - 1; at >= 0; at -= 1) w.write(0x80 | ((number >>> (6 * at)) & 0x3f), 8);
    }
    if (sizeCode === 0b0110) w.write(count - 1, 8);
    else if (sizeCode === 0b0111) w.write(count - 1, 16);
    if (this.rate.extraBits > 0) w.write(this.rate.extra, this.rate.extraBits);
    let crc = 0;
    for (let i = 0; i < w.length; i += 1) crc = CRC8[crc ^ (w.bytes[i] as number)] as number;
    w.write(crc, 8);
  }

  /** One channel's subframe, as planned, or stored as it is if that is smaller. */
  private subframe(x: Int32Array, n: number, depth: number, plan: SubframePlan): void {
    const w = this.frame;
    if (plan.order < 0) {
      w.write(0, 8); // CONSTANT
      w.writeWide(x[0] as number, depth);
      return;
    }
    const order = plan.order;
    const folded = this.folded;
    for (let i = order; i < n; i += 1) {
      const s = x[i] as number;
      let residual: number;
      switch (order) {
        case 0:
          residual = s;
          break;
        case 1:
          residual = s - (x[i - 1] as number);
          break;
        case 2:
          residual = s - 2 * (x[i - 1] as number) + (x[i - 2] as number);
          break;
        case 3:
          residual = s - 3 * (x[i - 1] as number) + 3 * (x[i - 2] as number) - (x[i - 3] as number);
          break;
        default:
          residual =
            s -
            4 * (x[i - 1] as number) +
            6 * (x[i - 2] as number) -
            4 * (x[i - 3] as number) +
            (x[i - 4] as number);
      }
      folded[i - order] = fold(residual);
    }
    const rice = this.partition(n, order);
    if (8 + order * depth + rice.bits >= 8 + n * depth) {
      w.write(0b10, 8); // VERBATIM
      for (let i = 0; i < n; i += 1) w.writeWide(x[i] as number, depth);
      return;
    }
    w.write((0b1000 | order) << 1, 8); // FIXED, of this order
    for (let i = 0; i < order; i += 1) w.writeWide(x[i] as number, depth);
    const wide = rice.parameters.some((k) => k > MAX_RICE4);
    const parameterBits = wide ? 5 : 4;
    w.write(wide ? 1 : 0, 2);
    w.write(rice.order, 4);
    const partitions = 1 << rice.order;
    const span = n >> rice.order;
    let at = 0;
    for (let p = 0; p < partitions; p += 1) {
      const k = rice.parameters[p] as number;
      w.write(k, parameterBits);
      const end = (p + 1) * span - order;
      for (; at < end; at += 1) w.rice(folded[at] as number, k);
    }
  }

  /**
   * How to split the residuals into Rice partitions: the order (a power of
   * two of them) and each one's parameter that come out smallest, with the
   * exact size in bits of the residual section they make. The first
   * partition starts after the predictor's warm-up samples, so it holds that
   * many fewer; every partition must hold at least one.
   */
  private partition(
    n: number,
    order: number,
  ): { order: number; parameters: number[]; bits: number } {
    let maxOrder = 0;
    while (
      maxOrder < MAX_PARTITION_ORDER &&
      n % (1 << (maxOrder + 1)) === 0 &&
      n >> (maxOrder + 1) > order
    ) {
      maxOrder += 1;
    }
    const folded = this.folded;
    const sums = this.partitionSums;
    const finest = 1 << maxOrder;
    const span = n >> maxOrder;
    let at = 0;
    for (let p = 0; p < finest; p += 1) {
      const end = (p + 1) * span - order;
      let sum = 0;
      for (; at < end; at += 1) sum += folded[at] as number;
      sums[p] = sum;
    }

    let best = { order: 0, parameters: [] as number[], estimate: Number.POSITIVE_INFINITY };
    for (let level = maxOrder; level >= 0; level -= 1) {
      const partitions = 1 << level;
      const size = n >> level;
      if (level < maxOrder) {
        // Each partition here is two of the level below, whose sums are in place.
        for (let p = 0; p < partitions; p += 1) {
          sums[p] = (sums[2 * p] as number) + (sums[2 * p + 1] as number);
        }
      }
      const parameters: number[] = [];
      let estimate = 0;
      for (let p = 0; p < partitions; p += 1) {
        const count = p === 0 ? size - order : size;
        const { k, bits } = riceParameter(sums[p] as number, count);
        parameters.push(k);
        estimate += 4 + bits;
      }
      if (estimate <= best.estimate) best = { order: level, parameters, estimate };
    }

    // The size exactly, as the section will be written.
    const partitions = 1 << best.order;
    const size = n >> best.order;
    const parameterBits = best.parameters.some((k) => k > MAX_RICE4) ? 5 : 4;
    let bits = 2 + 4;
    at = 0;
    for (let p = 0; p < partitions; p += 1) {
      const k = best.parameters[p] as number;
      const end = (p + 1) * size - order;
      bits += parameterBits + (end - at) * (k + 1);
      for (; at < end; at += 1) bits += (folded[at] as number) >>> k;
    }
    return { order: best.order, parameters: best.parameters, bits };
  }

  /** Add a frame to the part being filled, starting a new one where it would not fit. */
  private append(frame: Uint8Array): void {
    if (this.partLength + frame.length > this.part.length) {
      this.parts.push(this.part.slice(0, this.partLength));
      this.part = new Uint8Array(PART_BYTES);
      this.partLength = 0;
    }
    this.part.set(frame, this.partLength);
    this.partLength += frame.length;
  }
}

/** The steps `encodeFlacSteps` takes for `length` samples: one a frame. */
export function flacFrameCount(length: number): number {
  return Math.ceil(length / FLAC_BLOCK_SIZE);
}

/**
 * A mastered render as a FLAC stream, a frame a step: each block quantized
 * to `bits` with dither (see pcmQuantize.ts), then coded. The stream comes
 * back in parts; see `FlacEncoder.finish`.
 */
export function* encodeFlacSteps(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  bits: FlacBitDepth,
): Steps<Uint8Array<ArrayBuffer>[]> {
  const encoder = new FlacEncoder(sampleRate, bits);
  const quantize = createQuantizer(bits);
  const l = new Int32Array(FLAC_BLOCK_SIZE);
  const r = new Int32Array(FLAC_BLOCK_SIZE);
  for (let from = 0; from < left.length; from += FLAC_BLOCK_SIZE) {
    const count = Math.min(FLAC_BLOCK_SIZE, left.length - from);
    quantize(left, from, count, l);
    quantize(right, from, count, r);
    encoder.writeFrame(l, r, count);
    yield;
  }
  return encoder.finish();
}

/** What a FLAC stream's header says of it; see `readFlacStreamInfo`. */
export interface FlacStreamInfo {
  /** Whether STREAMINFO is the stream's only metadata block. */
  onlyBlock: boolean;
  minBlockSize: number;
  maxBlockSize: number;
  minFrameBytes: number;
  maxFrameBytes: number;
  sampleRate: number;
  channels: number;
  bits: number;
  totalSamples: number;
  md5: Uint8Array;
}

/** The STREAMINFO at the start of `bytes`, or null where they do not start a FLAC stream. */
export function readFlacStreamInfo(bytes: Uint8Array): FlacStreamInfo | null {
  if (bytes.length < FLAC_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x664c6143) return null; // fLaC
  if (((bytes[4] as number) & 0x7f) !== 0 || view.getUint32(4) % 0x100_0000 !== 34) return null;
  const packed = view.getUint32(18);
  return {
    onlyBlock: ((bytes[4] as number) & 0x80) !== 0,
    minBlockSize: view.getUint16(8),
    maxBlockSize: view.getUint16(10),
    minFrameBytes: view.getUint32(11) % 0x100_0000,
    maxFrameBytes: view.getUint32(14) % 0x100_0000,
    sampleRate: packed >>> 12,
    channels: ((packed >>> 9) & 0b111) + 1,
    bits: ((packed >>> 4) & 0b11111) + 1,
    totalSamples: (packed & 0xf) * 0x1_0000_0000 + view.getUint32(22),
    md5: bytes.slice(26, FLAC_HEADER_BYTES),
  };
}
