import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeScore, ResultRecord } from '@/features/practice/practiceRecords';
import { PracticeResults } from '@/features/practice/PracticeResults';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';
import { fr } from '@/i18n/fr';
import type { Messages, SupportedLanguage } from '@/i18n/types';
import { usePracticeStore, type PracticeResult } from '@/state/usePracticeStore';
import { keepTimeReport, keepTimeResult, waitReport, waitResult } from './practiceFixtures';

// The card reads the transport's state, to stand aside while a recording runs.
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => 'paused',
    subscribeState: () => () => {},
    pause: vi.fn(),
    setLoop: vi.fn(),
    seek: vi.fn(),
  },
}));

type Screen = 'desktop' | 'phone' | 'short landscape';

/** jsdom has no matchMedia: answer the card's two questions as `screen` would. */
function onScreen(kind: Screen): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-height: 500px')
      ? kind === 'short landscape'
      : query.includes('min-width: 900px') && kind === 'desktop',
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderCard(language: SupportedLanguage = 'en', m: Messages = en): void {
  render(
    <I18nContext.Provider value={{ language, locale: language, m }}>
      <PracticeResults />
    </I18nContext.Provider>,
  );
}

const card = () => screen.queryByRole('group');
/** The card's line of facts, which the track's best ends where it is shown. */
const facts = () => card()?.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim();
const show = (result: PracticeResult) => act(() => usePracticeStore.getState().show(result));

/** This run's own score, as kept: eight of ten right first time, at the take's speed. */
function score(overrides: Partial<PracticeScore> = {}): PracticeScore {
  return {
    at: '2026-10-04T10:00:00.000Z',
    accuracy: 0.8,
    speed: 1,
    notes: 10,
    fingerprint: '16:16000',
    ...overrides,
  };
}

/** An earlier run, an hour before this one. */
const EARLIER = '2026-10-04T09:00:00.000Z';

/** Short of the track's best, a perfect run at 60%. */
const BELOW: ResultRecord = {
  best: score({ at: EARLIER, accuracy: 1, speed: 0.6 }),
  last: score(),
  newBest: false,
};

/** As good as the track's best, and no better. */
const MATCHED: ResultRecord = { best: score({ at: EARLIER }), last: score(), newBest: false };

/** The track's first result in this way of practising: the best there is. */
const FIRST: ResultRecord = { best: score(), last: score(), newBest: false };

/** Ten of ten right first time at 60%, better than the run before it. */
const PERFECT = waitResult({
  slowestSpeed: 0.6,
  wait: waitReport({
    rightFirstTime: 10,
    withWrongKey: 0,
    wrongKeys: 0,
    letThrough: 0,
    slowHolds: 0,
    inFlow: 10,
    accuracy: 1,
    slowestSpeed: 0.6,
  }),
  record: {
    best: score({ accuracy: 1, speed: 0.6 }),
    last: score({ accuracy: 1, speed: 0.6 }),
    newBest: true,
  },
});

/** The line for eight of ten on a desktop, before anything is said of the best. */
const DESKTOP_LINE =
  '8 of 10 right first time (80%) · 2 wrong keys · 1 let through · 2 waits over 2 s · ' +
  '6 without stopping';

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  onScreen('desktop');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the results card, for a run through a Library track', () => {
  it('ends the line with the best the run fell short of, at its speed, on a desktop', () => {
    renderCard();
    show(waitResult({ record: BELOW }));
    expect(facts()).toBe(`${DESKTOP_LINE} · Best 100% (at 60%)`);
    // The run itself is the headline: the card never says it twice.
    expect(facts()).not.toMatch(/Last/);
    expect(within(card()!).queryByText('New best')).toBeNull();
  });

  it('shows a best the run only matched', () => {
    renderCard();
    show(waitResult({ record: MATCHED }));
    expect(facts()).toBe(`${DESKTOP_LINE} · Best 80%`);
  });

  it('marks a new best by the headline, with no best beside it', () => {
    renderCard();
    show(PERFECT);
    const badge = within(card()!).getByText('New best');
    expect(badge).toHaveClass('practice-results__new-best');
    expect(facts()).toBe(
      '10 of 10 right first time (100%) New best · 10 without stopping · at 60% speed',
    );
  });

  it('says neither for a first result, the best there is', () => {
    renderCard();
    show(waitResult({ record: FIRST }));
    expect(facts()).toBe(DESKTOP_LINE);
    expect(within(card()!).queryByText('New best')).toBeNull();
  });

  it('keeps to the best on a phone, without its speed, or to the new best', () => {
    onScreen('phone');
    renderCard();
    show(waitResult({ record: BELOW }));
    expect(facts()).toBe('8 of 10 right first time · 2 wrong · 1 let through · Best 100%');

    show(PERFECT);
    expect(facts()).toBe('10 of 10 right first time New best');
  });

  it('keeps to the best in short landscape too, on the one line', () => {
    onScreen('short landscape');
    renderCard();
    show(waitResult({ record: BELOW }));
    expect(facts()).toBe('8 of 10 right first time · 2 wrong · 1 let through · Best 100%');
    expect(within(card()!).queryByRole('list')).toBeNull();
  });

  it('measures a Keep-time run against the best share on time', () => {
    renderCard();
    show(
      keepTimeResult({
        keepTime: keepTimeReport({ tendency: null }),
        record: {
          best: score({ at: EARLIER, accuracy: 0.9, onTime: 20 / 28, notes: 28 }),
          last: score({ accuracy: 24 / 30, onTime: 18 / 28, notes: 28 }),
          newBest: false,
        },
      }),
    );
    expect(facts()).toBe(
      '18 of 28 on time (64%) · 24 hit · 3 early · 3 late · 4 missed · 2 wrong notes · Best 71%',
    );
  });

  it('says the best in the words of the card’s language', () => {
    onScreen('phone');
    renderCard('fr', fr);
    show(waitResult({ record: BELOW }));
    expect(facts()).toBe('8 sur 10 justes du premier coup · 2 fautes · 1 sautée · Record : 100 %');
    show(PERFECT);
    expect(facts()).toBe('10 sur 10 justes du premier coup Nouveau record');
  });

  it('says nothing of the best until it is known', () => {
    renderCard();
    show(waitResult());
    expect(facts()).toBe(DESKTOP_LINE);

    act(() => usePracticeStore.getState().attachRecord(1, BELOW));
    expect(facts()).toBe(`${DESKTOP_LINE} · Best 100% (at 60%)`);
  });

  it('tells a screen reader how the run stands once, after the result, whatever the screen', () => {
    onScreen('phone');
    renderCard();
    show(waitResult());
    const status = screen.getByRole('status');
    const said = status.textContent ?? '';
    expect(said).toMatch(/^Practice results: 8 of 10 right first time \(80%\)/);

    act(() => usePracticeStore.getState().attachRecord(1, BELOW));
    // Added after what was said, which is left as it was: only the addition
    // is new to a reader. Its speed too, which a phone's line leaves out.
    expect(status.textContent).toBe(`${said} Your best: 100% at 60% speed.`);
    expect(status.firstChild?.textContent).toBe(said);

    cleanup();
    renderCard();
    show(PERFECT);
    expect(screen.getByRole('status').textContent).toMatch(/at 60% speed\. New best!$/);

    // A first result adds nothing.
    cleanup();
    renderCard();
    show(waitResult({ record: FIRST }));
    expect(screen.getByRole('status').textContent).toBe(said);
  });
});
