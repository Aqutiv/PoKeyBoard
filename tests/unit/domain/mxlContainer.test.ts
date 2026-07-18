import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractMusicXmlText, isScoreFileName } from '@/domain/mxlContainer';
import { ScoreImportError } from '@/utils/errors';

const SCORE_XML = '<score-partwise version="3.1"><part-list/></score-partwise>';

const CONTAINER_XML =
  '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
  '<rootfile full-path="score.xml"/></rootfiles></container>';

function utf16leWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = code >> 8;
  }
  return bytes;
}

describe('isScoreFileName', () => {
  it('accepts mxl, musicxml, and xml in any case', () => {
    expect(isScoreFileName('song.mxl')).toBe(true);
    expect(isScoreFileName('SONG.MXL')).toBe(true);
    expect(isScoreFileName('song.musicxml')).toBe(true);
    expect(isScoreFileName('song.xml')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isScoreFileName('take.json')).toBe(false);
    expect(isScoreFileName('take.pokeyboard.json')).toBe(false);
    expect(isScoreFileName('notes.txt')).toBe(false);
    expect(isScoreFileName('mxl')).toBe(false);
  });
});

describe('extractMusicXmlText', () => {
  it('follows META-INF/container.xml to the root file', () => {
    const zip = zipSync({
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'a-decoy.xml': strToU8('<decoy/>'),
      'score.xml': strToU8(SCORE_XML),
    });
    expect(extractMusicXmlText(zip)).toBe(SCORE_XML);
  });

  it('falls back to the first score entry when container.xml is missing', () => {
    const zip = zipSync({ 'piece.musicxml': strToU8(SCORE_XML) });
    expect(extractMusicXmlText(zip)).toBe(SCORE_XML);
  });

  it('never picks entries under META-INF in the fallback scan', () => {
    const zip = zipSync({
      'META-INF/metadata.xml': strToU8('<meta/>'),
      'real.xml': strToU8(SCORE_XML),
    });
    expect(extractMusicXmlText(zip)).toBe(SCORE_XML);
  });

  it('passes plain XML bytes through untouched', () => {
    expect(extractMusicXmlText(strToU8(SCORE_XML))).toBe(SCORE_XML);
  });

  it('decodes UTF-16LE text with a BOM', () => {
    expect(extractMusicXmlText(utf16leWithBom(SCORE_XML))).toBe(SCORE_XML);
  });

  it('throws on a zip with no score inside', () => {
    const zip = zipSync({ 'readme.txt': strToU8('hello') });
    expect(() => extractMusicXmlText(zip)).toThrow(ScoreImportError);
  });

  it('throws on corrupt bytes that carry a zip signature', () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => extractMusicXmlText(garbage)).toThrow(ScoreImportError);
  });
});
