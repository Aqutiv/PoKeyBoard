import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayViewSwitch } from '@/features/play/PlayViewSwitch';
import type { PlayView } from '@/features/play/playView';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';

function show(props: {
  view?: PlayView;
  keysOnly?: boolean;
  offerKeys?: boolean;
  onView?: (view: PlayView) => void;
  onKeysOnly?: () => void;
}) {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <PlayViewSwitch
        view={props.view ?? 'score'}
        keysOnly={props.keysOnly ?? false}
        offerKeys={props.offerKeys ?? false}
        onView={props.onView ?? (() => {})}
        onKeysOnly={props.onKeysOnly ?? (() => {})}
      />
    </I18nContext.Provider>,
  );
  const group = screen.getByRole('group', { name: 'View' });
  const pressed = () =>
    [...group.querySelectorAll('button')].map((button) => [
      button.textContent,
      button.getAttribute('aria-pressed'),
    ]);
  return { group, pressed };
}

describe('PlayViewSwitch', () => {
  afterEach(cleanup);

  it('offers the score and the falling notes, the one shown pressed', () => {
    expect(show({ view: 'waterfall' }).pressed()).toEqual([
      ['Notation', 'false'],
      ['Falling notes', 'true'],
    ]);
  });

  it('adds the keys alone where short landscape offers them, pressed over the view', () => {
    expect(show({ view: 'waterfall', keysOnly: true, offerKeys: true }).pressed()).toEqual([
      ['Notation', 'false'],
      ['Falling notes', 'false'],
      ['Keyboard', 'true'],
    ]);
  });

  it('tells the page which was chosen', () => {
    const onView = vi.fn();
    const onKeysOnly = vi.fn();
    show({ offerKeys: true, onView, onKeysOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Falling notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard' }));
    expect(onView.mock.calls).toEqual([['waterfall'], ['score']]);
    expect(onKeysOnly).toHaveBeenCalledTimes(1);
  });

  it('keeps each option’s name when narrow screens show only its icon', () => {
    const { group } = show({});
    for (const button of group.querySelectorAll('button')) {
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByRole('button', { name: 'Falling notes' })).toBeTruthy();
  });
});
