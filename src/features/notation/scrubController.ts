import { audioEngine } from '@/audio/AudioEngine';
import { velocityForCurveDb } from '@/audio/velocityCurve';
import { noteHand, type KeyCue } from '@/domain/hands';
import { isSilentNote, sortStrikes } from '@/domain/noteEvents';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { effectivePlaybackDurationMs } from '@/features/transport/sustainPedal';
import { foldIntoLoop, loopPassAt } from '@/features/transport/transportClock';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { clamp } from '@/utils/timing';
import { getCrossedNoteOnsets, getCrossedNoteOnsetsRound } from './scrubMath';

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
  /** The loop the scrub goes round, or null where it runs straight; see `begin`. */
  private loop: PlaybackLoop | null = null;
  /** Where the scrub is on its unwrapped run: the take time, until a loop folds it. */
  private currentVirtualMs = 0;
  /** The furthest back the scrub has reached on its first pass. */
  private firstPassLowMs = 0;
  private active = false;
  /**
   * midi → the flash's expiry (performance.now ms) and how it lights the key:
   * in the hand playing it, as hard as the take played it.
   */
  private readonly flashes = new Map<number, { expiry: number; cue: KeyCue }>();
  private activeSnapshot: ReadonlyMap<number, KeyCue> = new Map();

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Enter scrubbing (idle/paused only). Returns false when not allowed. Given
   * a `loop` it is short of, the scrub goes round it as playback does: then
   * `update` takes times on the unwrapped run, and past the loop's end the
   * scrub comes round to its top. The falling notes draw a loop's passes
   * above its end, so their drag goes round; the score draws the take
   * straight on, so its drag does not.
   */
  begin(loop: PlaybackLoop | null = null): boolean {
    if (!transportController.beginScrub()) return false;
    const take = useTakeStore.getState().take;
    this.sortedNotes = sortStrikes(take.notes);
    this.currentTimeMs = transportController.getPlayheadMs();
    this.currentVirtualMs = this.currentTimeMs;
    this.firstPassLowMs = this.currentTimeMs;
    this.loop = loop && this.currentTimeMs < loop.endMs ? loop : null;
    this.active = true;
    return true;
  }

  /**
   * Move the scrub position — round a loop, on the unwrapped run; see
   * `begin` — and audition whatever the playhead crossed.
   */
  update(nextTimeMsRaw: number): void {
    if (!this.active) return;
    const durationMs = Math.max(effectivePlaybackDurationMs(useTakeStore.getState().take), 0);
    const loop = this.loop;
    const nextVirtualMs = loop ? Math.max(0, nextTimeMsRaw) : clamp(nextTimeMsRaw, 0, durationMs);
    const previousVirtualMs = this.currentVirtualMs;
    if (Math.abs(nextVirtualMs - previousVirtualMs) < HYSTERESIS_MS) return;
    const nextTimeMs = loop
      ? clamp(foldIntoLoop(loop, nextVirtualMs), 0, durationMs)
      : nextVirtualMs;
    this.currentVirtualMs = nextVirtualMs;
    this.currentTimeMs = nextTimeMs;
    if (this.loopPass() === 0) this.firstPassLowMs = Math.min(this.firstPassLowMs, nextTimeMs);
    transportController.setScrubTime(nextTimeMs);

    let crossed = loop
      ? getCrossedNoteOnsetsRound(loop, previousVirtualMs, nextVirtualMs, this.sortedNotes)
      : getCrossedNoteOnsets(previousVirtualMs, nextVirtualMs, this.sortedNotes);
    if (crossed.length > MAX_PREVIEW_NOTES) {
      // Keep the notes nearest the landing position (end of movement order).
      crossed = crossed.slice(crossed.length - MAX_PREVIEW_NOTES);
    }
    if (crossed.length === 0) return;

    const audition = useSettingsStore.getState().scrubAudition;
    const now = performance.now();
    for (const note of crossed) {
      // The take's velocity, not the audition's: the key shows how the note was
      // played, however the floor below lifts what is heard of it.
      this.flashes.set(note.midi, {
        expiry: now + KEY_FLASH_MS,
        cue: { hand: noteHand(note), velocity: note.velocity },
      });
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
    this.loop = null;
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
   * Where the pass the scrub is in began: the furthest back it has reached
   * the first time through, or the loop's top once it has come round. It has
   * not crossed a note that starts before that on this pass, so the falling
   * notes draw such a note as playback would, unstruck.
   */
  getPassStartMs(): number {
    return this.loop && this.loopPass() > 0 ? this.loop.startMs : this.firstPassLowMs;
  }

  /** Which pass of its loop the scrub is in: 0 until it first comes round. */
  private loopPass(): number {
    return this.loop ? loopPassAt(this.loop, this.currentVirtualMs) : 0;
  }

  /**
   * Keys currently flashing from scrub auditions, each with the hand that
   * plays it and the velocity the take plays it at (for the keyboard).
   */
  getActiveKeys(): ReadonlyMap<number, KeyCue> {
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
    // Size alone would miss a key re-flashed before its first flash expired:
    // same count, same pitch, but another hand or another velocity — and the
    // key bed would wear the previous shade for the whole new flash. Each
    // flash carries a cue of its own, so any re-flash reads as a change.
    if (!changed && this.flashes.size === this.activeSnapshot.size) {
      for (const [midi, flash] of this.flashes) {
        if (this.activeSnapshot.get(midi) !== flash.cue) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }
    this.activeSnapshot = new Map(
      [...this.flashes].map(([midi, flash]) => [midi, flash.cue] as const),
    );
  }
}

export const scrubController = new ScrubController();
