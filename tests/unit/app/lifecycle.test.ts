import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: 'idle',
  metronomeOn: false,
  allNotesOff: vi.fn(),
  sleepAfter: vi.fn(),
  wake: vi.fn(),
  handleInterruption: vi.fn(),
  scrubEnd: vi.fn(),
}));

vi.mock('@/audio/AudioEngine', () => ({
  audioEngine: {
    allNotesOff: mocks.allNotesOff,
    sleepAfter: mocks.sleepAfter,
    wake: mocks.wake,
    getReverbRoom: () => 'cathedral',
  },
}));

vi.mock('@/features/notation/scrubController', () => ({
  scrubController: { isActive: false, end: mocks.scrubEnd },
}));

vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => mocks.state,
    isMetronomeOn: () => mocks.metronomeOn,
    handleInterruption: mocks.handleInterruption,
    subscribeState: () => () => undefined,
  },
}));

import { lifecycleService } from '@/app/lifecycle';
import { roomTailSeconds } from '@/audio/reverbImpulse';
import { ALL_NOTES_OFF_S } from '@/audio/VoiceManager';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
}

describe('background playback lifecycle', () => {
  beforeAll(() => {
    lifecycleService.init();
  });

  beforeEach(() => {
    setVisibility('hidden');
    mocks.state = 'idle';
    mocks.metronomeOn = false;
    mocks.allNotesOff.mockClear();
    mocks.sleepAfter.mockClear();
    mocks.wake.mockClear();
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

  it('keeps the audio awake while playback carries on in the background', () => {
    mocks.state = 'playing';
    useSettingsStore.getState().setBackgroundPlayback(true);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.sleepAfter).not.toHaveBeenCalled();
  });
});

describe('the audio device at rest', () => {
  beforeEach(() => {
    setVisibility('hidden');
    mocks.state = 'idle';
    mocks.metronomeOn = false;
    mocks.sleepAfter.mockClear();
    mocks.wake.mockClear();
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });

  it('sleeps once the last release and the room have died away', () => {
    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.sleepAfter).toHaveBeenCalledOnce();
    const [seconds, stillWanted] = mocks.sleepAfter.mock.calls[0] as [number, () => boolean];
    expect(seconds).toBeCloseTo(ALL_NOTES_OFF_S + roomTailSeconds('cathedral'));
    expect(stillWanted()).toBe(true);
  });

  it('does not sleep if the page is back, the transport busy, or a click running', () => {
    document.dispatchEvent(new Event('visibilitychange'));
    const stillWanted = mocks.sleepAfter.mock.calls[0]![1] as () => boolean;

    setVisibility('visible');
    expect(stillWanted()).toBe(false);
    setVisibility('hidden');
    mocks.state = 'renderingAudio';
    expect(stillWanted()).toBe(false);
    mocks.state = 'idle';
    mocks.metronomeOn = true;
    expect(stillWanted()).toBe(false);
  });

  it('wakes, silently, as the page comes back', () => {
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.wake).toHaveBeenCalledOnce();
    expect(mocks.sleepAfter).not.toHaveBeenCalled();
  });
});
