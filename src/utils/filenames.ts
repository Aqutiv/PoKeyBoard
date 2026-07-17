const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const ILLEGAL_CHARS = '<>:"/\\|?*';
const MAX_BASE_LENGTH = 120;

/**
 * Make a title safe as a cross-platform file-name fragment: strips characters
 * illegal on Windows/POSIX (including control characters), collapses
 * whitespace, avoids reserved device names, and trims trailing dots/spaces.
 */
export function sanitizeFileNamePart(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || ILLEGAL_CHARS.includes(ch) ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/[. ]+$/g, '');
  if (out.length > MAX_BASE_LENGTH) {
    out = out.slice(0, MAX_BASE_LENGTH).trimEnd();
  }
  if (out.length === 0) {
    out = 'Untitled';
  } else if (WINDOWS_RESERVED.test(out)) {
    out = `_${out}`;
  }
  return out;
}

export function takeJsonFileName(title: string): string {
  return `PoKeyBoard - ${sanitizeFileNamePart(title)}.pokeyboard.json`;
}

export function takeAudioFileName(title: string): string {
  return `PoKeyBoard - ${sanitizeFileNamePart(title)}.mp3`;
}

export function backupFileName(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `PoKeyBoard Backup - ${iso}.json`;
}
