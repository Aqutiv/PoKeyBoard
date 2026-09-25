import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { MusicScore } from '@/features/notation/MusicScore';
import { transportController } from '@/features/transport/transportController';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';

/** The loop shaded by each frame the score drew, one entry per drawn frame. */
const h = vi.hoisted(() => ({ drawnLoops: [] as unknown[] }));

vi.mock('@/features/notation/scoreRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/notation/scoreRenderer')>()),
  drawScore: (_ctx: unknown, _view: unknown, input: { loop?: unknown }) => {
    h.drawnLoops.push(input.loop ?? null);
  },
}));

/** Animation frames wait here until a test runs them. */
let frames: FrameRequestCallback[] = [];

function frame(): void {
  const due = frames;
  frames = [];
  for (const callback of due) callback(performance.now());
}

describe('MusicScore', () => {
  beforeEach(() => {
    h.drawnLoops = [];
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
    // jsdom lays nothing out, so the score is given a size to draw at.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D);
    const notes: NoteEvent[] = [{ id: 'a', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 }];
    useTakeStore.getState().setTake(createEmptyTake({ notes, durationMs: 4000 }));
    transportController.seek(0);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a loop set or cleared while stopped on the very next frame', () => {
    render(
      <I18nContext.Provider value={{ language: 'en', locale: 'en', m: en }}>
        <MusicScore />
      </I18nContext.Provider>,
    );
    frame();
    frame(); // nothing has changed, so nothing is drawn again
    expect(h.drawnLoops).toEqual([null]);

    act(() => transportController.setLoop({ startMs: 1000, endMs: 2000 }));
    frame();
    expect(h.drawnLoops).toEqual([null, { startMs: 1000, endMs: 2000 }]);

    act(() => transportController.setLoop(null));
    frame();
    expect(h.drawnLoops).toEqual([null, { startMs: 1000, endMs: 2000 }, null]);
  });
});
