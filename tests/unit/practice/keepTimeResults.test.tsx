import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { PracticeResults } from '@/features/practice/PracticeResults';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';
import { fr } from '@/i18n/fr';
import type { Messages, SupportedLanguage } from '@/i18n/types';
import { usePracticeStore } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { keepTimeReport, keepTimeResult } from './practiceFixtures';

/** What the card asked of the transport, in order, and the state it found it in. */
const transport = vi.hoisted(() => ({
  calls: [] as unknown[][],
  state: 'paused',
  listeners: new Set<() => void>(),
}));
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => transport.state,
    subscribeState: (listener: () => void) => {
      transport.listeners.add(listener);
      return () => transport.listeners.delete(listener);
    },
    pause: () => transport.calls.push(['pause']),
    setLoop: (loop: unknown) => transport.calls.push(['setLoop', loop]),
    seek: (ms: number) => transport.calls.push(['seek', ms]),
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

/** What a screen reader reads of `element`: its text, less anything hidden from it. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? '';
}

const card = () => screen.queryByRole('group');
const facts = () => card()?.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim();
const show = (result = keepTimeResult()) => act(() => usePracticeStore.getState().show(result));

/** Every note late by much the same, about 95 ms. */
const STEADILY_LATE = keepTimeResult({
  keepTime: keepTimeReport({
    onTime: 2,
    early: 0,
    late: 22,
    meanOffsetMs: 95.4,
    tendency: 'dragging',
    consistentlyLate: true,
  }),
});

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  transport.calls = [];
  transport.state = 'paused';
  onScreen('desktop');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the results card for a run kept in time', () => {
  it('says how the run went on one line, on a desktop', () => {
    renderCard();
    show();
    expect(card()).toHaveAccessibleName('Practice results');
    expect(facts()).toBe(
      '18 of 28 on time (64%) · 24 hit · 3 early · 3 late · 4 missed · 2 wrong notes · ' +
        'You rush a little (about 35 ms early)',
    );
    expect(within(card()!).getByText('18 of 28 on time').tagName).toBe('STRONG');
  });

  it('leaves out what never happened, but always says how many notes were played', () => {
    renderCard();
    show(
      keepTimeResult({
        keepTime: keepTimeReport({
          notes: 8,
          hits: 0,
          onTime: 0,
          early: 0,
          late: 0,
          missed: 8,
          wrong: 0,
          meanOffsetMs: null,
          tendency: null,
        }),
      }),
    );
    expect(facts()).toBe('0 of 8 on time (0%) · 0 hit · 8 missed');
  });

  it('says nothing of a player who keeps the beat', () => {
    renderCard();
    show(
      keepTimeResult({
        keepTime: keepTimeReport({ meanOffsetMs: 12, tendency: 'steady', wrong: 0 }),
      }),
    );
    expect(facts()).toBe('18 of 28 on time (64%) · 24 hit · 3 early · 3 late · 4 missed');
  });

  it('says why every note late alike may be the sound, not the player', () => {
    renderCard();
    show(STEADILY_LATE);
    expect(facts()).toBe(
      '2 of 28 on time (7%) · 24 hit · 22 late · 4 missed · 2 wrong notes · ' +
        'You drag a little (about 95 ms late) · ' +
        'Always about that late: maybe your audio’s delay (Bluetooth?)',
    );
  });

  it('tells the slowest speed the run went at, below the take’s own', () => {
    renderCard();
    show(keepTimeResult({ keepTime: keepTimeReport({ slowestSpeed: 0.5, tendency: null }) }));
    expect(facts()).toBe(
      '18 of 28 on time (64%) · 24 hit · 3 early · 3 late · 4 missed · 2 wrong notes · ' +
        'at 50% speed',
    );
  });

  it('keeps to the headline, the notes played and the timing on a phone', () => {
    onScreen('phone');
    renderCard();
    show();
    expect(facts()).toBe('18 of 28 on time · 24 hit · You rush');
    expect(within(card()!).getByRole('list', { name: 'Bars' })).toBeInTheDocument();

    act(() => usePracticeStore.getState().show(STEADILY_LATE));
    expect(facts()).toBe('2 of 28 on time · 24 hit · You drag · Audio delay?');
  });

  it('shortens a phone’s line in the words of its language', () => {
    onScreen('phone');
    renderCard('fr', fr);
    show();
    expect(facts()).toBe('18 sur 28 à temps · 24 jouées · Vous pressez');
  });

  it('fits one line in short landscape, with no cells', () => {
    onScreen('short landscape');
    renderCard();
    show();
    expect(facts()).toBe('18 of 28 on time · 24 hit · You rush');
    expect(within(card()!).queryByRole('list')).toBeNull();
    expect(within(card()!).getByRole('button', { name: 'Dismiss the results' })).toBeVisible();
  });

  it('names each section by its share on time, and loops it when tapped', () => {
    // 120 bpm in 4/4, a bar every two seconds; ten bars long.
    useTakeStore.getState().setTake(
      createEmptyTake({
        notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 20000, velocity: 0.6 }],
        durationMs: 20000,
      }),
    );
    renderCard();
    show();
    const list = within(card()!).getByRole('list', { name: 'Bars' });
    const [cell] = within(list).getAllByRole('button');
    expect(cell).toHaveAccessibleName('Bars 1–4: 18 of 28 on time. Loop these bars.');
    // The share on time, rounded down as the headline's is.
    expect(cell).toHaveTextContent(/^1–4 · 64%$/);
    expect(cell!.dataset.grade).toBe('fair');
    fireEvent.click(cell!);
    expect(transport.calls).toEqual([
      ['setLoop', { startMs: 0, endMs: 8000 }],
      ['seek', 0],
    ]);
  });

  it('names each pass round a loop by its share on time', () => {
    renderCard();
    show(
      keepTimeResult({
        keepTime: keepTimeReport({
          cells: [
            { kind: 'pass', pass: 3, good: 4, total: 4, grade: 'good' },
            { kind: 'pass', pass: 4, good: 1, total: 4, grade: 'weak' },
          ],
        }),
      }),
    );
    const list = within(card()!).getByRole('list', { name: 'Passes' });
    const cells = within(list).getAllByRole('listitem');
    expect(cells.map(spoken)).toEqual(['Pass 3: 4 of 4 on time', 'Pass 4: 1 of 4 on time']);
    expect(cells[1]).toHaveTextContent(/^4 · 25%/);
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('says the whole result once to a screen reader, whatever the screen', () => {
    const SUMMARY =
      'Practice results: 18 of 28 on time (64%), 24 hit, 3 early, 3 late, 4 missed, ' +
      '2 wrong notes. You rush a little (about 35 ms early).';
    renderCard();
    show();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(SUMMARY);

    onScreen('phone');
    cleanup();
    renderCard();
    expect(screen.getByRole('status').textContent).toBe(SUMMARY);

    act(() => usePracticeStore.getState().show(STEADILY_LATE));
    expect(screen.getByRole('status').textContent).toBe(
      'Practice results: 2 of 28 on time (7%), 24 hit, 22 late, 4 missed, 2 wrong notes. ' +
        'You drag a little (about 95 ms late). ' +
        'Always about that late: maybe your audio’s delay (Bluetooth?).',
    );
  });

  it('says where a live Keep-time run’s presses land, on the status it keeps', () => {
    renderCard();
    const status = screen.getByRole('status');
    expect(status).not.toHaveAttribute('data-keep-time-origin-ms');

    act(() => usePracticeStore.getState().runStarted(2, 'take', 'playAlong', 7180.5));
    expect(screen.getByRole('status')).toHaveAttribute('data-keep-time-origin-ms', '7180.5');

    // Gone with the run, and never there for one that waits.
    act(() => usePracticeStore.getState().runEnded(2));
    expect(screen.getByRole('status')).not.toHaveAttribute('data-keep-time-origin-ms');
    act(() => usePracticeStore.getState().runStarted(3, 'take', 'wait'));
    expect(screen.getByRole('status')).not.toHaveAttribute('data-keep-time-origin-ms');
  });
});
