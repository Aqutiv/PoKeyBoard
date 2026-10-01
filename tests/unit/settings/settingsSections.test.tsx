import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

vi.mock('@/pwa/updateManager', () => ({
  updateManager: {
    updateAvailable: false,
    subscribe: () => () => {},
    applyUpdate: vi.fn(),
    checkForUpdate: vi.fn(),
  },
}));
vi.mock('@/app/hooks/useTransport', () => ({ useTransportState: () => 'idle' }));
// The piano cards and the MIDI rows have suites of their own.
vi.mock('@/features/settings/PianoSection', () => ({ PianoSection: () => null }));
vi.mock('@/features/settings/MidiSection', () => ({ MidiSection: () => null }));

function renderPage() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <SettingsPage />
    </I18nContext.Provider>,
  );
}

function switchGroup() {
  return screen.getByRole('group', { name: en.settings.sectionLabel });
}

function segment(name: string) {
  return within(switchGroup()).getByRole('button', { name });
}

const SCRUB = en.settings.scrubAudition;
const NOTE_LABELS = en.settings.noteLabels;
const RESET = en.settings.resetSettings;

describe('Settings sections', () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });
  afterEach(cleanup);

  it('offers Sound, Playing, Display and App, and opens on Sound', () => {
    renderPage();
    expect(
      within(switchGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Sound', 'Playing', 'Display', 'App']);
    expect(segment('Sound')).toHaveAttribute('aria-pressed', 'true');
    expect(segment('App')).toHaveAttribute('aria-pressed', 'false');
    // Sound's own groups, under their headings, and nothing from elsewhere.
    expect(screen.getByRole('region', { name: en.settings.piano })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: en.settings.playback })).getByRole('checkbox', {
        name: SCRUB,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: NOTE_LABELS })).toBeNull();
    expect(screen.queryByRole('button', { name: RESET })).toBeNull();
  });

  it('shows one section at a time, and remembers the one chosen', () => {
    renderPage();
    fireEvent.click(segment('Display'));
    expect(segment('Display')).toHaveAttribute('aria-pressed', 'true');
    expect(segment('Sound')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('checkbox', { name: NOTE_LABELS })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: SCRUB })).toBeNull();
    expect(useSettingsStore.getState().settingsSection).toBe('display');

    fireEvent.click(segment('Playing'));
    expect(screen.getByRole('radiogroup', { name: en.settings.touchSensitivity })).toBeTruthy();
    expect(screen.getByRole('region', { name: en.settings.controllers })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: NOTE_LABELS })).toBeNull();
  });

  it('opens on the section shown last', () => {
    useSettingsStore.setState({ settingsSection: 'app' });
    renderPage();
    expect(segment('App')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: RESET })).toBeTruthy();
  });

  it('folds the device details away, and keeps the iPhone tip out of the fold', () => {
    useSettingsStore.setState({ settingsSection: 'app' });
    renderPage();
    expect(screen.getByText(en.settings.deviceDetails)).toBeVisible();
    expect(screen.getByText(en.settings.capabilities.webMidi)).not.toBeVisible();
    expect(screen.getByText(en.settings.iphoneHint)).toBeVisible();
  });

  it('stays on App when its Reset puts everything else back', () => {
    useSettingsStore.setState({ settingsSection: 'app', showNoteLabels: false });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: RESET }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState()).toMatchObject({
      settingsSection: 'app',
      showNoteLabels: true,
    });
    expect(segment('App')).toHaveAttribute('aria-pressed', 'true');
    confirm.mockRestore();
  });
});
