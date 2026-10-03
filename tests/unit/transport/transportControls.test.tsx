import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackMode } from '@/features/transport/modes';
import { TransportControls } from '@/features/transport/TransportControls';
import type { TransportState } from '@/features/transport/transportMachine';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

const mock = vi.hoisted(() => ({
  desktop: true,
  state: 'idle' as TransportState,
  countingIn: false,
}));

vi.mock('@/app/hooks/useMediaQuery', () => ({ useMediaQuery: () => mock.desktop }));
vi.mock('@/app/hooks/useTransport', () => ({
  useTransportState: () => mock.state,
  useTrainingWaiting: () => false,
  useCountingIn: () => mock.countingIn,
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

beforeEach(() => {
  mock.desktop = true;
  mock.state = 'idle';
  mock.countingIn = false;
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});
afterEach(cleanup);

describe('the practice hint under the transport', () => {
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

describe('the count-in under the transport', () => {
  it('says Count-in… while a Keep-time run counts in, in place of its hint', () => {
    mock.state = 'playing';
    mock.countingIn = true;
    renderControls('playalong-left');

    expect(screen.getByRole('status')).toHaveTextContent('Count-in…');
    expect(screen.queryByText(KEEP_TIME_HINT)).toBeNull();
  });

  it('says it on a phone too, where no hint shows', () => {
    mock.desktop = false;
    mock.state = 'playing';
    mock.countingIn = true;
    renderControls('playalong-left');

    expect(screen.getByRole('status')).toHaveTextContent('Count-in…');
  });

  it('goes back to the hint once the run sets off', () => {
    mock.state = 'playing';
    renderControls('playalong-left');

    expect(screen.queryByText('Count-in…')).toBeNull();
    expect(screen.getByText(KEEP_TIME_HINT)).toBeTruthy();
  });
});
