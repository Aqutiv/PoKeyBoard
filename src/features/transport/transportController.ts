import { audioEngine, type InputNoteEvent } from '@/audio/AudioEngine';
import { MetronomeEngine } from '@/audio/MetronomeEngine';
import { sortNotes } from '@/domain/noteEvents';
import type { NoteEvent, PedalEvent } from '@/domain/takeTypes';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { newId } from '@/utils/ids';
import { clamp, countInDurationMs } from '@/utils/timing';
import { applySustainToNotes } from './sustainPedal';
import { TransportClock } from './transportClock';
import {
  canTransition,
  transition,
  type TransportEvent,
  type TransportState,
} from './transportMachine';

export type RecordMode = 'overdub' | 'replace';

const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_MS = 150;
const START_SLACK_S = 0.06;

interface OpenNote {
  id: string;
  midi: number;
  velocity: number;
  startMs: number;
}

/**
 * Orchestrates the transport: the state machine, the audio-clock transport
 * clock, lookahead playback scheduling, recording capture, and the
 * metronome. A module singleton — React components subscribe to snapshots
 * and issue commands; time never lives in React state.
 */
export class TransportController {
  readonly metronome = new MetronomeEngine();
  readonly clock = new TransportClock(() => audioEngine.currentTime);

  private state: TransportState = 'idle';
  private readonly stateListeners = new Set<() => void>();
  private errorMessage: string | null = null;

  private metronomeOn = false;
  private pausedPlayheadMs = 0;
  private scrubTimeMs = 0;

  // Recording
  private recordStartMs = 0;
  private recordAnchorAudioTime = 0;
  private readonly openNotes = new Map<string, OpenNote>();
  private recordedPedals: PedalEvent[] = [];
  private passNoteIds: string[] = [];
  private inputUnsub: (() => void) | null = null;
  private countInTimer: ReturnType<typeof setTimeout> | null = null;

  // Playback
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private playNotes: NoteEvent[] = [];
  private playCursor = 0;

  /** Callbacks fired when a recording pass has been finalized (autosave). */
  readonly onRecordingFinalized = new Set<() => void>();

  // ----------------------------------------------------------- state --

  getState(): TransportState {
    return this.state;
  }

