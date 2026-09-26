import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuizPanel } from '@/features/learn/QuizPanel';
import type { LearnPhrase, QuizStep } from '@/features/learn/types';
import { useQuiz } from '@/features/learn/useQuiz';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';

const EAR: QuizStep = {
  id: 'hearTheMood',
  kind: 'quiz',
  rounds: 2,
  question: {
    kind: 'chordQuality',
    chords: [
      { root: 0, quality: 'major' },
      { root: 9, quality: 'minor' },
    ],
  },
};

type OnHear = (phrase: LearnPhrase) => Promise<boolean>;

function Harness({ onHear }: { onHear: OnHear }) {
  const session = useQuiz(EAR);
  return <QuizPanel session={session} onHear={onHear} hearing={false} />;
}

function renderPanel(onHear: OnHear): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <Harness onHear={onHear} />
    </I18nContext.Provider>,
  );
}

const answerButton = (quality: 'Major' | 'Minor') =>
  screen.getByRole<HTMLButtonElement>('button', { name: `Answer ${quality}` });

describe('QuizPanel: an ear round', () => {
  afterEach(cleanup);

  it('locks the answers until the chord has been played', () => {
    renderPanel(vi.fn(async () => true));
    expect(answerButton('Major').disabled).toBe(true);
    expect(answerButton('Minor').disabled).toBe(true);
  });

  it('unlocks them once the chord is actually scheduled', async () => {
    renderPanel(vi.fn(async () => true));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    });
    expect(answerButton('Major').disabled).toBe(false);
  });

  it('keeps them locked while the chord is still being prepared', async () => {
    // A cold range can take seconds to load: the click alone is not hearing.
    let finish: (played: boolean) => void = () => {};
    renderPanel(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(answerButton('Major').disabled).toBe(true);
    await act(async () => finish(true));
    expect(answerButton('Major').disabled).toBe(false);
  });

  it('keeps them locked when the chord could not be played at all', async () => {
    renderPanel(vi.fn(async () => false));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    });
    expect(answerButton('Major').disabled).toBe(true);
  });

  it('asks the next round to be heard again', async () => {
    renderPanel(vi.fn(async () => true));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    });
    fireEvent.click(answerButton('Major'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(answerButton('Minor').disabled).toBe(true);
  });
});

/**
 * Two flats, then six: B♭ major, then G♭ — whose home notes a sharp-spelled
 * note label would call A♯ and F♯.
 */
const KEYS: QuizStep = {
  id: 'nameAnyKey',
  kind: 'quiz',
  rounds: 2,
  question: { kind: 'keySignature', signatures: [-2, -6] },
};

function KeyHarness() {
  const session = useQuiz(KEYS);
  return <QuizPanel session={session} onHear={async () => false} hearing={false} />;
}

describe('QuizPanel: a key signature', () => {
  beforeEach(() => {
    // The signature is drawn by `StaffSnippet`, and jsdom lays nothing out.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    render(
      <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
        <KeyHarness />
      </I18nContext.Provider>,
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('names each answer by its key, in circle order', () => {
    const labels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text !== '');
    expect(labels).toEqual(['G♭', 'B♭']);
  });

  it('asks for the major key, and says what the picture shows', () => {
    expect(screen.getByText('Which major key has this signature?')).toBeTruthy();
    // The signature, not the key: "two flats" is the question, not its answer.
    expect(screen.getByRole('img', { name: 'Key signature: 2 flats' })).toBeTruthy();
  });

  it('corrects a wrong answer to the round’s key, not to a note', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Answer G♭' }));
    expect(screen.getByText('That signature is B♭ major.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Answer B♭' }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Key signature: 6 flats' })).toBeTruthy();
  });
});
