import { audioEngine } from '@/audio/AudioEngine';
import { sortNotes } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { effectivePlaybackDurationMs } from '@/features/transport/sustainPedal';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { clamp } from '@/utils/timing';
import { getCrossedNoteOnsets } from './scrubMath';

/** Pointer jitter below this many take-ms never triggers auditions. */
const HYSTERESIS_MS = 3;
/** A single movement auditions at most this many notes (large jumps). */
const MAX_PREVIEW_NOTES = 24;
/** Preview voices are clamped into this duration range (ms). */
const PREVIEW_MIN_MS = 80;
const PREVIEW_MAX_MS = 320;
/** How long an auditioned key stays lit on the keyboard (ms). */
const KEY_FLASH_MS = 260;
const PREVIEW_VELOCITY_FLOOR = 0.25;

/**
 * Audible score scrubbing: converts score drag positions into playhead time,
 * auditions crossed onsets in movement order at natural crossing times, and
 * animates the corresponding keys. Sound can be disabled in settings while
 * visual seeking keeps working.
 */
class ScrubController {
  private sortedNotes: NoteEvent[] = [];
  private currentTimeMs = 0;
  private active = false;
  private readonly flashes = new Map<number, number>(); // midi → expiry (performance.now ms)
  private activeSnapshot: ReadonlySet<number> = new Set();

  get isActive(): boolean {
    return this.active;
  }

  /** Enter scrubbing (idle/paused only). Returns false when not allowed. */
  begin(): boolean {
    if (!transportController.beginScrub()) return false;
    const take = useTakeStore.getState().take;
    this.sortedNotes = sortNotes(take.notes);
    this.currentTimeMs = transportController.getPlayheadMs();
    this.active = true;
    return true;
  }

  /** Move the scrub position; auditions whatever the playhead crossed. */
  update(nextTimeMsRaw: number): void {
    if (!this.active) return;
    const durationMs = effectivePlaybackDurationMs(useTakeStore.getState().take);
    const nextTimeMs = clamp(nextTimeMsRaw, 0, Math.max(durationMs, 0));
    const previous = this.currentTimeMs;
    if (Math.abs(nextTimeMs - previous) < HYSTERESIS_MS) return;
    this.currentTimeMs = nextTimeMs;
    transportController.setScrubTime(nextTimeMs);

    let crossed = getCrossedNoteOnsets(previous, nextTimeMs, this.sortedNotes);
    if (crossed.length > MAX_PREVIEW_NOTES) {
      // Keep the notes nearest the landing position (end of movement order).
      crossed = crossed.slice(crossed.length - MAX_PREVIEW_NOTES);
    }
    if (crossed.length === 0) return;

    const audition = useSettingsStore.getState().scrubAudition;
    const now = performance.now();
    for (const note of crossed) {
      this.flashes.set(note.midi, now + KEY_FLASH_MS);
      if (audition) {
        audioEngine.scheduleNote(
          {
            midi: note.midi,
            velocity: Math.max(PREVIEW_VELOCITY_FLOOR, note.velocity * 0.85),
            durationMs: clamp(note.durationMs, PREVIEW_MIN_MS, PREVIEW_MAX_MS),
          },
          audioEngine.currentTime,
          'scrub',
        );
      }
    }
    this.refreshActiveSnapshot(now);
  }

  /** Leave scrubbing; playback resumes from the final scrub position. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    transportController.endScrub(this.currentTimeMs);
    // Preview voices fade on their own scheduled releases; clear the lights.
    this.flashes.clear();
    this.refreshActiveSnapshot(performance.now());
  }

  /** Keys currently flashing from scrub auditions (for the keyboard). */
  getActiveMidis(): ReadonlySet<number> {
    this.refreshActiveSnapshot(performance.now());
    return this.activeSnapshot;
  }

  private refreshActiveSnapshot(now: number): void {
    let changed = false;
    for (const [midi, expiry] of this.flashes) {
      if (expiry <= now) {
        this.flashes.delete(midi);
        changed = true;
      }
    }
    if (changed || this.flashes.size !== this.activeSnapshot.size) {
      this.activeSnapshot = new Set(this.flashes.keys());
    }
  }
}

export const scrubController = new ScrubController();
