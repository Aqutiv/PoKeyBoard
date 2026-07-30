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

/**
 * Longest file name a POSIX directory entry generally holds — bytes, not
 * characters, which is why a title of CJK can be well under `MAX_BASE_LENGTH`
 * and still overrun it at three bytes a character.
 */
const MAX_FILE_NAME_BYTES = 255;
const utf8 = new TextEncoder();

/**
 * `<prefix><title><suffix>`, with the title shortened by whole characters
 * until the whole name fits `MAX_FILE_NAME_BYTES`. Only the title gives way:
 * the decorations around it are what make the name readable, and they are the
 * part a truncating filesystem would otherwise eat.
 */
function composeFileName(prefix: string, title: string, suffix: string): string {
  const fixed = utf8.encode(prefix).length + utf8.encode(suffix).length;
  let chars = [...title];
  while (chars.length > 0 && fixed + utf8.encode(chars.join('')).length > MAX_FILE_NAME_BYTES) {
    chars = chars.slice(0, -1);
  }
  // Trimming mid-word can leave the dots and spaces sanitizing already removed.
  const fitted = chars.join('').replace(/[. ]+$/g, '');
  return `${prefix}${fitted}${suffix}`;
}

export function takeJsonFileName(title: string): string {
  return composeFileName('PoKeyBoard - ', sanitizeFileNamePart(title), '.pokeyboard.json');
}

export interface TakeAudioNameParts {
  /** Credited composer, for a library track; absent on a user recording. */
  composer?: string;
  /** The piano the take sounds on, e.g. 'Salamander'. */
  piano?: string;
}

/**
 * `PoKeyBoard - Title (Salamander).mp3` for a recording; a library track adds
 * its credit: `PoKeyBoard - Erik Satie - Gymnopedie No. 1 (Salamander).mp3`.
 */
export function takeAudioFileName(title: string, parts: TakeAudioNameParts = {}): string {
  const credit = parts.composer ? `${sanitizeFileNamePart(parts.composer)} - ` : '';
  const piano = parts.piano ? ` (${sanitizeFileNamePart(parts.piano)})` : '';
  return composeFileName(`PoKeyBoard - ${credit}`, sanitizeFileNamePart(title), `${piano}.mp3`);
}

export function takeSheetFileName(title: string): string {
  return composeFileName('PoKeyBoard - ', sanitizeFileNamePart(title), '.pdf');
}

export function backupFileName(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `PoKeyBoard Backup - ${iso}.json`;
}
