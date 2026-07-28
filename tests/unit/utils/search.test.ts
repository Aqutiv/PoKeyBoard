import { describe, expect, it } from 'vitest';
import { foldForSearch, matchesSearch } from '@/utils/search';

describe('foldForSearch', () => {
  it('lowercases and strips the accents nobody types', () => {
    expect(foldForSearch('Für Elise')).toBe('fur elise');
    expect(foldForSearch('Prélude')).toBe('prelude');
    expect(foldForSearch('Gymnopédie No. 1')).toBe('gymnopedie no. 1');
    expect(foldForSearch('Ständchen')).toBe('standchen');
    expect(foldForSearch('Frédéric Chopin')).toBe('frederic chopin');
  });

  it('leaves unaccented text alone', () => {
    expect(foldForSearch('Canon in D')).toBe('canon in d');
    expect(foldForSearch('')).toBe('');
  });
});

describe('matchesSearch', () => {
  it('matches a plain substring, either case', () => {
    expect(matchesSearch('Nocturne in C♯ minor', 'nocturne')).toBe(true);
    expect(matchesSearch('Nocturne in C♯ minor', 'NOCTURNE')).toBe(true);
    expect(matchesSearch('Nocturne in C♯ minor', 'in c')).toBe(true);
    expect(matchesSearch('Nocturne in C♯ minor', 'waltz')).toBe(false);
  });

  it('finds accented titles typed without the accent, and the reverse', () => {
    expect(matchesSearch('Für Elise (complete)', 'fur elise')).toBe(true);
    expect(matchesSearch('Für Elise (complete)', 'Für')).toBe(true);
    expect(matchesSearch('Prélude in E minor, Op. 28 No. 4', 'prelude')).toBe(true);
    expect(matchesSearch('Liebesträume No. 3', 'liebestraume')).toBe(true);
  });

  it('takes every token, in any order', () => {
    const track = 'Nocturne in E♭ major, Op. 9 No. 2 Frédéric Chopin';
    expect(matchesSearch(track, 'chopin nocturne')).toBe(true);
    expect(matchesSearch(track, 'nocturne chopin')).toBe(true);
    expect(matchesSearch(track, 'chopin waltz')).toBe(false);
  });

  it('matches everything when the query is blank', () => {
    expect(matchesSearch('anything at all', '')).toBe(true);
    expect(matchesSearch('anything at all', '   ')).toBe(true);
  });
});
