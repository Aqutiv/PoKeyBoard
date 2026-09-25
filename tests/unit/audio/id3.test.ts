import { describe, expect, it } from 'vitest';
import { id3v2Tag } from '@/audio/id3';

/** Read a tag back the way a player would: header, then frame after frame. */
function readTag(tag: Uint8Array): { version: number; size: number; frames: Map<string, string> } {
  expect(String.fromCharCode(tag[0]!, tag[1]!, tag[2]!)).toBe('ID3');
  const size = (tag[6]! << 21) | (tag[7]! << 14) | (tag[8]! << 7) | tag[9]!;
  const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
  const frames = new Map<string, string>();
  let at = 10;
  while (at < 10 + size) {
    const id = String.fromCharCode(...tag.subarray(at, at + 4));
    const length = view.getUint32(at + 4);
    const body = tag.subarray(at + 10, at + 10 + length);
    const text =
      body[0] === 0
        ? String.fromCharCode(...body.subarray(1))
        : new TextDecoder('utf-16le').decode(body.subarray(3));
    if (body[0] === 1) expect([body[1], body[2]]).toEqual([0xff, 0xfe]);
    frames.set(id, text);
    at += 10 + length;
  }
  return { version: tag[3]!, size, frames };
}

describe('the ID3 tag', () => {
  it('names the take, its composer and where it came from', () => {
    const tag = id3v2Tag({
      title: 'Gymnopédie No. 1',
      artist: 'Erik Satie',
      composer: 'Erik Satie',
      album: 'PoKeyBoard',
      encodedWith: 'PoKeyBoard (Salamander)',
    });
    const { version, size, frames } = readTag(tag);
    expect(version).toBe(3);
    expect(size).toBe(tag.length - 10);
    expect(Object.fromEntries(frames)).toEqual({
      TIT2: 'Gymnopédie No. 1',
      TPE1: 'Erik Satie',
      TCOM: 'Erik Satie',
      TALB: 'PoKeyBoard',
      TSSE: 'PoKeyBoard (Salamander)',
    });
  });

  it('writes text Latin-1 cannot hold as UTF-16', () => {
    const { frames } = readTag(id3v2Tag({ title: '月光 🎹' }));
    expect(frames.get('TIT2')).toBe('月光 🎹');
  });

  it('keeps Latin-1 text one byte a letter', () => {
    const tag = id3v2Tag({ title: 'Für Elise' });
    // Header, frame header, encoding byte, nine letters.
    expect(tag.length).toBe(10 + 10 + 1 + 9);
  });

  it('leaves out what is not known', () => {
    const { frames } = readTag(id3v2Tag({ title: 'My take', artist: '', composer: '  ' }));
    expect([...frames.keys()]).toEqual(['TIT2']);
  });

  it('writes a size no byte of which can be mistaken for a frame sync', () => {
    const tag = id3v2Tag({ title: 'x'.repeat(300) });
    expect(tag.subarray(6, 10).every((byte) => byte < 0x80)).toBe(true);
    expect(readTag(tag).frames.get('TIT2')).toHaveLength(300);
  });
});
