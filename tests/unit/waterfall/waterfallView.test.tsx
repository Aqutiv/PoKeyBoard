import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameSubscriberCount } from '@/app/frameClock';
import { themeController } from '@/app/theme';
import { noteFingers } from '@/domain/fingering';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { scrubController } from '@/features/notation/scrubController';
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

  it('outlines a note held across where play would start, which it never strikes', () => {
    act(() => transportController.seek(200));
    show();
    frame();
    expect(lastPainted().scene.bars.map((bar) => [bar.note.midi, bar.silent])).toEqual([
      [60, true],
      [64, false],
    ]);
  });

  it('stands where play would start: at a loop’s top, from a playhead parked past its end', () => {
    // D4 is held into the loop from before it, which play from its top never
    // strikes: an outline on every pass.
    const held: NoteEvent = { id: 'held', midi: 62, startMs: 800, durationMs: 400, velocity: 0.7 };
    const notes = [NOTES[0] as NoteEvent, held, NOTES[1] as NoteEvent];
    act(() => useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 })));
    act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
    act(() => transportController.seek(2500));
    show();
    frame();
    const { scene } = lastPainted();
    // E4 starts the loop, on the keys; each pass after starts 100 px further up.
    expect(scene.bars.map((bar) => [bar.note.midi, bar.pass, bar.bottom, bar.silent])).toEqual([
      [62, 0, 300, true],
      [64, 0, 300, false],
      [62, 1, 200, true],
      [64, 1, 200, false],
      [62, 2, 100, true],
      [64, 2, 100, false],
    ]);
    expect(scene.restartYs).toEqual([200, 100]);
  });

  it('writes the notes’ names, spelled as the score spells them, only while names show', () => {
    show();
    frame();
    const names = () => lastPainted().paint.names;
    expect(names()?.get('a')).toBe('C');
    expect(names()?.get('b')).toBe('E');
    act(() => useSettingsStore.getState().setShowNoteLabels(false));
    frame();
    expect(names()).toBeUndefined();
  });

  it('numbers the notes’ fingers, the score’s own or worked out, only while numbers show', () => {
    show();
    frame();
    const fingers = () => lastPainted().paint.fingers;
    // Off until switched on.
    expect(fingers()).toBeUndefined();
    act(() => useSettingsStore.getState().setShowFingerNumbers(true));
    frame();
    expect(fingers()).toBe(noteFingers(useTakeStore.getState().take.notes));
    expect(fingers()?.get('a')).toBe(1);
    // A finger the score prints is the one shown.
    act(() =>
      useTakeStore
        .getState()
        .setTake(
          createEmptyTake({ notes: NOTES.map((n) => ({ ...n, finger: 4 })), durationMs: 4000 }),
        ),
    );
    frame();
    expect(fingers()?.get('a')).toBe(4);
    act(() => useSettingsStore.getState().setShowFingerNumbers(false));
    frame();
    expect(fingers()).toBeUndefined();
  });

  it('lines the bars where the take’s tempo puts them', () => {
    // 120 bpm in 4/4: a bar every two seconds, at the keys and 200 px up.
    show();
    frame();
    expect(lastPainted().scene.barYs).toEqual([300, 100]);
    act(() => useTakeStore.getState().setTempo({ ...useTakeStore.getState().take.tempo, bpm: 60 }));
    frame();
    // At 60 bpm, the second bar is four seconds on, past the top.
    expect(lastPainted().scene.barYs).toEqual([300]);
  });

  it('falls in the time the fall speed sets', () => {
    show();
    frame();
    const e4 = () => lastPainted().scene.bars.find((bar) => bar.note.midi === 64)?.bottom;
    expect(e4()).toBeCloseTo(200);
    act(() => useSettingsStore.getState().setWaterfallSeconds(1.5));
    frame();
    // 300 px for a second and a half: E4, a second off, is two thirds of the way down.
    expect(e4()).toBeCloseTo(100);
  });

  it('steps the fall speed with − and +, each stopping at its end', () => {
    show();
    const slower = screen.getByRole('button', { name: en.play.fallSlower });
    const faster = screen.getByRole('button', { name: en.play.fallFaster });
    fireEvent.click(faster);
    expect(useSettingsStore.getState().waterfallSeconds).toBe(2.5);
    fireEvent.click(slower);
    fireEvent.click(slower);
    expect(useSettingsStore.getState().waterfallSeconds).toBe(4);
    act(() => useSettingsStore.getState().setWaterfallSeconds(1));
    expect(faster).toHaveProperty('disabled', true);
    expect(slower).toHaveProperty('disabled', false);
    act(() => useSettingsStore.getState().setWaterfallSeconds(8));
    expect(slower).toHaveProperty('disabled', true);
  });

  it('steps the fall speed with Ctrl/⌘ + wheel, a notch or a pinch’s slivers at a time', () => {
    show();
    const canvas = screen.getByRole('img');
    const wheel = (init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { cancelable: true, ...init });
      act(() => {
        canvas.dispatchEvent(event);
      });
      return event;
    };
    const seconds = () => useSettingsStore.getState().waterfallSeconds;
    // A plain wheel is the page's to scroll.
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false);
    expect(seconds()).toBe(3);
    // A notch in: the notes fall faster, in taller bars, as the score zooms in.
    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(seconds()).toBe(2.5);
    // A pinch out sends slivers, which step only once they add up to one.
    wheel({ deltaY: 40, metaKey: true });
    wheel({ deltaY: 40, metaKey: true });
    expect(seconds()).toBe(2.5);
    wheel({ deltaY: 40, metaKey: true });
    expect(seconds()).toBe(3);
  });

  it('steps the fall speed with Safari’s trackpad pinch, from where the pinch began', () => {
    show();
    const canvas = screen.getByRole('img');
    const gesture = (type: string, scale = 1) => {
      const event = Object.assign(new Event(type, { cancelable: true }), { scale });
      act(() => {
        canvas.dispatchEvent(event);
      });
      return event;
    };
    const seconds = () => useSettingsStore.getState().waterfallSeconds;
    // Every gesture is the view's, so the page never zooms instead.
    expect(gesture('gesturestart').defaultPrevented).toBe(true);
    // Spread to 1.6 times: two steps of 1.25 in, two quicker falls.
    expect(gesture('gesturechange', 1.6).defaultPrevented).toBe(true);
    expect(seconds()).toBe(2);
    // Closed to half, from where the pinch began: three steps out.
    gesture('gesturechange', 0.5);
    expect(seconds()).toBe(6);
    expect(gesture('gestureend', 0.5).defaultPrevented).toBe(true);
  });

  describe('dragged', () => {
    beforeEach(() => {
      // jsdom has no pointer capture; the view only asks for it.
      HTMLElement.prototype.setPointerCapture = () => {};
      useSettingsStore.getState().setScrubAudition(false);
    });

    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    });

    const press = (canvas: HTMLElement, init: PointerEventInit = {}) =>
      fireEvent.pointerDown(canvas, { pointerId: 1, isPrimary: true, clientY: 100, ...init });

    it('scrubs, the notes following the finger: down brings the music on', () => {
      const update = vi.spyOn(scrubController, 'update');
      show();
      const canvas = screen.getByRole('img');
      press(canvas);
      expect(transportController.getState()).toBe('scrubbing');
      fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 160 });
      // 60 px of a 300 px view that shows three seconds: 600 ms on.
      expect(update).toHaveBeenLastCalledWith(600);
      fireEvent.pointerUp(canvas, { pointerId: 1, clientY: 160 });
      expect(transportController.getState()).toBe('idle');
      expect(transportController.getPlayheadMs()).toBe(600);
    });

    it('starts from a loop’s top when the playhead is parked past its end, as the view shows', () => {
      act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
      act(() => transportController.seek(2500));
      const update = vi.spyOn(scrubController, 'update');
      show();
      const canvas = screen.getByRole('img');
      press(canvas);
      expect(transportController.getPlayheadMs()).toBe(1000);
      fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 130 });
      expect(update).toHaveBeenLastCalledWith(1300);
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    });

    it('goes round a loop past its end, as the view draws it, outlining the note held into it', () => {
      const held: NoteEvent = {
        id: 'held',
        midi: 62,
        startMs: 800,
        durationMs: 400,
        velocity: 0.7,
      };
      const notes = [NOTES[0] as NoteEvent, held, NOTES[1] as NoteEvent];
      act(() => useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 })));
      act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
      act(() => transportController.seek(1500));
      show();
      const canvas = screen.getByRole('img');
      press(canvas);
      // 60 px down is 600 ms on: past the loop's end at 2000, and round to 1100.
      fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 160 });
      expect(transportController.getPlayheadMs()).toBe(1100);
      frame();
      // Come round, the scrub has crossed E4 at the top, but not D4, held into the loop.
      const atKeys = lastPainted()
        .scene.bars.filter((bar) => bar.pass === 0)
        .map((bar) => [bar.note.midi, bar.silent]);
      expect(atKeys).toEqual([
        [62, true],
        [64, false],
      ]);
      fireEvent.pointerUp(canvas, { pointerId: 1 });
      expect(transportController.getPlayheadMs()).toBe(1100);
    });

    it('takes over a scrub left running elsewhere, going round its own loop', () => {
      act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
      act(() => transportController.seek(1500));
      // The score's fling, still coasting as the view switched: a straight scrub.
      act(() => {
        scrubController.begin();
      });
      show();
      const canvas = screen.getByRole('img');
      press(canvas);
      fireEvent.pointerMove(canvas, { pointerId: 1, clientY: 160 });
      // 600 ms on from 1500 comes round the loop to 1100.
      expect(transportController.getPlayheadMs()).toBe(1100);
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    });

    it('only stops Safari’s gestures for fingers on a touch screen', () => {
      show();
      const canvas = screen.getByRole('img');
      const gesture = (type: string, scale = 1) => {
        const event = Object.assign(new Event(type, { cancelable: true }), { scale });
        act(() => {
          canvas.dispatchEvent(event);
        });
        return event;
      };
      fireEvent.pointerDown(canvas, {
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientY: 100,
      });
      gesture('gesturestart');
      expect(gesture('gesturechange', 2).defaultPrevented).toBe(true);
      expect(useSettingsStore.getState().waterfallSeconds).toBe(3);
      gesture('gestureend', 2);
      fireEvent.pointerUp(canvas, { pointerId: 7, pointerType: 'touch' });
    });

    const finger = (canvas: HTMLElement, pointerId: number, clientY: number) =>
      fireEvent.pointerDown(canvas, {
        pointerId,
        pointerType: 'touch',
        isPrimary: pointerId === 1,
        clientX: 100,
        clientY,
      });
    const slide = (canvas: HTMLElement, pointerId: number, clientY: number) =>
      fireEvent.pointerMove(canvas, { pointerId, pointerType: 'touch', clientX: 100, clientY });
    const lift = (canvas: HTMLElement, pointerId: number) =>
      fireEvent.pointerUp(canvas, { pointerId, pointerType: 'touch' });

    it('turns a drag into a pinch when a second finger lands, stepping the fall speed', () => {
      const update = vi.spyOn(scrubController, 'update');
      show();
      const canvas = screen.getByRole('img');
      const seconds = () => useSettingsStore.getState().waterfallSeconds;
      finger(canvas, 1, 100);
      slide(canvas, 1, 160);
      expect(transportController.getPlayheadMs()).toBe(600);
      // A second finger, 100 px below the first: the drag is undone, unheard.
      finger(canvas, 2, 260);
      expect(transportController.getState()).toBe('idle');
      expect(transportController.getPlayheadMs()).toBe(0);
      update.mockClear();
      // Spread to 1.6 times: two steps of 1.25 in, two quicker falls…
      slide(canvas, 2, 320);
      expect(seconds()).toBe(2);
      // …and closed to half, from where the pinch began: three steps out.
      slide(canvas, 2, 210);
      expect(seconds()).toBe(6);
      // Either finger moves the pinch: the first up to 100 px apart again.
      slide(canvas, 1, 110);
      expect(seconds()).toBe(3);
      // Neither scrubs while they pinch, nor the one left after.
      lift(canvas, 2);
      slide(canvas, 1, 200);
      expect(update).not.toHaveBeenCalled();
      expect(seconds()).toBe(3);
      lift(canvas, 1);
      expect(transportController.getState()).toBe('idle');
      expect(transportController.getPlayheadMs()).toBe(0);
    });

    it('puts a playhead parked past a loop’s end back where it was when a drag turns into a pinch', () => {
      act(() => useTakeStore.getState().setPlaybackLoop({ startMs: 1000, endMs: 2000 }));
      act(() => transportController.seek(2500));
      show();
      const canvas = screen.getByRole('img');
      // The drag starts from the loop's top, as the view shows it…
      finger(canvas, 1, 100);
      expect(transportController.getPlayheadMs()).toBe(1000);
      slide(canvas, 1, 130);
      // …but a pinch only changes the fall: the playhead is left where it was parked.
      finger(canvas, 2, 230);
      expect(transportController.getState()).toBe('idle');
      expect(transportController.getPlayheadMs()).toBe(2500);
      lift(canvas, 2);
      lift(canvas, 1);
    });

    it('pinches during playback too, where there is no drag to undo', () => {
      show();
      const canvas = screen.getByRole('img');
      vi.spyOn(transportController, 'getState').mockReturnValue('playing');
      finger(canvas, 1, 100);
      finger(canvas, 2, 200);
      slide(canvas, 2, 300);
      // Spread to twice: three steps in, from three seconds to one and a half.
      expect(useSettingsStore.getState().waterfallSeconds).toBe(1.5);
      lift(canvas, 1);
      lift(canvas, 2);
    });

    it('answers only the main button of the main pointer, and never a running take', () => {
      const begin = vi.spyOn(scrubController, 'begin');
      show();
      const canvas = screen.getByRole('img');
      press(canvas, { button: 2 });
      press(canvas, { pointerId: 2, isPrimary: false });
      vi.spyOn(transportController, 'getState').mockReturnValue('playing');
      press(canvas);
      expect(begin).not.toHaveBeenCalled();
    });

    it('lets the scrub go if the view goes away mid-drag', () => {
      show();
      press(screen.getByRole('img'));
      expect(transportController.getState()).toBe('scrubbing');
      cleanup();
      expect(transportController.getState()).toBe('idle');
    });
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

    it('outlines a note held into a loop once playback has come round', () => {
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
          .map((bar) => [bar.note.midi, bar.silent]);
      show();
      become('playing');
      frame();
      // On the way in, the run struck D4 before the loop's top, and it sounds on…
      expect(atKeys()).toEqual([
        [62, false],
        [64, false],
      ]);
      passStart.mockReturnValue(1000);
      frame();
      // …but come round, the run plays from the top, and D4 is not struck again.
      expect(atKeys()).toEqual([
        [62, true],
        [64, false],
      ]);
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

    describe('at a Training hold', () => {
      beforeEach(() => {
        // Parked on E4, which the hold waits for.
        vi.spyOn(transportController, 'isWaitingForTraining').mockReturnValue(true);
        vi.spyOn(transportController, 'getTrainingTargets').mockReturnValue(new Set([64]));
        vi.spyOn(transportController, 'getPassStartMs').mockReturnValue(1000);
      });

      it('lights the note waited for, swelling and ebbing on the frame clock', () => {
        show();
        become('paused');
        expect(frameSubscriberCount()).toBe(1);
        frame();
        const { scene, paint } = lastPainted();
        expect(scene.bars.filter((bar) => bar.awaited).map((bar) => bar.note.midi)).toEqual([64]);
        expect(paint.glow).toBeGreaterThanOrEqual(0.1);
        expect(paint.glow).toBeLessThanOrEqual(1);
        become('idle');
      });

      it('holds the glow still, with no frames, for a reader who asked for less motion', () => {
        vi.stubGlobal('matchMedia', (query: string) => ({
          matches: query.includes('reduced-motion'),
          addEventListener: () => {},
          removeEventListener: () => {},
        }));
        show();
        become('paused');
        expect(frameSubscriberCount()).toBe(0);
        frame();
        expect(lastPainted().paint.glow).toBe(1);
      });

      it('stills the glow or sets it going as the reader asks for less motion or no longer', () => {
        const listeners = new Set<() => void>();
        const media = {
          matches: false,
          addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        };
        vi.stubGlobal('matchMedia', () => media);
        const askForLessMotion = (less: boolean) => {
          media.matches = less;
          act(() => {
            for (const listener of [...listeners]) listener();
          });
        };
        show();
        become('paused');
        expect(frameSubscriberCount()).toBe(1);
        askForLessMotion(true);
        expect(frameSubscriberCount()).toBe(0);
        frame();
        expect(lastPainted().paint.glow).toBe(1);
        askForLessMotion(false);
        expect(frameSubscriberCount()).toBe(1);
        // And the view stops listening when it goes.
        cleanup();
        expect(listeners.size).toBe(0);
        become('idle');
      });
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
