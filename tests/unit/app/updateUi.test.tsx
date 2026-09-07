import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportState } from '@/features/transport/transportMachine';
import { AppNav } from '@/app/AppNav';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { APP_BUILD_LABEL } from '@/app/version';
import { I18nContext } from '@/i18n/i18nContext';
import { en } from '@/i18n/en';

const mock = vi.hoisted(() => ({
  waiting: false,
  state: 'idle' as TransportState,
  listeners: new Set<() => void>(),
  apply: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/pwa/updateManager', () => ({
  updateManager: {
    get updateAvailable() {
      return mock.waiting;
    },
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
    applyUpdate: () => mock.apply(),
  },
}));
vi.mock('@/app/hooks/useTransport', () => ({ useTransportState: () => mock.state }));
vi.mock('@/app/routerContext', () => ({
  useRouter: () => ({ route: 'settings', navigate: mock.navigate }),
}));
vi.mock('@/features/settings/PianoSection', () => ({ PianoSection: () => null }));
vi.mock('@/features/settings/MidiSection', () => ({ MidiSection: () => null }));

function renderUi() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <AppNav />
      <SettingsPage />
    </I18nContext.Provider>,
  );
}

describe('update discovery and safe application', () => {
  beforeEach(() => {
    mock.waiting = false;
    mock.state = 'idle';
    mock.apply.mockClear();
  });
  afterEach(cleanup);

  it('shows the running build and reacts to a waiting update without applying it', () => {
    renderUi();
    expect(screen.getByText(en.settings.upToDate({ version: APP_BUILD_LABEL }))).toBeTruthy();
    act(() => {
      mock.waiting = true;
      mock.listeners.forEach((listener) => listener());
    });
    expect(screen.getByRole('button', { name: 'Settings Update available' })).toBeTruthy();
    expect(mock.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.settings.applyUpdate }));
    expect(mock.apply).toHaveBeenCalledOnce();
  });

  it.each<TransportState>([
    'countIn',
    'recording',
    'playing',
    'scrubbing',
    'renderingAudio',
    'encodingAudio',
    'renderingSheet',
  ])('keeps updates inert while %s', (state) => {
    mock.waiting = true;
    mock.state = state;
    renderUi();
    const apply = screen.getByRole('button', { name: en.settings.finishPlaying });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(mock.apply).not.toHaveBeenCalled();
  });
});
