import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackMode } from '@/features/transport/modes';
import { TransportControls } from '@/features/transport/TransportControls';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

const mock = vi.hoisted(() => ({ desktop: true }));

vi.mock('@/app/hooks/useMediaQuery', () => ({ useMediaQuery: () => mock.desktop }));
vi.mock('@/app/hooks/useTransport', () => ({
  useTransportState: () => 'idle',
  useTrainingWaiting: () => false,
  usePlayheadMs: () => 0,
  usePlayhead: <T,>(select: (playheadMs: number) => T) => select(0),
}));
vi.mock('@/app/hooks/useAudioEngine', () => ({
  usePianoPlayable: () => true,
  usePianoReady: () => true,
}));
vi.mock('@/features/transport/transportController', () => ({
  transportController: { refreshTrainingMode: vi.fn() },
}));

const WAIT_HINT = 'Playback waits for your notes.';
const KEEP_TIME_HINT = 'Playback keeps time: play your part along with it.';

function renderControls(playbackMode: PlaybackMode): void {
  useSettingsStore.setState({ playbackMode });
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <TransportControls />
    </I18nContext.Provider>,
  );
}

describe('the practice hint under the transport', () => {
  beforeEach(() => {
    mock.desktop = true;
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });
  afterEach(cleanup);

  it('says playback waits, in Wait for me', () => {
    renderControls('training-right');

    expect(screen.getByText(WAIT_HINT)).toBeTruthy();
    expect(screen.queryByText(KEEP_TIME_HINT)).toBeNull();
  });

  it('says playback keeps time, in Keep time', () => {
    renderControls('playalong-left');

    expect(screen.getByText(KEEP_TIME_HINT)).toBeTruthy();
    expect(screen.queryByText(WAIT_HINT)).toBeNull();
  });

  it('says nothing of practice while listening, or on a phone', () => {
    renderControls('simple');
    expect(screen.queryByText(WAIT_HINT)).toBeNull();
    expect(screen.queryByText(KEEP_TIME_HINT)).toBeNull();
    cleanup();

    mock.desktop = false;
    renderControls('playalong-both');
    expect(screen.queryByText(KEEP_TIME_HINT)).toBeNull();
  });
});
