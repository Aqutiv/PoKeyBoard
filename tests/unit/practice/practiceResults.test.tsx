import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { PracticeResults } from '@/features/practice/PracticeResults';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';
import { usePracticeStore } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { waitReport, waitResult } from './practiceFixtures';

const setLoop = vi.fn();
const seek = vi.fn();
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    setLoop: (loop: unknown) => setLoop(loop),
    seek: (ms: number) => seek(ms),
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

function renderCard(): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <PracticeResults />
    </I18nContext.Provider>,
  );
}

const card = () => screen.queryByRole('group', { name: 'Practice results' });
const facts = () => card()?.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim();
const show = (result = waitResult()) => act(() => usePracticeStore.getState().show(result));

const SUMMARY =
  'Practice results: 8 of 10 right first time (80%), 2 wrong keys, 1 let through, ' +
  '2 waits over 2 s, 6 without stopping, at 60% speed.';

/** Eight of ten right first time, 60% at the slowest. */
const SLOWED = waitResult({ slowestSpeed: 0.6, wait: waitReport({ slowestSpeed: 0.6 }) });

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  setLoop.mockClear();
  seek.mockClear();
  onScreen('desktop');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the practice results card', () => {
  it('says how the run went on one line, on a desktop', () => {
    renderCard();
    show(SLOWED);
    expect(facts()).toBe(
      '8 of 10 right first time (80%) · 2 wrong keys · 1 let through · 2 waits over 2 s · ' +
        '6 without stopping · at 60% speed',
    );
    expect(within(card()!).getByText('8 of 10 right first time').tagName).toBe('STRONG');
  });

  it('leaves out what never happened, and the speed when it was the take’s own', () => {
    renderCard();
    show(
      waitResult({
        wait: waitReport({
          rightFirstTime: 10,
          withWrongKey: 0,
          wrongKeys: 0,
          letThrough: 0,
          slowHolds: 0,
          inFlow: 0,
          accuracy: 1,
        }),
      }),
    );
    expect(facts()).toBe('10 of 10 right first time (100%)');
  });

  it('never rounds a share up to a perfect one', () => {
    renderCard();
    show(
      waitResult({
        wait: waitReport({ steps: 200, rightFirstTime: 199, accuracy: 0.995, inFlow: 0 }),
      }),
    );
    expect(facts()).toMatch(/^199 of 200 right first time \(99%\)/);
  });

  it('keeps to the headline, the wrong keys and the notes let through on a phone', () => {
    onScreen('phone');
    renderCard();
    show(SLOWED);
    expect(facts()).toBe('8 of 10 right first time · 2 wrong · 1 let through');
    expect(within(card()!).getByRole('list', { name: 'Bars' })).toBeInTheDocument();
  });

  it('fits one line in short landscape, with no cells', () => {
    onScreen('short landscape');
    renderCard();
    show(SLOWED);
    expect(facts()).toBe('8 of 10 right first time · 2 wrong · 1 let through');
    expect(within(card()!).queryByRole('list')).toBeNull();
    expect(within(card()!).getByRole('button', { name: 'Dismiss the results' })).toBeVisible();
  });

  it('names each section, and what tapping it does', () => {
    renderCard();
    show(
      waitResult({
        wait: waitReport({
          cells: [
            {
              kind: 'bars',
              fromBar: 5,
              toBar: 8,
              startMs: 8000,
              endMs: 16000,
              good: 3,
              total: 4,
              grade: 'fair',
            },
            {
              kind: 'bars',
              fromBar: 9,
              toBar: 9,
              startMs: 16000,
              endMs: 18000,
              good: 0,
              total: 1,
              grade: 'weak',
            },
          ],
        }),
      }),
    );
    const list = within(card()!).getByRole('list', { name: 'Bars' });
    const cells = within(list).getAllByRole('button');
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'Bars 5–8: 3 of 4 right first time. Loop these bars.',
      'Bar 9: 0 of 1 right first time. Loop this bar.',
    ]);
    // On the cell itself, the bars and the share of them right.
    expect(cells[0]).toHaveTextContent(/^5–8\s*3\/4$/);
    expect(cells[1]).toHaveTextContent(/^9\s*0\/1$/);
    expect(cells.map((cell) => cell.dataset.grade)).toEqual(['fair', 'weak']);
  });

  it('names each pass round a loop', () => {
    renderCard();
    show(
      waitResult({
        wait: waitReport({
          cells: [
            { kind: 'pass', pass: 3, good: 4, total: 4, grade: 'good' },
            { kind: 'pass', pass: 4, good: 2, total: 4, grade: 'weak' },
          ],
        }),
      }),
    );
    const list = within(card()!).getByRole('list', { name: 'Passes' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((cell) => cell.getAttribute('aria-label')),
    ).toEqual(['Pass 3: 4 of 4 right first time', 'Pass 4: 2 of 4 right first time']);
    // A pass is not a passage of the take: there is nothing to loop.
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('loops the bars of a section tapped, and goes to their start', () => {
    // 120 bpm in 4/4, a bar every two seconds; ten bars long.
    useTakeStore.getState().setTake(
      createEmptyTake({
        notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 20000, velocity: 0.6 }],
        durationMs: 20000,
      }),
    );
    renderCard();
    show(
      waitResult({
        wait: waitReport({
          cells: [
            {
              kind: 'bars',
              fromBar: 5,
              toBar: 8,
              startMs: 8000,
              endMs: 16000,
              good: 3,
              total: 4,
              grade: 'fair',
            },
          ],
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Bars 5–8/ }));
    expect(setLoop).toHaveBeenCalledWith({ startMs: 8000, endMs: 16000 });
    expect(seek).toHaveBeenCalledWith(8000);
  });

  it('says the result once to a screen reader, from a status it keeps', () => {
    renderCard();
    // There before anything is said, so a reader hears what arrives in it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);

    show(SLOWED);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(SUMMARY);

    // A phone says less on its line, and still the whole of it to a reader.
    onScreen('phone');
    cleanup();
    renderCard();
    expect(screen.getByRole('status').textContent).toBe(SUMMARY);
  });

  it('goes when dismissed', () => {
    renderCard();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the results' }));
    expect(card()).toBeNull();
    expect(usePracticeStore.getState().result).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });

  it('never takes the keys from the player', () => {
    // An aria-modal anywhere stands the computer keyboard and MIDI down.
    renderCard();
    show();
    expect(card()).not.toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing while a run is under way, or with no result', () => {
    renderCard();
    expect(card()).toBeNull();
    act(() =>
      usePracticeStore.setState({
        result: waitResult(),
        live: { runId: 2, takeId: 'take', style: 'wait' },
      }),
    );
    expect(card()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });
});
