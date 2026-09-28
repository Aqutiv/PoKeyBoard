import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { __resetForTests as resetRange } from '@/audio/playableRange';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { keyShade } from '@/features/keyboard/keyShading';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import type { TransportState } from '@/features/transport/transportMachine';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/** The transport as the key bed reads it: a state, a playhead, and who to tell. */
const transport = vi.hoisted(() => ({
  state: 'idle' as TransportState,
  playheadMs: 0,
  listeners: new Set<() => void>(),
}));

vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => transport.state,
    getPlayheadMs: () => transport.playheadMs,
    subscribeState: (listener: () => void) => {
      transport.listeners.add(listener);
      return () => transport.listeners.delete(listener);
    },
  },
}));

/** C4 alone from the start, then E4 with it from 500 ms, played harder. */
const NOTES: NoteEvent[] = [
  { id: 'c', midi: 60, startMs: 0, durationMs: 1_000, velocity: 0.6, staff: 'treble' },
  { id: 'e', midi: 64, startMs: 500, durationMs: 1_000, velocity: 0.9, staff: 'treble' },
];

/** Frames run by hand, so a test says exactly when the key bed redraws. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function runFrame(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(performance.now());
}

/** The keys the player holds, as the engine reports them, each by its velocity. */
let held: ReadonlyMap<number, number> = new Map();
let heldKeys: ReadonlySet<number> = new Set();
const heldListeners = new Set<(midis: ReadonlySet<number>) => void>();

/** Hold these keys, each a midi (struck at 0.75) or a midi and its velocity. */
function hold(...keys: Array<number | [number, number]>): void {
  held = new Map(keys.map((k) => (typeof k === 'number' ? [k, 0.75] : k)));
  heldKeys = new Set(held.keys());
  act(() => {
    for (const listener of [...heldListeners]) listener(heldKeys);
  });
}

/** How deep the take lights a key, and how deep the player's hold does. */
const takeShade = (element: HTMLElement) => element.style.getPropertyValue('--take-shade');
const liveShade = (element: HTMLElement) => element.style.getPropertyValue('--live-shade');

function setTransport(state: TransportState, playheadMs = transport.playheadMs): void {
  transport.state = state;
  transport.playheadMs = playheadMs;
  for (const listener of [...transport.listeners]) listener();
}

function renderKeyboard(): void {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <PianoKeyboard playbackCues />
    </I18nContext.Provider>,
  );
}

function key(note: string): HTMLElement {
  return screen.getByRole('button', { name: en.piano.keyLabel({ note }) });
}

beforeEach(() => {
  transport.state = 'idle';
  transport.playheadMs = 0;
  held = new Map();
  heldKeys = new Set();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(audioEngine, 'getActiveNotes').mockImplementation(() => heldKeys);
  vi.spyOn(audioEngine, 'getActiveVelocities').mockImplementation(() => held);
  vi.spyOn(audioEngine, 'subscribeActiveNotes').mockImplementation((listener) => {
    heldListeners.add(listener);
    return () => heldListeners.delete(listener);
  });
  vi.spyOn(audioEngine, 'ensurePlayableRange').mockResolvedValue(undefined);
  useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 2_000 }));
});

afterEach(() => {
  // No `globals: true`, so RTL's auto-cleanup is not registered.
  cleanup();
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRange();
});

