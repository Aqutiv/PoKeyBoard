import { afterEach, describe, expect, it } from 'vitest';
import {
  clearHashLink,
  hashLinkInText,
  libraryLinkHash,
  libraryLinkUrl,
  parseHashLink,
  takeLinkUrl,
} from '@/app/hashLinks';
import { LIBRARY_ID_PREFIX } from '@/domain/libraryTakes';
import { CLASSIC_SCORES } from '@/features/library/classicsManifest';
import { LIBRARY_TRACKS, libraryTrackSummary } from '@/features/library/catalog';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('parseHashLink', () => {
  it('reads a take link as its version and its data', () => {
    expect(parseHashLink('#/s/1.AbC-_9')).toEqual({ kind: 'take', version: 1, data: 'AbC-_9' });
    expect(parseHashLink('#/s/2.xyz')).toEqual({ kind: 'take', version: 2, data: 'xyz' });
  });

  it('keeps a take link with no readable version, as version 0, so it reads as damaged', () => {
    expect(parseHashLink('#/s/AbC')).toEqual({ kind: 'take', version: 0, data: 'AbC' });
    expect(parseHashLink('#/s/')).toEqual({ kind: 'take', version: 0, data: '' });
    expect(parseHashLink('#/s/0.AbC')).toEqual({ kind: 'take', version: 0, data: 'AbC' });
    expect(parseHashLink('#/s/x1.AbC')).toEqual({ kind: 'take', version: 0, data: 'AbC' });
    expect(parseHashLink('#/s/12345678901.AbC')).toEqual({ kind: 'take', version: 0, data: 'AbC' });
  });

  it('reads a library link as the track it names, decoded', () => {
    expect(parseHashLink('#/lib/a-beautiful-day')).toEqual({
      kind: 'library',
      trackId: 'a-beautiful-day',
    });
    expect(parseHashLink('#/lib/caf%C3%A9')).toEqual({ kind: 'library', trackId: 'café' });
    // A broken escape is kept as written, for the catalog to turn away.
    expect(parseHashLink('#/lib/%E0%A4%A')).toEqual({ kind: 'library', trackId: '%E0%A4%A' });
  });

  it('leaves every other hash to the router', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/play',
      '#/takes',
      '#/library',
      '#/s',
      '#/lib',
      '#s/1.x',
    ]) {
      expect(parseHashLink(hash), hash).toBeNull();
    }
  });

  it('reads a two-million-character link without stalling', () => {
    const data = 'A'.repeat(2_000_000);
    const started = performance.now();
    const link = parseHashLink(`#/s/1.${data}`);
    expect(performance.now() - started).toBeLessThan(250);
    expect(link).toEqual({ kind: 'take', version: 1, data });
  });
});

describe('library links', () => {
  // Every id the catalog holds, authored and vendored, whatever characters a
  // future one is made of: a link names each one exactly.
  const trackIds = [
    ...LIBRARY_TRACKS.map((track) => track.trackId),
    ...CLASSIC_SCORES.map((entry) => entry.trackId),
  ];

  it.each(trackIds)('round-trips %s through its link', (trackId) => {
    const url = new URL(libraryLinkUrl(trackId));
    expect(parseHashLink(url.hash)).toEqual({ kind: 'library', trackId });
  });

  it('round-trips a track id outside the catalog’s current characters too', () => {
    for (const trackId of ['Für Elise', 'a/b?c#d', '100%']) {
      expect(parseHashLink(new URL(libraryLinkUrl(trackId)).hash)).toEqual({
        kind: 'library',
        trackId,
      });
    }
  });

  it('names a track the catalog has, at the app’s own address', () => {
    expect(libraryTrackSummary(`${LIBRARY_ID_PREFIX}a-beautiful-day`)).toBeDefined();
    expect(libraryLinkHash('a-beautiful-day')).toBe('#/lib/a-beautiful-day');
    expect(libraryLinkUrl('a-beautiful-day')).toBe(
      `${window.location.origin}${import.meta.env.BASE_URL}#/lib/a-beautiful-day`,
    );
  });
});

describe('takeLinkUrl', () => {
  it('puts the payload after #/s/ at the app’s own address', () => {
    expect(takeLinkUrl('1.AbC')).toBe(
      `${window.location.origin}${import.meta.env.BASE_URL}#/s/1.AbC`,
    );
    expect(parseHashLink(new URL(takeLinkUrl('1.AbC')).hash)).toEqual({
      kind: 'take',
      version: 1,
      data: 'AbC',
    });
  });
});

describe('hashLinkInText', () => {
  it('finds a link of ours on any host, or with no host at all', () => {
    expect(hashLinkInText('https://example.org/elsewhere/#/s/1.AbC')).toEqual({
      kind: 'take',
      version: 1,
      data: 'AbC',
    });
    expect(hashLinkInText('  http://localhost:5173/#/lib/fur-elise \n')).toEqual({
      kind: 'library',
      trackId: 'fur-elise',
    });
    expect(hashLinkInText('#/s/1.AbC')).toEqual({ kind: 'take', version: 1, data: 'AbC' });
  });

  it('leaves any other link alone', () => {
    for (const text of [
      'https://example.org/score.mxl',
      'https://example.org/page#section',
      'https://example.org/#/takes',
      'example.org/#/play',
      '',
    ]) {
      expect(hashLinkInText(text), text).toBeNull();
    }
  });
});

describe('clearHashLink', () => {
  it('swaps the link for Play in place, keeping the page, its query and its history', () => {
    window.history.replaceState({ kept: true }, '', '/app/?from=chat#/s/1.AbC');
    const length = window.history.length;

    clearHashLink();

    expect(window.location.pathname).toBe('/app/');
    expect(window.location.search).toBe('?from=chat');
    expect(window.location.hash).toBe('#/play');
    expect(window.history.state).toEqual({ kept: true });
    expect(window.history.length).toBe(length);
  });
});
