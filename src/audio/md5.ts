/**
 * MD5, fed a piece at a time. A FLAC stream carries the MD5 of its samples so
 * that a decoder can check it gives back exactly what went in; that is all it
 * is for here, a checksum, not anything that has to stand up to an attacker.
 * Written from the algorithm's description: 64-byte blocks of sixteen
 * little-endian words, four rounds of sixteen steps.
 */

/** How far each step rotates, four to a round and the same four through it. */
const ROTATIONS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** What each step adds: the whole part of |sin(step + 1)| · 2³². */
const SINES = Int32Array.from(
  { length: 64 },
  (_, step) => Math.floor(Math.abs(Math.sin(step + 1)) * 0x1_0000_0000) | 0,
);

export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89 | 0;
  private c = 0x98badcfe | 0;
  private d = 0x10325476;
  /** The start of a block the bytes so far have not yet filled. */
  private readonly pending = new Uint8Array(64);
  private pendingBytes = 0;
  private totalBytes = 0;
  private readonly words = new Int32Array(16);

  update(bytes: Uint8Array): void {
    this.totalBytes += bytes.length;
    let at = 0;
    if (this.pendingBytes > 0) {
      at = Math.min(64 - this.pendingBytes, bytes.length);
      this.pending.set(bytes.subarray(0, at), this.pendingBytes);
      this.pendingBytes += at;
      if (this.pendingBytes < 64) return;
      this.block(this.pending, 0);
      this.pendingBytes = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.block(bytes, at);
    this.pending.set(bytes.subarray(at), 0);
    this.pendingBytes = bytes.length - at;
  }

  /** The 16-byte digest of everything given to `update`. Call it once, last. */
  digest(): Uint8Array<ArrayBuffer> {
    const bits = this.totalBytes * 8;
    // A one bit, zeros to 8 bytes short of a block's end, then the length.
    const tail = new Uint8Array(this.pendingBytes < 56 ? 64 : 128);
    tail.set(this.pending.subarray(0, this.pendingBytes));
    tail[this.pendingBytes] = 0x80;
    const tailView = new DataView(tail.buffer);
    tailView.setUint32(tail.length - 8, bits % 0x1_0000_0000, true);
    tailView.setUint32(tail.length - 4, Math.floor(bits / 0x1_0000_0000), true);
    for (let at = 0; at < tail.length; at += 64) this.block(tail, at);

    const out = new Uint8Array(16);
    const view = new DataView(out.buffer);
    view.setInt32(0, this.a, true);
    view.setInt32(4, this.b, true);
    view.setInt32(8, this.c, true);
    view.setInt32(12, this.d, true);
    return out;
  }

  private block(bytes: Uint8Array, at: number): void {
    const words = this.words;
    for (let i = 0; i < 16; i += 1) {
      const o = at + i * 4;
      words[i] =
        (bytes[o] as number) |
        ((bytes[o + 1] as number) << 8) |
        ((bytes[o + 2] as number) << 16) |
        ((bytes[o + 3] as number) << 24);
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let step = 0; step < 64; step += 1) {
      let mixed: number;
      let word: number;
      if (step < 16) {
        mixed = (b & c) | (~b & d);
        word = step;
      } else if (step < 32) {
        mixed = (d & b) | (~d & c);
        word = (5 * step + 1) & 15;
      } else if (step < 48) {
        mixed = b ^ c ^ d;
        word = (3 * step + 5) & 15;
      } else {
        mixed = c ^ (b | ~d);
        word = (7 * step) & 15;
      }
      const sum = (a + mixed + (SINES[step] as number) + (words[word] as number)) | 0;
      const rotation = ROTATIONS[step] as number;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << rotation) | (sum >>> (32 - rotation)))) | 0;
    }
    this.a = (this.a + a) | 0;
    this.b = (this.b + b) | 0;
    this.c = (this.c + c) | 0;
    this.d = (this.d + d) | 0;
  }
}
