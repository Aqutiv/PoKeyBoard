import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeMenu } from '@/features/transport/ModeMenu';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';
import { useSettingsStore } from '@/state/useSettingsStore';

const refreshTrainingMode = vi.fn();
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    refreshTrainingMode: () => refreshTrainingMode(),
  },
}));

function renderMenu({ disabled = false, desktop = false } = {}): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <ModeMenu disabled={disabled} desktop={desktop} />
    </I18nContext.Provider>,
  );
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Modes' }));
}

function radio(name: RegExp) {
  return screen.getByRole('menuitemradio', { name });
}

/** Each button of a desktop group, with whether it is pressed. */
function pressed(group: string): Array<[string | null, string | null]> {
  return within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .map((button) => [button.textContent, button.getAttribute('aria-pressed')]);
}

beforeEach(() => {
  refreshTrainingMode.mockClear();
  useSettingsStore.getState().setRecordMode('overdub');
  useSettingsStore.getState().setPlaybackMode('simple');
  useSettingsStore.getState().setPracticeStyle('wait');
});

afterEach(cleanup);

describe('ModeMenu', () => {
  it('holds both modes in one menu, with the active choice checked', () => {
    renderMenu();
    open();

    expect(screen.getByRole('group', { name: 'Recording mode' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Playback mode' })).toBeTruthy();
    // No hand, so no style to practise it in.
    expect(screen.queryByRole('group', { name: 'Practice style' })).toBeNull();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
    expect(screen.getByRole('menuitemradio', { name: /Overdub/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /Simple/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('writes the recording mode without touching playback', () => {
    renderMenu();
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Replace/ }));

    expect(useSettingsStore.getState().recordMode).toBe('replace');
    expect(refreshTrainingMode).not.toHaveBeenCalled();
  });

  it('tells the transport when the playback mode changes under it', () => {
    renderMenu();
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /right hand/ }));

    expect(useSettingsStore.getState().playbackMode).toBe('training-right');
    expect(refreshTrainingMode).toHaveBeenCalledOnce();

    open();
    expect(screen.getByRole('menuitemradio', { name: /right hand/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is closed to changes while a recording is running', () => {
    renderMenu({ disabled: true });
    const trigger = screen.getByRole('button', { name: 'Modes' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers the practice style once a hand is chosen, Wait for me first', () => {
    useSettingsStore.getState().setPlaybackMode('training-left');
    renderMenu();
    open();

    const style = screen.getByRole('group', { name: 'Practice style' });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(8);
    const [wait, keepTime] = within(style).getAllByRole('menuitemradio');
    expect(wait).toHaveAccessibleName('Wait for me');
    expect(wait).toHaveAttribute('aria-checked', 'true');
    expect(keepTime).toHaveAccessibleName('Keep time');
    expect(keepTime).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps time on the hand chosen, and remembers the style', () => {
    useSettingsStore.getState().setPlaybackMode('training-left');
    renderMenu();
    open();
    fireEvent.click(radio(/Keep time/));

    expect(useSettingsStore.getState()).toMatchObject({
      playbackMode: 'playalong-left',
      practiceStyle: 'playAlong',
    });
    expect(refreshTrainingMode).toHaveBeenCalledOnce();

    // Still the left hand, now in time with the music.
    open();
    expect(radio(/left hand/)).toHaveAttribute('aria-checked', 'true');
    expect(radio(/Keep time/)).toHaveAttribute('aria-checked', 'true');
    expect(radio(/Wait for me/)).toHaveAttribute('aria-checked', 'false');
  });

  it('goes back to waiting on the same hand', () => {
    useSettingsStore.setState({ playbackMode: 'playalong-right', practiceStyle: 'playAlong' });
    renderMenu();
    open();
    fireEvent.click(radio(/Wait for me/));

    expect(useSettingsStore.getState()).toMatchObject({
      playbackMode: 'training-right',
      practiceStyle: 'wait',
    });
    expect(refreshTrainingMode).toHaveBeenCalledOnce();
  });

  it('picks a hand from Simple in the style last chosen', () => {
    useSettingsStore.getState().setPracticeStyle('playAlong');
    renderMenu();
    open();
    fireEvent.click(radio(/right hand/));

    expect(useSettingsStore.getState().playbackMode).toBe('playalong-right');
    expect(refreshTrainingMode).toHaveBeenCalledOnce();
  });

  it('keeps the style in use when the hand changes', () => {
    // A Learn hand-off opens in Wait for me whatever was last chosen here;
    // another hand practises in that style too.
    useSettingsStore.setState({ playbackMode: 'training-right', practiceStyle: 'playAlong' });
    renderMenu();
    open();
    fireEvent.click(radio(/both hands/));

    expect(useSettingsStore.getState().playbackMode).toBe('training-both');
  });

  it('goes back to Simple, leaving the style remembered', () => {
    useSettingsStore.setState({ playbackMode: 'playalong-both', practiceStyle: 'playAlong' });
    renderMenu();
    open();
    fireEvent.click(radio(/Simple/));

    expect(useSettingsStore.getState()).toMatchObject({
      playbackMode: 'simple',
      practiceStyle: 'playAlong',
    });
    open();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
  });
});

describe('ModeMenu on a desktop', () => {
  it('shows the style beside the hands only once a hand is chosen', () => {
    renderMenu({ desktop: true });
    expect(pressed('Playback mode')).toEqual([
      ['Listen', 'true'],
      ['Practice left', 'false'],
      ['Practice right', 'false'],
      ['Practice both', 'false'],
    ]);
    expect(screen.queryByRole('group', { name: 'Practice style' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Practice left' }));

    expect(useSettingsStore.getState().playbackMode).toBe('training-left');
    expect(refreshTrainingMode).toHaveBeenCalledOnce();
    expect(pressed('Practice style')).toEqual([
      ['Wait for me', 'true'],
      ['Keep time', 'false'],
    ]);
  });

  it('keeps the hand pressed as the style changes', () => {
    useSettingsStore.getState().setPlaybackMode('training-right');
    renderMenu({ desktop: true });
    fireEvent.click(screen.getByRole('button', { name: 'Keep time' }));

    expect(useSettingsStore.getState()).toMatchObject({
      playbackMode: 'playalong-right',
      practiceStyle: 'playAlong',
    });
    expect(refreshTrainingMode).toHaveBeenCalledOnce();
    expect(pressed('Playback mode')).toEqual([
      ['Listen', 'false'],
      ['Practice left', 'false'],
      ['Practice right', 'true'],
      ['Practice both', 'false'],
    ]);
    expect(pressed('Practice style')).toEqual([
      ['Wait for me', 'false'],
      ['Keep time', 'true'],
    ]);
  });

  it('picks a hand from Listen in the style last chosen, and drops the style for Listen', () => {
    useSettingsStore.getState().setPracticeStyle('playAlong');
    renderMenu({ desktop: true });
    fireEvent.click(screen.getByRole('button', { name: 'Practice both' }));

    expect(useSettingsStore.getState().playbackMode).toBe('playalong-both');
    expect(pressed('Practice style')).toEqual([
      ['Wait for me', 'false'],
      ['Keep time', 'true'],
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
    expect(useSettingsStore.getState().playbackMode).toBe('simple');
    expect(screen.queryByRole('group', { name: 'Practice style' })).toBeNull();
  });

  it('is closed to changes while a recording is running', () => {
    useSettingsStore.getState().setPlaybackMode('playalong-both');
    renderMenu({ disabled: true, desktop: true });

    for (const name of ['Listen', 'Practice both', 'Wait for me', 'Keep time']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