  getError(): string | null {
    return this.errorMessage;
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private send(event: TransportEvent): boolean {
    const next = transition(this.state, event);
    if (next === null) return false;
    this.state = next;
    for (const listener of this.stateListeners) listener();
    return true;
  }

  /** Export flow (task: audio export) drives these transitions. */
  sendExportEvent(
    event: Extract<
      TransportEvent,
      'EXPORT_START' | 'RENDER_DONE' | 'ENCODE_DONE' | 'DISMISS_AUDIO' | 'EXPORT_CANCEL' | 'FAIL'
    >,
  ): boolean {
    return this.send(event);
  }

  /**
   * Drive the transport out of any export state back to idle. Safe to call
   * from anywhere the export dialog closes — a no-op unless an export is in
   * progress — so a dismissed dialog can never wedge the next export.
   */
  releaseExport(): void {
    switch (this.state) {
      case 'renderingAudio':
      case 'encodingAudio':
        this.send('EXPORT_CANCEL');
        return;
      case 'audioReady':
        this.send('DISMISS_AUDIO');
        return;
      case 'error':
        this.send('RESET');
        return;
      default:
        return;
    }
  }

  fail(message: string): void {
    this.errorMessage = message;
    this.stopEverything();
    this.send('FAIL');
  }

  reset(): void {
    this.errorMessage = null;
    this.send('RESET');
  }

  // -------------------------------------------------------- playhead --

  /** Current playhead in take-ms. Live from the audio clock while moving. */
  getPlayheadMs(): number {
    if (this.state === 'playing' || this.state === 'recording') {
      return Math.max(0, this.clock.currentTakeMs());
    }
    if (this.state === 'countIn') return this.recordStartMs;
    if (this.state === 'scrubbing') return this.scrubTimeMs;
    return this.pausedPlayheadMs;
  }

  // ------------------------------------------------------- scrubbing --

  /** Enter scrubbing from idle/paused. The scrub controller drives times. */
  beginScrub(): boolean {
    if (!canTransition(this.state, 'SCRUB_START')) return false;
    this.scrubTimeMs = this.pausedPlayheadMs;
    return this.send('SCRUB_START');
  }

  setScrubTime(takeMs: number): void {
    if (this.state !== 'scrubbing') return;
    this.scrubTimeMs = Math.max(0, takeMs);
  }

  /** Leave scrubbing; normal playback resumes from this position. */
  endScrub(finalTakeMs: number): void {
    if (this.state !== 'scrubbing') return;
    const duration = useTakeStore.getState().take.durationMs;
    this.pausedPlayheadMs = clamp(Math.round(finalTakeMs), 0, duration);
    this.clock.seek(this.pausedPlayheadMs);
    useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
    this.send('SCRUB_END');
  }

  seek(takeMs: number): void {
    if (this.state === 'playing' || this.state === 'recording' || this.state === 'countIn') return;
    const duration = useTakeStore.getState().take.durationMs;
    this.pausedPlayheadMs = clamp(Math.round(takeMs), 0, duration);
    this.clock.seek(this.pausedPlayheadMs);
    useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
    for (const listener of this.stateListeners) listener();
  }

  returnToStart(): void {
    if (this.state === 'playing') this.pause();
    if (this.state === 'recording' || this.state === 'countIn') this.stop();
    this.seek(0);
  }

  // ------------------------------------------------------- metronome --

  isMetronomeOn(): boolean {
    return this.metronomeOn;
  }

  setMetronomeOn(on: boolean): void {
    this.metronomeOn = on;
    if (!on && this.state !== 'countIn') {
      this.metronome.stop();
    } else if (on) {
      this.configureMetronome();
      if (this.state === 'playing' || this.state === 'recording') {
        // Align clicks to the take's beat grid.
        this.metronome.start(this.clock.audioTimeForTakeMs(0));
      } else if (this.state === 'idle' || this.state === 'paused') {
        this.metronome.start();
      }
    }
    for (const listener of this.stateListeners) listener();
  }

  private configureMetronome(): void {
    const context = audioEngine.getAudioContext();
    if (context) this.metronome.attach(context);
    const tempo = useTakeStore.getState().take.tempo;
    this.metronome.configure({
      bpm: tempo.bpm,
      timeSignature: tempo.timeSignature,
      volume: useSettingsStore.getState().metronomeVolume,
    });
  }

  /** Re-apply tempo/volume changes while running. */
  refreshMetronomeConfig(): void {
    this.configureMetronome();
  }

  // ------------------------------------------------------- recording --

  async record(mode: RecordMode = 'overdub'): Promise<void> {
    if (!canTransition(this.state, 'RECORD')) return;
    await audioEngine.unlockFromUserGesture();

    const takeState = useTakeStore.getState();
    const tempo = takeState.take.tempo;
    const startPlayheadMs = this.pausedPlayheadMs;

    if (mode === 'replace') {
      takeState.updateTake((take) => {
        const notes = take.notes.filter((note) => note.startMs < startPlayheadMs);
        return { ...take, notes };
      });
    }

    this.configureMetronome();
    const countMs = countInDurationMs(tempo);
    const beat0 = audioEngine.currentTime + START_SLACK_S;
    this.recordStartMs = startPlayheadMs;
    this.recordAnchorAudioTime = beat0 + countMs / 1000;
    this.clock.start(startPlayheadMs, this.recordAnchorAudioTime);

    if (countMs > 0 || this.metronomeOn) {
      this.metronome.start(beat0);
    }

    this.send('RECORD');

    const begin = () => {
      if (this.state !== 'countIn') return; // stopped during count-in
      if (!this.metronomeOn) this.metronome.stop();
      this.beginCapture();
      this.send('COUNT_IN_DONE');
    };
    if (countMs === 0) {
      begin();
    } else {
      this.countInTimer = setTimeout(() => {
        this.countInTimer = null;
        begin();
      }, countMs);
    }
  }

  private beginCapture(): void {
    this.openNotes.clear();
    this.recordedPedals = [];
    this.passNoteIds = [];
    this.inputUnsub = audioEngine.subscribeInput((event) => this.onInput(event));
  }

  private onInput(event: InputNoteEvent): void {
    if (this.state !== 'recording') return;
    // Count-in presses never reach here (the state guard above filters
    // them). A press in the tiny scheduling gap before the audio-clock
    // anchor is a real performance note — clamp it to the start instead of
    // dropping it, or the first eager note after tapping record is lost.
    const rawMs = this.recordStartMs + (event.audioTime - this.recordAnchorAudioTime) * 1000;
    const takeMs = Math.max(this.recordStartMs, Math.round(rawMs));

    if (event.type === 'on') {
      const key = `${event.sourceId}:${event.midi}`;
      this.openNotes.set(key, {
        id: newId(),
        midi: event.midi,
        velocity: event.velocity,
        startMs: takeMs,
      });
      return;
    }
    if (event.type === 'off') {
      const key = `${event.sourceId}:${event.midi}`;
      const open = this.openNotes.get(key);
      if (!open) return;
      this.openNotes.delete(key);
      this.commitNote(open, takeMs);
      return;
    }
    this.recordedPedals.push({ atMs: takeMs, down: event.down });
  }

  private commitNote(open: OpenNote, endMs: number): void {
    const note: NoteEvent = {
      id: open.id,
      midi: open.midi,
      startMs: open.startMs,
      durationMs: Math.max(1, endMs - open.startMs),
      velocity: open.velocity,
    };
    this.passNoteIds = [...this.passNoteIds, note.id];
    useTakeStore.getState().appendRecordedNotes([note], [], this.passNoteIds);
  }

  /** In-progress (held) notes, for prompt score display while recording. */
  getOpenRecordingNotes(): Array<{
    midi: number;
    startMs: number;
    durationMs: number;
    velocity: number;
  }> {
    if (this.state !== 'recording') return [];
    const nowMs = this.clock.currentTakeMs();
    return [...this.openNotes.values()].map((open) => ({
      midi: open.midi,
      startMs: open.startMs,
      durationMs: Math.max(1, Math.round(nowMs - open.startMs)),
      velocity: open.velocity,
    }));
  }

  // -------------------------------------------------------- playback --

  play(): void {
    if (!canTransition(this.state, 'PLAY')) return;
    void audioEngine.unlockFromUserGesture();

    const take = useTakeStore.getState().take;
    this.playNotes = sortNotes(applySustainToNotes(take.notes, take.pedalEvents));

    const fromMs = this.pausedPlayheadMs;
    this.playCursor = this.playNotes.findIndex((note) => note.startMs >= fromMs);
    if (this.playCursor === -1) this.playCursor = this.playNotes.length;

    this.clock.start(fromMs, audioEngine.currentTime + START_SLACK_S);
    if (this.metronomeOn) {
      this.configureMetronome();
      this.metronome.start(this.clock.audioTimeForTakeMs(0));
    }
    this.send('PLAY');
    this.scheduleTick();
    this.schedulerTimer = setInterval(() => this.scheduleTick(), SCHEDULER_INTERVAL_MS);
  }

  private scheduleTick(): void {
    if (this.state !== 'playing') return;
    const horizonMs = this.clock.currentTakeMs() + SCHEDULE_AHEAD_MS;
    while (this.playCursor < this.playNotes.length) {
      const note = this.playNotes[this.playCursor] as NoteEvent;
      if (note.startMs > horizonMs) break;
      audioEngine.scheduleNote(
        { midi: note.midi, velocity: note.velocity, durationMs: note.durationMs },
        this.clock.audioTimeForTakeMs(note.startMs),
        'playback',
      );
      this.playCursor += 1;
    }
    const durationMs = useTakeStore.getState().take.durationMs;
    if (this.playCursor >= this.playNotes.length && this.clock.currentTakeMs() >= durationMs) {
      this.pauseInternal(durationMs);
    }
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pauseInternal(Math.round(this.clock.currentTakeMs()));
  }

  private pauseInternal(atMs: number): void {
    this.clearScheduler();
    this.metronome.stop();
    audioEngine.allNotesOff();
    this.clock.pause();
    const duration = useTakeStore.getState().take.durationMs;
    this.pausedPlayheadMs = clamp(atMs, 0, duration);
    useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
    this.send('PAUSE');
  }

  stop(): void {
    switch (this.state) {
      case 'countIn': {
        if (this.countInTimer !== null) {
          clearTimeout(this.countInTimer);
          this.countInTimer = null;
        }
        this.metronome.stop();
        this.clock.pause();
        this.pausedPlayheadMs = this.recordStartMs;
        this.send('STOP');
        return;
      }
      case 'recording': {
        this.finalizeRecording();
        this.send('STOP');
        return;
      }
      case 'playing':
      case 'paused':
      case 'scrubbing': {
        this.stopEverything();
        this.send('STOP');
        return;
      }
      default:
        this.send('STOP');
    }
  }

  private finalizeRecording(): void {
    const endMs = Math.max(this.recordStartMs, Math.round(this.clock.currentTakeMs()));
    this.inputUnsub?.();
    this.inputUnsub = null;
    for (const open of this.openNotes.values()) {
      this.commitNote(open, endMs);
    }
    this.openNotes.clear();
    if (this.recordedPedals.length > 0) {
      useTakeStore.getState().appendRecordedNotes([], this.recordedPedals, this.passNoteIds);
      this.recordedPedals = [];
    }
    this.metronome.stop();
    this.clock.pause();
    this.pausedPlayheadMs = endMs;
    useTakeStore.getState().setPlayheadMs(endMs);
    for (const callback of this.onRecordingFinalized) callback();
  }

  /** Hard cleanup used by stop, failures, and lifecycle interruptions. */
  private stopEverything(): void {
    this.clearScheduler();
    if (this.countInTimer !== null) {
      clearTimeout(this.countInTimer);
      this.countInTimer = null;
    }
    if (this.inputUnsub) {
      // Interrupted mid-recording: finalize so nothing is lost.
      this.finalizeRecording();
    }
    this.metronome.stop();
    audioEngine.allNotesOff();
    this.clock.pause();
  }

  /** Called by the lifecycle layer when the page hides mid-activity. */
  handleInterruption(): void {
    if (this.state === 'recording' || this.state === 'countIn') {
      this.stop();
    } else if (this.state === 'playing') {
      this.pause();
    } else if (this.state === 'scrubbing') {
      this.send('SCRUB_END');
    }
  }

  private clearScheduler(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /** Restore a playhead position (e.g. when a take is loaded). */
  restorePlayhead(takeMs: number): void {
    this.pausedPlayheadMs = Math.max(0, takeMs);
    this.clock.seek(this.pausedPlayheadMs);
    for (const listener of this.stateListeners) listener();
  }
}

export const transportController = new TransportController();
