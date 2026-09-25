import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { __resetForTests as resetRange } from '@/audio/playableRange';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import type { TransportState } from '@/features/transport/transportMachine';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
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

/** C4 alone from the start, then E4 with it from 500 ms. */
const NOTES: NoteEvent[] = [
  { id: 'c', midi: 60, startMs: 0, durationMs: 1_000, velocity: 0.6, staff: 'treble' },
  { id: 'e', midi: 64, startMs: 500, durationMs: 1_000, velocity: 0.6, staff: 'treble' },
];

/** Frames run by hand, so a test says exactly when the key bed redraws. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function runFrame(): void {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(performance.now());
}

/** The keys the player holds, as the engine reports them. */
let held: ReadonlySet<number> = new Set();
const heldListeners = new Set<(midis: ReadonlySet<number>) => void>();

function hold(...midis: number[]): void {
  held = new Set(midis);
  act(() => {
    for (const listener of [...heldListeners]) listener(held);
  });
}

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
  held = new Set();
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
  vi.spyOn(audioEngine, 'getActiveNotes').mockImplementation(() => held);
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
