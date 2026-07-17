import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  sanitizeFileNamePart,
  takeAudioFileName,
  takeJsonFileName,
} from '@/utils/filenames';

describe('sanitizeFileNamePart', () => {
  it('strips characters illegal on Windows and POSIX', () => {
    expect(sanitizeFileNamePart('My<Take>: "v2"/final\\|?*')).toBe('My Take v2 final');
  });

  it('strips control characters', () => {
    const withControls = `Take${String.fromCharCode(0)}${String.fromCharCode(31)}One${String.fromCharCode(127)}`;
    expect(sanitizeFileNamePart(withControls)).toBe('Take One');
  });

  it('collapses whitespace and trims trailing dots', () => {
    expect(sanitizeFileNamePart('  My   Take... ')).toBe('My Take');
  });

  it('keeps ordinary punctuation like dashes', () => {
    expect(sanitizeFileNamePart('Nocturne - Op. 9-2')).toBe('Nocturne - Op. 9-2');
  });

  it('escapes reserved Windows device names', () => {
    expect(sanitizeFileNamePart('CON')).toBe('_CON');
    expect(sanitizeFileNamePart('com1')).toBe('_com1');
    expect(sanitizeFileNamePart('Console')).toBe('Console');
  });

  it('falls back to Untitled for empty results', () => {
    expect(sanitizeFileNamePart('')).toBe('Untitled');
    expect(sanitizeFileNamePart('???')).toBe('Untitled');
  });

  it('clamps very long titles', () => {
    const long = 'x'.repeat(500);
    expect(sanitizeFileNamePart(long).length).toBeLessThanOrEqual(120);
  });
});

describe('file name builders', () => {
  it('builds the spec-format names', () => {
    expect(takeJsonFileName('My Take')).toBe('PoKeyBoard - My Take.pokeyboard.json');
    expect(takeAudioFileName('My Take')).toBe('PoKeyBoard - My Take.mp3');
    expect(backupFileName(new Date('2026-07-17T12:00:00Z'))).toBe(
      'PoKeyBoard Backup - 2026-07-17.json',
    );
  });
});
