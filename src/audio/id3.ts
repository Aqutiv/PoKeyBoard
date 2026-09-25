/**
 * An ID3v2.3 tag: what a music player shows for a file instead of its name.
 *
 * Version 2.3 rather than 2.4 because it is the one every player reads —
 * Windows' own among them, which ignores 2.4. Text that fits Latin-1 is
 * written as Latin-1, anything else as UTF-16 with a byte-order mark, the two
 * encodings 2.3 knows.
 */

export interface Id3Tags {
  title: string;
  /** Shown as the artist; a library track's composer. */
  artist?: string;
  composer?: string;
  album?: string;
  /** How the file was made: the app and the piano it sounds on. */
  encodedWith?: string;
}

const HEADER_BYTES = 10;

function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0xff) return false;
  }
  return true;
}

/** A text frame's body: an encoding byte, then the text. */
function textBody(text: string): Uint8Array {
  if (isLatin1(text)) {
    const body = new Uint8Array(1 + text.length);
    for (let i = 0; i < text.length; i += 1) body[1 + i] = text.charCodeAt(i);
    return body;
  }
  // UTF-16, little-endian after its byte-order mark.
  const body = new Uint8Array(3 + text.length * 2);
  body[0] = 1;
  body[1] = 0xff;
  body[2] = 0xfe;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    body[3 + i * 2] = unit & 0xff;
    body[4 + i * 2] = unit >> 8;
  }
  return body;
}

function frame(id: string, text: string): Uint8Array {
  const body = textBody(text);
  const out = new Uint8Array(HEADER_BYTES + body.length);
  for (let i = 0; i < 4; i += 1) out[i] = id.charCodeAt(i);
  // A 2.3 frame's size is a plain big-endian integer; flags stay zero.
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, HEADER_BYTES);
  return out;
}

/** The tag's own size, seven bits a byte so no byte of it can look like a sync. */
function synchsafe(size: number): number[] {
  return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
}

/** The tag to put in front of an MP3's first frame. Empty fields are left out. */
export function id3v2Tag(tags: Id3Tags): Uint8Array<ArrayBuffer> {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ['TIT2', tags.title],
    ['TPE1', tags.artist],
    ['TCOM', tags.composer],
    ['TALB', tags.album],
    ['TSSE', tags.encodedWith],
  ];
  const frames: Uint8Array[] = [];
  for (const [id, text] of fields) {
    const trimmed = text?.trim();
    if (trimmed) frames.push(frame(id, trimmed));
  }
  const size = frames.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(HEADER_BYTES + size);
  out.set([0x49, 0x44, 0x33, 3, 0, 0, ...synchsafe(size)]);
  let at = HEADER_BYTES;
  for (const part of frames) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
