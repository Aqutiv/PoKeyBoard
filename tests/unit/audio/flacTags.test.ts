// @vitest-environment node
import { FLACDecoder } from '@wasm-audio-decoders/flac';
import { describe, expect, it } from 'vitest';
import {
  FLAC_BLOCK_SIZE,
  FLAC_HEADER_BYTES,
  FlacEncoder,
  readFlacStreamInfo,
} from '@/audio/flacEncode';
import { tagFlac, vorbisCommentBlock } from '@/audio/flacTags';

const tags = {
  title: 'Gymnopédie No. 1',
  artist: 'Erik Satie',
  composer: 'Erik Satie',
  album: 'PoKeyBoard',
  encodedWith: 'PoKeyBoard (Steinway)',
};

/** The comment block's fields, read back the way a player reads them. */
function readComments(block: Uint8Array) {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const text = new TextDecoder();
  const vendorLength = view.getUint32(4, true);
  let at = 8 + vendorLength;
  const count = view.getUint32(at, true);
  at += 4;
  const comments: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const size = view.getUint32(at, true);
    comments.push(text.decode(block.subarray(at + 4, at + 4 + size)));
    at += 4 + size;
  }
  return {
    last: (block[0]! & 0x80) !== 0,
    type: block[0]! & 0x7f,
    length: view.getUint32(0) & 0xff_ffff,
    vendor: text.decode(block.subarray(8, 8 + vendorLength)),
    comments,
    end: at,
  };
}

describe('FLAC tags', () => {
  it('writes a Vorbis comment block in UTF-8, leaving out empty fields', () => {
    const block = vorbisCommentBlock({ ...tags, artist: ' ', composer: undefined });
    const read = readComments(block);
    expect(read).toMatchObject({ last: true, type: 4, vendor: 'PoKeyBoard' });
    expect(read.length).toBe(block.length - 4);
    expect(read.end).toBe(block.length);
    expect(read.comments).toEqual([
      'TITLE=Gymnopédie No. 1',
      'ALBUM=PoKeyBoard',
      'ENCODER=PoKeyBoard (Steinway)',
    ]);
  });

  it('puts the tags after STREAMINFO, which is then no longer the last block, and still decodes', async () => {
    const length = FLAC_BLOCK_SIZE + 500;
    const left = Int32Array.from({ length }, (_, i) => Math.round(8000 * Math.sin(i / 11)));
    const right = Int32Array.from({ length }, (_, i) => Math.round(7000 * Math.sin(i / 12)));
    const encoder = new FlacEncoder(48_000, 16);
    encoder.writeFrame(
      left.subarray(0, FLAC_BLOCK_SIZE),
      right.subarray(0, FLAC_BLOCK_SIZE),
      FLAC_BLOCK_SIZE,
    );
    encoder.writeFrame(left.subarray(FLAC_BLOCK_SIZE), right.subarray(FLAC_BLOCK_SIZE), 500);
    const bare = new Blob(encoder.finish());
    const tagged = tagFlac(bare, tags);
    expect(tagged.type).toBe('audio/flac');
    const bytes = new Uint8Array(await tagged.arrayBuffer());
    const plain = new Uint8Array(await bare.arrayBuffer());

    const info = readFlacStreamInfo(bytes)!;
    expect(info.onlyBlock).toBe(false);
    expect(info.totalSamples).toBe(length);
    expect(readFlacStreamInfo(plain)!.onlyBlock).toBe(true);
    const block = bytes.subarray(
      FLAC_HEADER_BYTES,
      bytes.length - (plain.length - FLAC_HEADER_BYTES),
    );
    expect(readComments(block).comments).toContain('ARTIST=Erik Satie');
    // The frames follow untouched.
    expect(bytes.subarray(FLAC_HEADER_BYTES + block.length)).toEqual(
      plain.subarray(FLAC_HEADER_BYTES),
    );

    const decoder = new FLACDecoder();
    await decoder.ready;
    try {
      const decoded = await decoder.decodeFile(bytes);
      expect(decoded.errors).toEqual([]);
      expect(decoded.samplesDecoded).toBe(length);
    } finally {
      decoder.free();
    }
  });
});
