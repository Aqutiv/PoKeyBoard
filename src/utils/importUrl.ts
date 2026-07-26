import { RemoteImportError } from '@/utils/errors';

export const MAX_IMPORT_URL_LENGTH = 2048;
const MAX_DERIVED_FILE_NAME_LENGTH = 200;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Drop control characters the way sanitizeFileNamePart does, without a regex. */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/**
 * Validate a pasted link. Only http(s) is accepted: `data:` and `blob:` add
 * surface for no gain over the file picker, and the rest are unfetchable.
 * A scheme-less host is upgraded to https so `example.com/score.mxl` works.
 */
export function parseImportUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IMPORT_URL_LENGTH) {
    throw new RemoteImportError('invalidUrl');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    if (HAS_SCHEME.test(trimmed)) throw new RemoteImportError('invalidUrl');
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      throw new RemoteImportError('invalidUrl');
    }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RemoteImportError('invalidUrl');
  }
  // Mixed content is blocked before the request leaves the browser, and the
  // failure is indistinguishable from CORS — reject it here so the message can
  // be specific. Harmless on the http dev server, where the guard is off.
  if (url.protocol === 'http:' && globalThis.location?.protocol === 'https:') {
    throw new RemoteImportError('invalidUrl');
  }
  return url;
}

/**
 * The link carried by a drop, or '' when there is none. Dragging a link out of
 * a browser supplies no file — only these text flavours.
 *
 * `text/uri-list` (RFC 2483) is authoritative: blank lines and `#` comments are
 * metadata, so the first real line wins. Plain text is a fallback and must
 * carry an explicit http(s) scheme, so dropping ordinary selected text never
 * starts a download — the scheme-less shorthand stays a typing affordance.
 */
export function urlFromDropText(uriList: string, plainText: string): string {
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) return trimmed;
  }
  const plain = plainText.trim();
  return /^https?:\/\//i.test(plain) ? plain : '';
}

/**
 * Best-effort file name from a link, used for the score title fallback and to
 * guess score-vs-take. Reads `pathname`, so query and fragment drop out.
 * Returns '' when the link has no last segment. Never throws.
 */
export function fileNameFromImportUrl(url: URL): string {
  const segment = url.pathname.split('/').pop() ?? '';
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed percent escapes: keep the raw segment.
  }
  return stripControlChars(decoded).trim().slice(0, MAX_DERIVED_FILE_NAME_LENGTH);
}
