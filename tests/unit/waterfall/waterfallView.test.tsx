import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameSubscriberCount } from '@/app/frameClock';
import { themeController } from '@/app/theme';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';
import type { WaterfallScene } from '@/features/waterfall/waterfallLayout';
import type { WaterfallPaint } from '@/features/waterfall/waterfallPainter';
import { WATERFALL_PALETTES } from '@/features/waterfall/waterfallPalette';
import { WaterfallView, type KeyRange } from '@/features/waterfall/WaterfallView';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';

/** What each painted frame showed, one entry per frame. */
const h = vi.hoisted(() => ({
  painted: [] as Array<{ scene: WaterfallScene; paint: WaterfallPaint }>,
}));

vi.mock('@/features/waterfall/waterfallPainter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/waterfall/waterfallPainter')>()),
  paintWaterfall: (_ctx: unknown, scene: WaterfallScene, paint: WaterfallPaint) => {
    h.painted.push({ scene, paint });
  },
}));

/** Animation frames wait here until a test runs them. */
let frames: FrameRequestCallback[] = [];

function frame(): void {
  const due = frames;
  frames = [];
  for (const callback of due) callback(performance.now());
}

function lastPainted() {
  const last = h.painted[h.painted.length - 1];
  if (!last) throw new Error('nothing painted');
  return last;
}

