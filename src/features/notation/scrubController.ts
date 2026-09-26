import { audioEngine } from '@/audio/AudioEngine';
import { velocityForCurveDb } from '@/audio/velocityCurve';
import { noteHand, type Hand } from '@/domain/hands';
import { isSilentNote, sortStrikes } from '@/domain/noteEvents';
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
/**
 * How loud the softest audition plays on a calibrated piano — a grand, whose
 * velocity sets only its loudness (`SampleBank.isCalibrated`) — in dB against
 * a note at the computer keyboard's velocity: where the floor was heard before
 * the grands were calibrated, when it was velocity 0.25 — 4.5 dB under on
 * Salamander and 3.7 on Headroom, across C3–B5. The calibrated curve spreads
 * velocities about twice as wide, so 0.25 would now sound 11.5 dB under; the
 * floor keeps its loudness, not its number.
 */
const PREVIEW_FLOOR_DB = -4.1;
/** The softest velocity an audition plays at on a calibrated piano: about 0.51. */
export const PREVIEW_VELOCITY_FLOOR = velocityForCurveDb(PREVIEW_FLOOR_DB);
/**
 * The softest velocity an audition plays at on any other piano: the floor as
 * it has always been. An uncalibrated instrument keeps its own velocity model,
 * and on the Wurlitzer the velocity also picks the recording — the calibrated
 * floor would swap its pp sample for the mp one, and add 12 dB of gain besides.
 */
export const UNCALIBRATED_PREVIEW_VELOCITY_FLOOR = 0.25;

/**
 * The velocity a note is auditioned at: a little softer than it was played,
 * but never under the floor of the piano sounding now, so switching pianos
 * mid-scrub takes effect with the next audition.
 */
function previewVelocity(velocity: number): number {
  const floor = audioEngine.bank.isCalibrated()
    ? PREVIEW_VELOCITY_FLOOR
    : UNCALIBRATED_PREVIEW_VELOCITY_FLOOR;
  return Math.max(floor, velocity * 0.85);
}

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
  /** midi → the flash's expiry (performance.now ms) and the hand playing it. */
  private readonly flashes = new Map<number, { expiry: number; hand: Hand }>();
  private activeSnapshot: ReadonlyMap<number, Hand> = new Map();

  get isActive(): boolean {
    return this.active;
  }

  /** Enter scrubbing (idle/paused only). Returns false when not allowed. */
  begin(): boolean {
    if (!transportController.beginScrub()) return false;
    const take = useTakeStore.getState().take;
    this.sortedNotes = sortStrikes(take.notes);
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
      this.flashes.set(note.midi, { expiry: now + KEY_FLASH_MS, hand: noteHand(note) });
      // A note written but not played flashes its key, as the score shows it,
      // but is not heard: the audition floor would otherwise lift it.
      if (audition && !isSilentNote(note)) {
        audioEngine.scheduleNote(
          {
            midi: note.midi,
            velocity: previewVelocity(note.velocity),
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

  /**
   * Leave scrubbing at `timeMs`, where the playhead was when the drag being
   * undone began, without auditioning the notes on the way back. A second
   * finger on the score does this, turning the first one's drag into a pinch.
   */
  cancel(timeMs: number): void {
    if (!this.active) return;
    this.currentTimeMs = timeMs;
    this.end();
  }

  /**
   * Keys currently flashing from scrub auditions, each with the hand that
   * plays it (for the keyboard).
   */
  getActiveHands(): ReadonlyMap<number, Hand> {
    this.refreshActiveSnapshot(performance.now());
    return this.activeSnapshot;
  }

  private refreshActiveSnapshot(now: number): void {
    let changed = false;
    for (const [midi, flash] of this.flashes) {
      if (flash.expiry <= now) {
        this.flashes.delete(midi);
        changed = true;
      }
    }
    // Size alone would miss a key re-flashed from the other staff before its
    // first flash expired: same count, same pitch, other hand — and the key
    // bed would wear the previous hand's colour for the whole new flash.
    if (!changed && this.flashes.size === this.activeSnapshot.size) {
      for (const [midi, flash] of this.flashes) {
        if (this.activeSnapshot.get(midi) !== flash.hand) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }
    this.activeSnapshot = new Map(
      [...this.flashes].map(([midi, flash]) => [midi, flash.hand] as const),
    );
  }
}

export const scrubController = new ScrubController();
