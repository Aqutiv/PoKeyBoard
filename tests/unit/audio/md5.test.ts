// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Md5 } from '@/audio/md5';
import { xorshift32 } from '@/utils/random';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

function md5(...pieces: Uint8Array[]): string {
  const hash = new Md5();
  for (const piece of pieces) hash.update(piece);
  return hex(hash.digest());
}

const text = (value: string) => new TextEncoder().encode(value);

describe('MD5', () => {
  it('gives the digests RFC 1321 lists', () => {
    const vectors: Record<string, string> = {
      '': 'd41d8cd98f00b204e9800998ecf8427e',
      a: '0cc175b9c0f1b6a831c399e269772661',
      abc: '900150983cd24fb0d6963f7d28e17f72',
      'message digest': 'f96b697d7cb7938d525a2f31aaf161d0',
      abcdefghijklmnopqrstuvwxyz: 'c3fcd3d76192e4007dfb496cca67e13b',
      ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:
        'd174ab98d277d9f5a5611c2c9f419d9f',
      ['1234567890'.repeat(8)]: '57edf4a22be3c955ac49da2e2107b67a',
    };
    for (const [message, digest] of Object.entries(vectors)) {
      expect(md5(text(message))).toBe(digest);
    }
  });

  it('comes to the same digest however the bytes are split', () => {
    const random = xorshift32(5);
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 70_001]) {
      const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
      const expected = createHash('md5').update(bytes).digest('hex');
      expect(md5(bytes)).toBe(expected);
      // Pieces of every size, including empty ones and pieces across blocks.
      const pieces: Uint8Array[] = [];
      for (let at = 0; at < length;) {
        const size = Math.floor(random() * 150);
        pieces.push(bytes.subarray(at, at + size));
        at += size;
      }
      expect(md5(...pieces)).toBe(expected);
    }
  });
});