describe('the keys the take plays, to a screen reader', () => {
  it('reads a key lit by playback as pressed, and as up once the take moves on', () => {
    setTransport('playing', 200);
    renderKeyboard();
    runFrame();

    expect(key('C4')).toHaveAttribute('data-playback', 'right');
    expect(key('C4')).toHaveAttribute('aria-pressed', 'true');
    expect(key('E4')).toHaveAttribute('aria-pressed', 'false');

    transport.playheadMs = 1_200;
    runFrame();
    expect(key('C4')).toHaveAttribute('aria-pressed', 'false');
    expect(key('E4')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a key pressed while either the player or the take still holds it', () => {
    setTransport('playing', 200);
    renderKeyboard();
    runFrame();

    // Let go while the take still plays it: the render that follows must not
    // put the key back up underneath the playback light.
    hold(60);
    expect(key('C4')).toHaveAttribute('aria-pressed', 'true');
    hold();
    expect(key('C4')).toHaveAttribute('aria-pressed', 'true');

    // And the other way round: the take moves on from a key the player holds.
    hold(60);
    transport.playheadMs = 1_200;
    runFrame();
    expect(key('C4')).not.toHaveAttribute('data-playback');
    expect(key('C4')).toHaveAttribute('aria-pressed', 'true');
    hold();
    expect(key('C4')).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets every key the take pressed back up when playback stops', () => {
    setTransport('playing', 600);
    renderKeyboard();
    runFrame();
    hold(64);
    expect(key('C4')).toHaveAttribute('aria-pressed', 'true');

    setTransport('paused');
    expect(frames.size).toBe(0);
    expect(key('C4')).toHaveAttribute('aria-pressed', 'false');
    // The stop lets go of the take's keys only: one the player holds stays down.
    expect(key('E4')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('how deep the keys are lit', () => {
  it('lights each key the take plays as deep as it is played, and clears it after', () => {
    setTransport('playing', 600);
    renderKeyboard();
    runFrame();
    expect(takeShade(key('C4'))).toBe(keyShade(0.6, true));
    expect(takeShade(key('E4'))).toBe(keyShade(0.9, true));
    expect(takeShade(key('C4'))).not.toBe(takeShade(key('E4')));

    transport.playheadMs = 1_200;
    runFrame();
    expect(takeShade(key('C4'))).toBe('');
    expect(takeShade(key('E4'))).toBe(keyShade(0.9, true));

    setTransport('paused');
    expect(takeShade(key('E4'))).toBe('');
  });

  it('lights them all alike while the shading is off, from the next frame on', () => {
    setTransport('playing', 600);
    renderKeyboard();
    act(() => useSettingsStore.getState().setVelocityShading(false));
    runFrame();
    expect(takeShade(key('C4'))).toBe(keyShade(0.6, false));
    expect(takeShade(key('E4'))).toBe(takeShade(key('C4')));

    act(() => useSettingsStore.getState().setVelocityShading(true));
    runFrame();
    expect(takeShade(key('E4'))).toBe(keyShade(0.9, true));
  });

  it('lights a key the player holds as deep as they struck it', () => {
    renderKeyboard();
    hold([60, 0.3], [64, 1]);
    expect(liveShade(key('C4'))).toBe(keyShade(0.3, true));
    expect(liveShade(key('E4'))).toBe(keyShade(1, true));

    act(() => useSettingsStore.getState().setVelocityShading(false));
    expect(liveShade(key('C4'))).toBe(keyShade(0.3, false));
    expect(liveShade(key('E4'))).toBe(liveShade(key('C4')));

    hold();
    expect(liveShade(key('C4'))).toBe('');
  });

  it('keeps the take’s shade on a key the player lets go of while the take still plays it', () => {
    setTransport('playing', 200);
    renderKeyboard();
    runFrame();
    hold([60, 0.95]);
    expect(liveShade(key('C4'))).toBe(keyShade(0.95, true));
    expect(takeShade(key('C4'))).toBe(keyShade(0.6, true));

    // The render that takes the player's shade away must leave the take's.
    hold();
    expect(liveShade(key('C4'))).toBe('');
    expect(takeShade(key('C4'))).toBe(keyShade(0.6, true));
  });
});

describe('the letter rows, parked by a lesson', () => {
  /**
   * A lesson keyboard parked on G4, as the G major steps park it — or, with a
   * null anchor, Play's, which parks nowhere.
   */
  function lesson(parkId?: string, anchorMidi: number | null = 67) {
    return (
      <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
        <PianoKeyboard
          {...(anchorMidi !== null ? { anchorMidi, onAnchorChange: () => {} } : {})}
          parkId={parkId}
        />
      </I18nContext.Provider>
    );
  }

  /** Tap a letter key and report the note the engine was asked for, if any. */
  function tap(code: string): number | undefined {
    const noteOn = vi.mocked(audioEngine.noteOn);
    noteOn.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    });
    return noteOn.mock.calls[0]?.[0];
  }

  beforeEach(() => {
    vi.spyOn(audioEngine, 'noteOn').mockImplementation(() => true);
    vi.spyOn(audioEngine, 'noteOff').mockImplementation(() => {});
  });

  it('reach a G scale’s top two notes after one X', () => {
    render(lesson('playG'));
    // Parked on G4, the rows still start from the C below it.
    expect(tap('KeyT')).toBe(66);
    tap('KeyX');
    expect(tap('KeyT')).toBe(78);
    expect(tap('KeyG')).toBe(79);
  });

  it('start the next step where it is written, though it shares the anchor', () => {
    const { rerender } = render(lesson('gFingering'));
    tap('KeyX');
    expect(tap('KeyT')).toBe(78);
    rerender(lesson('playG'));
    expect(tap('KeyT')).toBe(66);
  });

  it('keep an octave moved within a step for as long as the step lasts', () => {
    const { rerender } = render(lesson('playG'));
    tap('KeyX');
    rerender(lesson('playG'));
    expect(tap('KeyT')).toBe(78);
  });

  it('leave Play’s octave alone, which no lesson parks', () => {
    const { rerender } = render(lesson('a', null));
    tap('KeyX');
    rerender(lesson('b', null));
    // Play's base starts at C4; X moved it to C5, and nothing moves it back.
    expect(tap('KeyT')).toBe(78);
  });
});
