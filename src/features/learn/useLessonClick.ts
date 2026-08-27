import { useCallback, useEffect, useMemo, useRef } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import type { ClickGrid } from '@/audio/MetronomeEngine';
import type { TimeSignature } from '@/domain/takeTypes';
import {
  attachLessonMetronome,
  lessonGrid,
  lessonMetronome,
  nextBarAudioTimeOn,
} from './lessonClick';

/** Enough lead for the scheduler to place the first click cleanly. */
const LEAD_S = 0.15;

export interface LessonClick {
  /**
   * Where an audio-clock time falls in the click, as fractional grid beats;
   * `null` while silent.
   *
   * Ref-backed so its identity never changes. `useExercise` re-subscribes on
   * its dependencies alone, and an unstable converter in that closure would
   * tear down and rebuild the input subscription on every render.
   */
  beatsAt: (audioTimeSeconds: number) => number | null;
  /**
   * Wall-clock ms of the click's first beat, or `null` while silent.
   *
   * `performance.now()`-based rather than audio-clock, because a test outside
   * the app has no handle on its `AudioContext`. Read through a getter rather
   * than held in state: it is a fact about the running click, so mirroring it
   * into React would mean a setState inside the effect that starts one.
   */
  originMs: () => number | null;
  /**
   * Audio-clock time of the first bar line at or after `afterAudioTime`, or
   * `null` while silent.
   *
   * What a Listen demo starts on, so a worked rhythm is heard landing on the
   * clicks rather than drifting against them.
   */
  nextBarAudioTime: (afterAudioTime: number) => number | null;
}

/**
 * Run the lesson click while `active`, and report where its beats fall.
 *
 * Step changes need no handling of their own: `active` flips, the effect's
 * cleanup stops the click, and the next one starts a fresh grid. Unmount runs
 * the same cleanup, and no transport path can reach this engine.
 */
export function useLessonClick(
  active: boolean,
  bpm: number,
  timeSignature: TimeSignature,
): LessonClick {
  const gridRef = useRef<ClickGrid | null>(null);
  const originRef = useRef<number | null>(null);
  const { numerator, denominator } = timeSignature;

  useEffect(() => {
    if (!active) return;
    const context = audioEngine.getAudioContext();
    // The runner gates a rhythm step on `pianoReady`, so decoding has already
    // built a context by now — but never assume it.
    if (!context) return;

    attachLessonMetronome(context);

    const grid = lessonGrid(bpm, { numerator, denominator }, context.currentTime + LEAD_S);
    gridRef.current = grid;
    lessonMetronome.start(grid);
    originRef.current = performance.now() + (grid.audioTimeAt(0) - audioEngine.currentTime) * 1000;

    // Nothing else stops a Learn click when the page hides: `handleInterruption`
    // is a no-op from an idle transport, and the engine's 25ms lookahead is
    // throttled to about a second in a hidden tab — eight times its scheduling
    // horizon, so the click would come back ragged rather than steady.
    //
    // The *same* grid is restarted on return, never a fresh one. `start` seeks
    // to the next beat by itself, and rebuilding would move beat 0 out from
    // under an attempt whose origin is stated in it.
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') lessonMetronome.stop();
      else if (gridRef.current) lessonMetronome.start(gridRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      lessonMetronome.stop();
      gridRef.current = null;
      originRef.current = null;
    };
  }, [active, bpm, numerator, denominator]);

  const beatsAt = useCallback((audioTimeSeconds: number) => {
    const grid = gridRef.current;
    return grid ? grid.indexAt(audioTimeSeconds) : null;
  }, []);

  const originMs = useCallback(() => originRef.current, []);

  const nextBarAudioTime = useCallback((afterAudioTime: number) => {
    const grid = gridRef.current;
    return grid ? nextBarAudioTimeOn(grid, afterAudioTime) : null;
  }, []);

  // Every member is ref-backed and stable, so the object may as well be too:
  // `onListen` closes over it, and a fresh identity each render would rebuild
  // that callback for nothing.
  return useMemo(
    () => ({ beatsAt, originMs, nextBarAudioTime }),
    [beatsAt, originMs, nextBarAudioTime],
  );
}
