import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function renderMenu(disabled = false): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <ModeMenu disabled={disabled} />
    </I18nContext.Provider>,
  );
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Modes' }));
}

describe('ModeMenu', () => {
  beforeEach(() => {
    refreshTrainingMode.mockClear();
    useSettingsStore.getState().setRecordMode('overdub');
    useSettingsStore.getState().setPlaybackMode('simple');
  });

  afterEach(cleanup);

  it('holds both modes in one menu, with the active choice checked', () => {
    renderMenu();
    open();

    expect(screen.getByRole('group', { name: 'Recording mode' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Playback mode' })).toBeTruthy();
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
    renderMenu(true);
    const trigger = screen.getByRole('button', { name: 'Modes' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
