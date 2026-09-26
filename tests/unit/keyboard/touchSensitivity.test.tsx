import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { __resetForTests as resetRange } from '@/audio/playableRange';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import { touchVelocity, type TouchSensitivity } from '@/features/keyboard/velocityResponse';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => 'idle',
    getPlayheadMs: () => 0,
    subscribeState: () => () => {},
  },
}));

/** Pixels per white key and down the bed, as the stubbed layout box reports them. */
const WHITE_PX = 50;
const BED_PX = 200;

function renderKeyboard() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <PianoKeyboard />
    </I18nContext.Provider>,
  );
  const bed = document.querySelector<HTMLElement>('.piano__keys')!;
  const whites = [...bed.querySelectorAll('.piano-key--white')];
  vi.spyOn(bed, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: whites.length * WHITE_PX, height: BED_PX }),
  );
  return { bed, whites };
}

/** A touch on middle C, `yFraction` of the way down the bed — below the black keys. */
function touchMiddleC(yFraction: number) {
  const { bed, whites } = renderKeyboard();
  const c4 = screen.getByRole('button', { name: en.piano.keyLabel({ note: 'C4' }) });
  const index = whites.indexOf(c4);
  fireEvent.pointerDown(bed, {
    pointerId: 1,
    clientX: (index + 0.5) * WHITE_PX,
    clientY: yFraction * BED_PX,
  });
}

beforeEach(() => {
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  // jsdom has no pointer capture; the key bed only asks for it.
  HTMLElement.prototype.setPointerCapture = () => {};
  vi.spyOn(audioEngine, 'ensurePlayableRange').mockResolvedValue(undefined);
});

afterEach(() => {
  // No `globals: true`, so RTL's auto-cleanup is not registered.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRange();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

describe('touch sensitivity on the key bed', () => {
  it.each<TouchSensitivity>(['light', 'normal', 'firm'])(
    'plays a touch at the %s curve',
    (sensitivity) => {
      useSettingsStore.setState({ touchSensitivity: sensitivity });
      const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(true);

      touchMiddleC(0.8);

      expect(noteOn).toHaveBeenCalledWith(60, touchVelocity(0.8, sensitivity), 'pointer:1');
    },
  );

  it('plays every touch at the fixed velocity in fixed mode, whatever the sensitivity', () => {
    useSettingsStore.setState({
      velocityMode: 'fixed',
      fixedVelocity: 0.6,
      touchSensitivity: 'light',
    });
    const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(true);

    touchMiddleC(0.8);

    expect(noteOn).toHaveBeenCalledWith(60, 0.6, 'pointer:1');
  });
});
