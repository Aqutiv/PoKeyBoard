import { FLAC_HEADER_BYTES } from './flacEncode';
import type { AudioTags } from './id3';

/**
 * A FLAC file's tags: a VORBIS_COMMENT metadata block, the one every FLAC
 * player reads. Its fields are `NAME=value` in UTF-8, whatever the script, and
 * its lengths little-endian — the one part of a FLAC stream that is.
 */

/** Who wrote the stream, where libFLAC would name itself. */
const VENDOR = 'PoKeyBoard';

const utf8 = new TextEncoder();

/** The comment block, flagged as the stream's last metadata block. Empty fields are left out. */
export function vorbisCommentBlock(tags: AudioTags): Uint8Array<ArrayBuffer> {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ['TITLE', tags.title],
    ['ARTIST', tags.artist],
    ['COMPOSER', tags.composer],
    ['ALBUM', tags.album],
    ['ENCODER', tags.encodedWith],
  ];
  const comments: Uint8Array[] = [];
  for (const [name, text] of fields) {
    const trimmed = text?.trim();
    if (trimmed) comments.push(utf8.encode(`${name}=${trimmed}`));
  }
  const vendor = utf8.encode(VENDOR);
  const bodyLength =
    4 + vendor.length + 4 + comments.reduce((sum, comment) => sum + 4 + comment.length, 0);
  const out = new Uint8Array(4 + bodyLength);
  const view = new DataView(out.buffer);
  // Last block, type 4; then the body's length, 24 bits big-endian.
  view.setUint32(0, 0x8400_0000 | bodyLength);
  let at = 4;
  view.setUint32(at, vendor.length, true);
  out.set(vendor, at + 4);
  at += 4 + vendor.length;
  view.setUint32(at, comments.length, true);
  at += 4;
  for (const comment of comments) {
    view.setUint32(at, comment.length, true);
    out.set(comment, at + 4);
    at += 4 + comment.length;
  }
  return out;
}

/**
 * The file to hand over: the encoder's stream with the tags put in after its
 * STREAMINFO, which is then no longer the last metadata block. Made of slices
 * of `bare`, so the frames are not copied here.
 */
export function tagFlac(bare: Blob, tags: AudioTags): Blob {
  return new Blob(
    [
      bare.slice(0, 4),
      // STREAMINFO's own header again, without the last-block flag.
      new Uint8Array([0, 0, 0, 34]),
      bare.slice(8, FLAC_HEADER_BYTES),
      vorbisCommentBlock(tags),
      bare.slice(FLAC_HEADER_BYTES),
    ],
    { type: 'audio/flac' },
  );
}
