import { audioEngine } from '@/audio/AudioEngine';
import { constantClickGrid, MetronomeEngine, type ClickGrid } from '@/audio/MetronomeEngine';
import type { TimeSignature } from '@/domain/takeTypes';
import { useSettingsStore } from '@/state/useSettingsStore';
import { beatDurationMs } from '@/utils/timing';

/**
 * The click a rhythm lesson is judged against.
 *
 * Steady by construction, and starting on a downbeat: `constantClickGrid`
 * accents `index % numerator === 0`, so bar lines are exactly the whole
 * multiples of the numerator. The rhythm matcher's bar arithmetic depends on
 * that, which is why a lesson builds its own grid rather than borrowing one
 * derived from a take's tempo map.
 */
export function lessonGrid(
  bpm: number,
  timeSignature: TimeSignature,
  startAudioTime: number,
): ClickGrid {
  return constantClickGrid(
    startAudioTime,
    beatDurationMs(bpm, timeSignature),
    timeSignature.numerator,
  );
}

/**
 * Learn's own metronome, deliberately not `transportController.metronome`.
 *
 * Sharing that one would mean sharing its hazards. `pauseInternal`, `stop`,
 * `finalizeRecording`, `stopEverything` and `setMetronomeOn(false)` all stop it
 * unconditionally — but the sharper problem is the case the runner's
 * stop-a-busy-transport guard does not cover: a Play metronome left switched on
 * while the transport sits idle is *already running* when a chapter opens, so
 * starting a lesson grid on it would hijack the click behind the toggle's back
 * and the lesson's cleanup would then silence it.
 *
 * A module singleton rather than one per mount, because `MetronomeEngine` has
 * no `dispose()`: `attach` creates a `GainNode` and connects it, and nothing
 * ever disconnects one. A per-mount engine would leak a node per chapter
 * opened, while `attach`'s own `if (this.context === context) return` makes
 * reusing this one free.
 */
export const lessonMetronome = new MetronomeEngine();

/**
 * Point the lesson metronome at the live audio graph and set its level.
 *
 * The user's `metronomeVolume` is honoured as it stands, including zero.
 * Overriding a volume someone deliberately set is worse than a lesson that
 * needs it turned back up — see the note in `learning-chapters.md`.
 */
export function nextBarAudioTimeOn(grid: ClickGrid, afterAudioTime: number): number {
  const bars = Math.ceil(grid.indexAt(afterAudioTime) / grid.numerator);
  return grid.audioTimeAt(Math.max(0, bars) * grid.numerator);
}

export function attachLessonMetronome(context: AudioContext): void {
  lessonMetronome.attach(context, audioEngine.getOutputDestination() ?? undefined);
  lessonMetronome.configure({ volume: useSettingsStore.getState().metronomeVolume });
}