// C4–B4 under a 700 × 300 view: 3000 ms over 300 px, 0.1 px a millisecond.
const RANGE: KeyRange = { lowMidi: 60, highMidi: 71 };
const NOTES: NoteEvent[] = [
  { id: 'a', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
  { id: 'b', midi: 64, startMs: 1000, durationMs: 400, velocity: 0.7 },
];

function show(range: KeyRange | null = RANGE) {
  const view = (keys: KeyRange | null) => (
    <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
      <WaterfallView range={keys} />
    </I18nContext.Provider>
  );
  const rendered = render(view(range));
  return { rerender: (keys: KeyRange | null) => rendered.rerender(view(keys)) };
}

describe('WaterfallView', () => {
  beforeEach(() => {
    h.painted = [];
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // jsdom lays nothing out, so the view is given a size to draw at.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 700,
      height: 300,
    } as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D);
    // As the app does at start, so the theme follows the settings.
    themeController.init();
    useSettingsStore.getState().resetSettings();
    useTakeStore.getState().setTake(createEmptyTake({ notes: NOTES, durationMs: 4000 }));
    transportController.seek(0);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws once and then sleeps while nothing moves', () => {
    show();
    frame();
    frame();
    expect(h.painted).toHaveLength(1);
    expect(frameSubscriberCount()).toBe(0);
    // The take's first notes, standing over their keys from the bottom up.
    expect(lastPainted().scene.bars.map((bar) => [bar.note.midi, bar.bottom])).toEqual([
      [60, 300],
      [64, 200],
    ]);
  });

  it('follows the key bed when it moves', () => {
    const { rerender } = show();
    frame();
    rerender({ lowMidi: 62, highMidi: 74 });
    frame();
    expect(h.painted).toHaveLength(2);
    // C4 is off the bed now, marked at its low edge.
    expect(lastPainted().scene.markers.map((marker) => marker.side)).toEqual(['low']);
  });

  it('draws the stage alone until the key bed reports where it is', () => {
    show(null);
    frame();
    expect(lastPainted().scene.bars).toEqual([]);
  });

  it('draws again on a seek, a loop, the theme and the shading switch', () => {
    show();
    frame();

    act(() => transportController.seek(500));
    frame();
    expect(lastPainted().scene.bars.find((bar) => bar.note.midi === 64)?.bottom).toBe(250);

    act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
    frame();
    // From 500 ms, the loop's end is 150 px up, and the next pass's 100 px above that.
    expect(lastPainted().scene.restartYs).toEqual([150, 50]);

    act(() => useSettingsStore.getState().setTheme('light'));
    frame();
    expect(lastPainted().paint.palette).toBe(WATERFALL_PALETTES.light);

    act(() => useSettingsStore.getState().setVelocityShading(false));
    frame();
    expect(lastPainted().paint.followsVelocity).toBe(false);
    expect(h.painted).toHaveLength(5);
  });

  it('stands where play would start: at a loop’s top, from a playhead parked past its end', () => {
    // D4 is held into the loop from before it, which play from its top never strikes.
    const held: NoteEvent = { id: 'held', midi: 62, startMs: 800, durationMs: 400, velocity: 0.7 };
    const notes = [NOTES[0] as NoteEvent, held, NOTES[1] as NoteEvent];
    act(() => useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 })));
    act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
    act(() => transportController.seek(2500));
    show();
    frame();
    const { scene } = lastPainted();
    // E4 starts the loop, on the keys; each pass after starts 100 px further up.
    expect(scene.bars.map((bar) => [bar.note.midi, bar.pass, bar.bottom])).toEqual([
      [64, 0, 300],
      [64, 1, 200],
      [64, 2, 100],
    ]);
    expect(scene.restartYs).toEqual([200, 100]);
  });

  describe('while the transport moves', () => {
    let state: TransportState = 'idle';
    const listeners = new Set<() => void>();

    function become(next: TransportState): void {
      state = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    }

    beforeEach(() => {
      state = 'idle';
      listeners.clear();
      vi.spyOn(transportController, 'getState').mockImplementation(() => state);
      vi.spyOn(transportController, 'subscribeState').mockImplementation((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      });
    });

    it('runs on the frame clock only while playing, and sleeps again after', () => {
      show();
      frame();
      become('playing');
      expect(frameSubscriberCount()).toBe(1);
      frame();
      frame();
      expect(h.painted.length).toBeGreaterThanOrEqual(3);
      become('paused');
      expect(frameSubscriberCount()).toBe(0);
    });

    it('leaves a note held into a loop out of the passes playback has come round to', () => {
      const held: NoteEvent = {
        id: 'held',
        midi: 62,
        startMs: 800,
        durationMs: 400,
        velocity: 0.7,
      };
      const notes = [NOTES[0] as NoteEvent, held, NOTES[1] as NoteEvent];
      act(() => useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 })));
      vi.spyOn(transportController.clock, 'loop', 'get').mockReturnValue({
        startMs: 1000,
        endMs: 2000,
      });
      vi.spyOn(transportController, 'getPlayheadMs').mockReturnValue(1050);
      // A run started at 500, before the loop.
      const passStart = vi.spyOn(transportController, 'getPassStartMs').mockReturnValue(500);
      const atKeys = () =>
        lastPainted()
          .scene.bars.filter((bar) => bar.pass === 0)
          .map((bar) => bar.note.midi);
      show();
      become('playing');
      frame();
      // On the way in, the run struck D4 before the loop's top, and it sounds on…
      expect(atKeys()).toEqual([62, 64]);
      passStart.mockReturnValue(1000);
      frame();
      // …but come round, the run plays from the top, and D4 is not struck again.
      expect(atKeys()).toEqual([64]);
      become('idle');
    });

    it('shows a scrub where it is, past a loop’s end too, and play’s start once let go', () => {
      const late: NoteEvent = {
        id: 'late',
        midi: 67,
        startMs: 3000,
        durationMs: 400,
        velocity: 0.7,
      };
      const notes = [...NOTES, late];
      act(() => useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 })));
      act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
      act(() => transportController.seek(2500));
      show();
      become('scrubbing');
      frame();
      // At 2500, straight on: G4 is half a second off, and no pass comes round.
      expect(lastPainted().scene.bars.map((bar) => [bar.note.midi, bar.bottom])).toEqual([
        [67, 250],
      ]);
      expect(lastPainted().scene.restartYs).toEqual([]);
      become('paused');
      frame();
      expect(lastPainted().scene.restartYs).toEqual([200, 100]);
    });

    it('falls the notes in toward a recording’s start while it counts in', () => {
      vi.spyOn(transportController.clock, 'currentTakeMs').mockReturnValue(-500);
      show();
      become('countIn');
      frame();
      // C4 starts at 0, half a second away: 50 px above the keys.
      expect(lastPainted().scene.bars.find((bar) => bar.note.midi === 60)?.bottom).toBe(250);
      become('idle');
    });
  });

  it('names the canvas by its notes, and says what to do when there are none', () => {
    show();
    expect(screen.getByRole('img', { name: 'Falling notes, 2 notes' })).toBeTruthy();
    act(() => useTakeStore.getState().setTake(createEmptyTake({ notes: [] })));
    expect(screen.getByText(en.play.fallingEmpty)).toBeTruthy();
  });
});
