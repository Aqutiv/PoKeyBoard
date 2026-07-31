import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: 'idle',
  allNotesOff: vi.fn(),
  handleInterruption: vi.fn(),
  scrubEnd: vi.fn(),
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: { allNotesOff: mocks.allNotesOff },
}));

vi.mock('@/features/notation/scrubController', () => ({
  scrubController: { isActive: false, end: mocks.scrubEnd },
}));

vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => mocks.state,
    handleInterruption: mocks.handleInterruption,
    subscribeState: () => () => undefined,
  },
}));

import { lifecycleService } from '@/app/lifecycle';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

describe('background playback lifecycle', () => {
  beforeAll(() => {
    lifecycleService.init();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  });

  beforeEach(() => {
    mocks.state = 'idle';
    mocks.allNotesOff.mockClear();
    mocks.handleInterruption.mockClear();
    mocks.scrubEnd.mockClear();
    lifecycleService.dismissMessage();
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });

  it('keeps recorded playback running when the option is enabled', () => {
    mocks.state = 'playing';
    useSettingsStore.getState().setBackgroundPlayback(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.handleInterruption).not.toHaveBeenCalled();
    expect(mocks.allNotesOff).not.toHaveBeenCalled();
  });

  it('retains the safe pause behavior by default', () => {
    mocks.state = 'playing';

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.handleInterruption).toHaveBeenCalledOnce();
    expect(mocks.allNotesOff).toHaveBeenCalledOnce();
  });

  it('always interrupts recording even when background playback is enabled', () => {
    mocks.state = 'recording';
    useSettingsStore.getState().setBackgroundPlayback(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.handleInterruption).toHaveBeenCalledOnce();
    expect(mocks.allNotesOff).toHaveBeenCalledOnce();
    expect(lifecycleService.getSnapshot().message).toBe('recordingInterrupted');
  });
});
