import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { META_PRACTICE_RESULTS, setMetadata } from '@/data/metadataRepository';
import { libraryTrackSummary } from '@/features/library/catalog';
import { LibraryPage } from '@/features/library/LibraryPage';
import type { PracticeScore } from '@/features/practice/practiceRecords';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

vi.mock('@/app/routerContext', () => ({
  useRouter: () => ({ route: 'library', navigate: () => {} }),
}));
vi.mock('@/features/library/libraryService', () => ({ openLibraryTrack: vi.fn() }));

const DAY = 'library:a-beautiful-day';
const TIDE = 'library:evening-tide';

/** A track as the catalog has it now, as a result kept on it says. */
function fingerprintOf(takeId: string): string {
  const summary = libraryTrackSummary(takeId);
  if (!summary) throw new Error(`No such track: ${takeId}`);
  return `${summary.noteCount}:${summary.durationMs}`;
}

const at = (minutes: number) => `2026-10-04T10:${String(minutes).padStart(2, '0')}:00.000Z`;

function score(takeId: string, overrides: Partial<PracticeScore> = {}): PracticeScore {
  return {
    at: at(0),
    accuracy: 0.92,
    speed: 1,
    notes: 25,
    fingerprint: fingerprintOf(takeId),
    content: 'c0ffee00',
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <LibraryPage />
    </I18nContext.Provider>,
  );
}

/** A track's row, by its name in full: a string name matches the whole of it. */
const row = (title: string) => screen.getByRole('button', { name: `Open ${title}` });

beforeEach(async () => {
  await db.metadata.clear();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS, libraryFolder: 'originals' });
});

afterEach(() => {
  cleanup();
});

describe('the Library’s practice chip', () => {
  it('shows the best in the way the track was practised most recently', async () => {
    await setMetadata(META_PRACTICE_RESULTS, {
      v: 1,
      tracks: {
        [DAY]: {
          'wait:right': {
            best: score(DAY, { at: at(1), accuracy: 0.92 }),
            last: score(DAY, { at: at(5), accuracy: 0.6 }),
          },
          'along:both': {
            best: score(DAY, { at: at(2), accuracy: 0.8, onTime: 0.64 }),
            last: score(DAY, { at: at(9), accuracy: 0.5, onTime: 0.4 }),
          },
        },
        [TIDE]: {
          'wait:right': { best: score(TIDE), last: score(TIDE) },
        },
      },
    });
    renderPage();
    expect(
      await within(row('A Beautiful Day')).findByText('Both hands in time · 64%'),
    ).toBeVisible();
    expect(within(row('Evening Tide')).getByText('Right hand · 92%')).toBeVisible();
  });

  it('describes the chip in words to a screen reader, and leaves the row’s name alone', async () => {
    await setMetadata(META_PRACTICE_RESULTS, {
      v: 1,
      tracks: { [DAY]: { 'wait:right': { best: score(DAY), last: score(DAY) } } },
    });
    renderPage();
    await within(row('A Beautiful Day')).findByText('Right hand · 92%');
    // Named as before, so a name matched exactly still finds it.
    expect(row('A Beautiful Day')).toHaveAccessibleName('Open A Beautiful Day');
    expect(row('A Beautiful Day')).toHaveAccessibleDescription(
      'Best in right hand, waiting for you: 92%',
    );
    // A track never practised through has no chip, and nothing to describe.
    expect(row('Evening Tide')).not.toHaveAttribute('aria-describedby');
  });

  it('shows no chip for a track whose notes have changed since it was practised', async () => {
    await setMetadata(META_PRACTICE_RESULTS, {
      v: 1,
      tracks: {
        [DAY]: {
          'wait:right': {
            best: score(DAY, { fingerprint: '1:1000' }),
            last: score(DAY, { fingerprint: '1:1000' }),
          },
        },
        [TIDE]: { 'wait:left': { best: score(TIDE), last: score(TIDE) } },
      },
    });
    renderPage();
    // Once the records are in, as the other track's chip shows.
    await within(row('Evening Tide')).findByText('Left hand · 92%');
    expect(row('A Beautiful Day')).not.toHaveAttribute('aria-describedby');
    expect(row('A Beautiful Day').querySelector('.library-item__best')).toBeNull();
  });
});
