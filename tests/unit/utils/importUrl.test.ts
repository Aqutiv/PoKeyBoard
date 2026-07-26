import { describe, expect, it } from 'vitest';
import { isScoreFileName } from '@/domain/mxlContainer';
import { RemoteImportError } from '@/utils/errors';
import { fileNameFromImportUrl, parseImportUrl, urlFromDropText } from '@/utils/importUrl';

describe('parseImportUrl', () => {
  it('accepts http and https links', () => {
    expect(parseImportUrl('https://example.com/score.mxl').href).toBe(
      'https://example.com/score.mxl',
    );
    // jsdom serves the tests over http, so the mixed-content guard stays off.
    expect(parseImportUrl('http://example.com/score.mxl').protocol).toBe('http:');
  });

  it('trims surrounding whitespace', () => {
    expect(parseImportUrl('  https://example.com/a.mxl \n').pathname).toBe('/a.mxl');
  });

  it('upgrades a scheme-less host to https', () => {
    const url = parseImportUrl('example.com/scores/a.mxl');
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toBe('/scores/a.mxl');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['data:application/xml,<score/>', 'data URL'],
    ['blob:https://example.com/abc', 'blob URL'],
    ['file:///C:/scores/a.mxl', 'file URL'],
    ['javascript:alert(1)', 'javascript URL'],
    ['ftp://example.com/a.mxl', 'ftp URL'],
  ])('rejects %s (%s)', (raw) => {
    expect(() => parseImportUrl(raw)).toThrow(RemoteImportError);
  });

  it('rejects an over-long link', () => {
    const raw = `https://example.com/${'a'.repeat(2100)}.mxl`;
    expect(() => parseImportUrl(raw)).toThrow(RemoteImportError);
  });

  it('reports invalidUrl as the failure kind', () => {
    try {
      parseImportUrl('javascript:alert(1)');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteImportError);
      expect((error as RemoteImportError).kind).toBe('invalidUrl');
      expect((error as RemoteImportError).messageKey).toBe('importUrlInvalid');
    }
  });
});

describe('urlFromDropText', () => {
  it('takes the link from a uri-list payload', () => {
    expect(urlFromDropText('https://x.test/a.mxl', '')).toBe('https://x.test/a.mxl');
  });

  it('skips the comment and blank lines RFC 2483 allows', () => {
    const uriList = '# a comment\r\n\r\nhttps://x.test/a.mxl\r\nhttps://x.test/second.mxl';
    expect(urlFromDropText(uriList, '')).toBe('https://x.test/a.mxl');
  });

  it('prefers uri-list over the plain-text flavour of the same drop', () => {
    // Chrome supplies both; only uri-list is guaranteed to be the bare link.
    expect(urlFromDropText('https://x.test/a.mxl', 'Fur Elise')).toBe('https://x.test/a.mxl');
  });

  it('falls back to plain text carrying an explicit http(s) scheme', () => {
    expect(urlFromDropText('', 'https://x.test/a.mxl')).toBe('https://x.test/a.mxl');
    expect(urlFromDropText('', '  http://x.test/a.mxl  ')).toBe('http://x.test/a.mxl');
  });

  it('ignores dropped text that is not an explicit link', () => {
    // Dragging a selection must never start a download, so the scheme-less
    // shorthand that parseImportUrl accepts is deliberately not honoured here.
    expect(urlFromDropText('', 'just some words')).toBe('');
    expect(urlFromDropText('', 'example.com/a.mxl')).toBe('');
    expect(urlFromDropText('', 'javascript:alert(1)')).toBe('');
    expect(urlFromDropText('', '')).toBe('');
  });

  it('returns nothing for a uri-list of only comments', () => {
    expect(urlFromDropText('# just metadata\n', '')).toBe('');
  });
});

describe('fileNameFromImportUrl', () => {
  it('decodes percent escapes in the last path segment', () => {
    expect(fileNameFromImportUrl(new URL('https://x.test/scores/Fur%20Elise.mxl'))).toBe(
      'Fur Elise.mxl',
    );
  });

  it('ignores the query string and fragment', () => {
    expect(fileNameFromImportUrl(new URL('https://x.test/a.musicxml?v=2#part1'))).toBe(
      'a.musicxml',
    );
  });

  it('returns an empty name for a bare host or a trailing slash', () => {
    expect(fileNameFromImportUrl(new URL('https://x.test'))).toBe('');
    expect(fileNameFromImportUrl(new URL('https://x.test/scores/'))).toBe('');
  });

  it('survives malformed percent escapes', () => {
    expect(() => fileNameFromImportUrl(new URL('https://x.test/%E0%A4%A.mxl'))).not.toThrow();
    expect(fileNameFromImportUrl(new URL('https://x.test/%E0%A4%A.mxl'))).toBe('%E0%A4%A.mxl');
  });

  it('feeds isScoreFileName so scores and takes are told apart', () => {
    const score = fileNameFromImportUrl(new URL('https://x.test/a.mxl'));
    const take = fileNameFromImportUrl(new URL('https://x.test/a.pokeyboard.json'));
    expect(isScoreFileName(score)).toBe(true);
    expect(isScoreFileName(take)).toBe(false);
  });
});
