import { audioEngine, type InputNoteEvent } from '@/audio/AudioEngine';
import type { PianoInstrumentId } from '@/audio/instruments';
import {
  constantClickGrid,
  gridForTake,
  MetronomeEngine,
  type ClickGrid,
} from '@/audio/MetronomeEngine';
import { forkLibraryTake, isLibraryTakeId } from '@/domain/libraryTakes';
import { computeTakeDurationMs, lowerBoundByStart, sortNotes } from '@/domain/noteEvents';
import {
  MAX_NOTE_DURATION_MS,
  MAX_PLAYBACK_SPEED,
  MAX_TAKE_MS,
  MIN_PLAYBACK_SPEED,
  type NoteEvent,
  type PedalEvent,
  type PlaybackLoop,
  type Take,
} from '@/domain/takeTypes';
import { countInMsAt, createTakeTempoMap } from '@/domain/tempoMap';
import { CHORD_WINDOW_MS, nextTrainingGate, type TrainingGate } from '@/domain/trainingGate';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { newId } from '@/utils/ids';
import { beatDurationMs, clamp } from '@/utils/timing';
import { trainingHandFor, type RecordMode } from './modes';
import { applySustainToNotes, effectivePlaybackDurationMs } from './sustainPedal';
import {
  foldIntoLoop,
  loopPassAt,
  MIN_LOOP_MS,
  TransportClock,
  type ClockRun,
} from './transportClock';
import {
  canTransition,
  transition,
  type TransportEvent,
  type TransportState,
} from './transportMachine';

const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_MS = 150;
const START_SLACK_S = 0.06;
/** Lead-in before the first practice click, so it is never scheduled late. */
const PRACTICE_CLICK_LEAD_S = 0.05;
/** How long a key the user got wrong stays lit; matches the scrub flash. */
const WRONG_FLASH_MS = 260;
/** A playback speed the transport will run at. */
export function clampPlaybackSpeed(speed: number): number {
  return Number.isFinite(speed)
    ? Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed))
    : 1;
}

const EMPTY_MIDIS: ReadonlySet<number> = new Set();

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
  private pianoSwitching = false;

  private metronomeOn = false;
  private pausedPlayheadMs = 0;
  private scrubTimeMs = 0;
  private scrubReturnState: 'idle' | 'paused' = 'idle';

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
  private schedulerTickUnsub: (() => void) | null = null;
  private playNotes: NoteEvent[] = [];
  private playCursor = 0;
  private playDurationMs = 0;
  /** The passage this run repeats; none while recording. */
  private playLoop: PlaybackLoop | null = null;
  /** Which pass of the loop the scheduler's cursor is in; see `TransportClock`. */
  private schedulePass = 0;

  // Training playback
  private trainingGate: TrainingGate | null = null;
  /** Where the gate falls on the run's unwrapped timeline; see `TransportClock`. */
  private trainingGateVirtualMs = 0;
  private trainingWaiting = false;
  private readonly trainingSatisfied = new Set<number>();
  private trainingInputUnsub: (() => void) | null = null;
  /** Wrong keys pressed at a wait point, midi → when the flash expires. */
  private readonly trainingWrong = new Map<number, number>();
  /** Notes the user has just played live, so the take must not echo them. */
  private trainingSkipNoteIds: ReadonlySet<string> | null = null;

  /** Callbacks fired when a recording pass has been finalized (autosave). */
  readonly onRecordingFinalized = new Set<() => void>();

  // ----------------------------------------------------------- state --

  getState(): TransportState {
    return this.state;
  }

  getError(): string | null {
    return this.errorMessage;
  }

  isPianoSwitching(): boolean {
    return this.pianoSwitching;
  }

  isPianoReady(): boolean {
    return !this.pianoSwitching && audioEngine.bank.isCoreReady();
  }

  /** Pause before replacing the sample bank; transport stays locked until decoding finishes. */
  async selectPiano(id: PianoInstrumentId): Promise<boolean> {
    if (
      this.pianoSwitching ||
      id === useSettingsStore.getState().pianoInstrument ||
      (this.state !== 'idle' && this.state !== 'paused' && this.state !== 'playing')
    )
      return false;
    this.pause();
    this.clearTrainingGate();
    this.pianoSwitching = true;
    for (const listener of this.stateListeners) listener();
    try {
      useSettingsStore.getState().setPianoInstrument(id);
      await audioEngine.setInstrument(id);
      return audioEngine.bank.isCoreReady();
    } catch {
      // Optional range samples can fail after the core has decoded. Progress
      // still exposes the error, but the usable core must remain available.
      return audioEngine.bank.isCoreReady();
    } finally {
      this.pianoSwitching = false;
      for (const listener of this.stateListeners) listener();
    }
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

  /** Sheet/PDF export flow drives these transitions. */
  sendSheetExportEvent(
    event: Extract<
      TransportEvent,
      'SHEET_EXPORT_START' | 'SHEET_EXPORT_DONE' | 'SHEET_EXPORT_CANCEL'
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
      case 'renderingSheet':
        this.send('SHEET_EXPORT_CANCEL');
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
    this.scrubReturnState = this.state === 'paused' ? 'paused' : 'idle';
    this.clearTrainingGate();
    this.scrubTimeMs = this.pausedPlayheadMs;
    return this.send('SCRUB_START');
  }

  setScrubTime(takeMs: number): void {
    if (this.state !== 'scrubbing') return;
    this.scrubTimeMs = clamp(takeMs, 0, this.takeDurationMs());
  }

  /** Restore the pre-scrub state at the chosen position without starting playback. */
  endScrub(finalTakeMs: number): void {
    if (this.state !== 'scrubbing') return;
    const duration = this.takeDurationMs();
    this.pausedPlayheadMs = clamp(Math.round(finalTakeMs), 0, duration);
    this.clock.seek(this.pausedPlayheadMs);
    useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
    this.send(this.scrubReturnState === 'idle' ? 'SCRUB_END_IDLE' : 'SCRUB_END');
  }

  seek(takeMs: number): void {
    if (this.state === 'playing' || this.state === 'recording' || this.state === 'countIn') return;
    this.clearTrainingGate();
    const duration = this.takeDurationMs();
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
        this.metronome.start(this.takeGrid());
      } else if (this.state === 'idle' || this.state === 'paused') {
        this.metronome.start(this.practiceGrid());
      }
    }
    for (const listener of this.stateListeners) listener();
  }

  private configureMetronome(): void {
    const context = audioEngine.getAudioContext();
    if (context) this.metronome.attach(context, audioEngine.getOutputDestination() ?? undefined);
    this.metronome.configure({ volume: useSettingsStore.getState().metronomeVolume });
  }

  /**
   * The take's own beat grid, tied to the running transport clock: clicks land
   * where the notation draws its beats, tempo changes and all.
   */
  private takeGrid(): ClickGrid {
    return gridForTake(useTakeStore.getState().take.tempo, this.clock);
  }

  /**
   * A steady click for practising while stopped, at the tempo in force where
   * the playhead sits — parked in a slower closing bar, that is what you hear.
   */
  private practiceGrid(): ClickGrid {
    const tempo = useTakeStore.getState().take.tempo;
    const map = createTakeTempoMap(tempo);
    const bpm = map.bpmAt(this.getPlayheadMs());
    const startAudioTime = audioEngine.currentTime + PRACTICE_CLICK_LEAD_S;
    // At the speed playback will run, so the click is the one to practise to.
    return constantClickGrid(
      startAudioTime,
      beatDurationMs(bpm, tempo.timeSignature) / this.getSpeed(),
      tempo.timeSignature.numerator,
    );
  }

  /** Re-apply tempo/volume changes while running. */
  refreshMetronomeConfig(): void {
    this.configureMetronome();
    if (!this.metronome.isRunning) return;
    // The count-in's grid is fixed once it starts; everything else re-reads
    // the take so an edit is heard on the next click.
    if (this.state === 'countIn') return;
    if (this.state === 'playing' || this.state === 'recording') {
      this.metronome.setGrid(this.takeGrid());
    } else {
      this.metronome.setGrid(this.practiceGrid());
    }
  }

  // ------------------------------------------------------- recording --

  async record(mode: RecordMode = 'overdub'): Promise<void> {
    if (!this.isPianoReady() || !canTransition(this.state, 'RECORD')) return;
    this.clearTrainingGate();
    await audioEngine.unlockFromUserGesture();
    if (!this.isPianoReady() || !canTransition(this.state, 'RECORD')) return;

    // A library track is read-only: fork it into a fresh user take before
    // any capture so the pass lands there. The fork starts clean (not
    // dirty) — stopping during the count-in therefore saves nothing, and
    // the pristine library take comes back on its next open.
    const activeTake = useTakeStore.getState().take;
    if (isLibraryTakeId(activeTake.id)) {
      useTakeStore.getState().setTake(forkLibraryTake(activeTake), { dirty: false });
    }

    const takeState = useTakeStore.getState();
    const tempo = takeState.take.tempo;
    const startPlayheadMs = clamp(this.pausedPlayheadMs, 0, MAX_TAKE_MS - 1);

    if (mode === 'replace') {
      takeState.updateTake((take) => {
        const notes = take.notes.flatMap((note) => {
          if (note.startMs >= startPlayheadMs) return [];
          const endMs = note.startMs + note.durationMs;
          return endMs > startPlayheadMs
            ? [{ ...note, durationMs: Math.max(1, startPlayheadMs - note.startMs) }]
            : [note];
        });
        const earlierPedals = take.pedalEvents.filter((event) => event.atMs < startPlayheadMs);
        let pedalDown = false;
        for (const event of [...earlierPedals].sort((a, b) => a.atMs - b.atMs)) {
          pedalDown = event.down;
        }
        const pedalEvents = pedalDown
          ? [...earlierPedals, { atMs: startPlayheadMs, down: false }]
          : earlierPedals;
        const durationMs = computeTakeDurationMs(notes);
        return {
          ...take,
          notes,
          pedalEvents,
          durationMs,
          display: { ...take.display, playheadMs: Math.min(startPlayheadMs, durationMs) },
        };
      });
    }

    this.configureMetronome();
    // The count-in beats at the tempo the recording will start in, so the
    // player is counted in at the speed they are about to play.
    const map = createTakeTempoMap(tempo);
    const countMs = countInMsAt(map, tempo.timeSignature, tempo.countInBars, startPlayheadMs);
    const beat0 = audioEngine.currentTime + START_SLACK_S;
    this.recordStartMs = startPlayheadMs;
    this.recordAnchorAudioTime = beat0 + countMs / 1000;
    // Recording always runs at the take's own speed, straight through.
    this.playLoop = null;
    this.clock.start(startPlayheadMs, this.recordAnchorAudioTime);

    if (countMs > 0 || this.metronomeOn) {
      // Count-in clicks are steady and end exactly on the record anchor; the
      // take's own grid takes over from there.
      this.metronome.start(
        countMs > 0
          ? constantClickGrid(
              beat0,
              beatDurationMs(map.bpmAt(startPlayheadMs), tempo.timeSignature),
              tempo.timeSignature.numerator,
            )
          : this.takeGrid(),
      );
    }

    this.send('RECORD');

    // Overdub: sound the already-recorded take as backing so the player can
    // play in time with it. Snapshotting here fixes the backing to the
    // pre-existing notes; notes recorded during this pass are heard live and
    // are never in the backing. In replace mode the kept notes are all before
    // the playhead, so nothing schedules forward — a natural no-op.
    const current = useTakeStore.getState().take;
    const backing = sortNotes(applySustainToNotes(current.notes, current.pedalEvents));
    this.beginPlaybackScheduler(backing, startPlayheadMs);

    const begin = () => {
      if (this.state !== 'countIn') return; // stopped during count-in
      if (this.metronomeOn) this.metronome.setGrid(this.takeGrid());
      else this.metronome.stop();
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
    useTakeStore.getState().beginRecordingPass();
    this.inputUnsub = audioEngine.subscribeInput((event) => this.onInput(event));
  }

  private onInput(event: InputNoteEvent): void {
    if (this.state !== 'recording') return;
    // Count-in presses never reach here (the state guard above filters
    // them). A press in the tiny scheduling gap before the audio-clock
    // anchor is a real performance note — clamp it to the start instead of
    // dropping it, or the first eager note after tapping record is lost.
    const rawMs = this.recordStartMs + (event.audioTime - this.recordAnchorAudioTime) * 1000;
    if (rawMs >= MAX_TAKE_MS) {
      this.stop();
      return;
    }
    const takeMs = clamp(Math.round(rawMs), this.recordStartMs, MAX_TAKE_MS - 1);

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
    const boundedEndMs = Math.min(
      MAX_TAKE_MS,
      open.startMs + MAX_NOTE_DURATION_MS,
      Math.max(open.startMs + 1, endMs),
    );
    const note: NoteEvent = {
      id: open.id,
      midi: open.midi,
      startMs: open.startMs,
      durationMs: boundedEndMs - open.startMs,
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
    const nowMs = Math.min(MAX_TAKE_MS, this.clock.currentTakeMs());
    return [...this.openNotes.values()].map((open) => ({
      midi: open.midi,
      startMs: open.startMs,
      durationMs: Math.min(MAX_NOTE_DURATION_MS, Math.max(1, Math.round(nowMs - open.startMs))),
      velocity: open.velocity,
    }));
  }

  // -------------------------------------------------------- playback --

  play(): void {
    if (!this.isPianoReady()) return;
    // Pressing Play at a training wait point lets that note through rather
    // than fighting the hold: the take sounds it, since the user did not.
    if (this.trainingWaiting && this.trainingGate) {
      const gateMs = this.trainingGate.atMs;
      this.endTrainingWait();
      this.startPlayback({ skipNoteIds: null, gateFromMs: gateMs + CHORD_WINDOW_MS + 1 });
      return;
    }
    this.startPlayback(null);
  }

  private startPlayback(
    resume: { skipNoteIds: ReadonlySet<string> | null; gateFromMs: number } | null,
  ): void {
    if (!this.isPianoReady() || !canTransition(this.state, 'PLAY')) return;
    void audioEngine.unlockFromUserGesture();

    const take = useTakeStore.getState().take;
    const notes = sortNotes(applySustainToNotes(take.notes, take.pedalEvents));
    this.playDurationMs = effectivePlaybackDurationMs(take);

    const loop = this.loopFor(take);
    // Playing from before the loop runs into it; from past its end, it starts
    // at the top.
    const fromMs =
      loop && this.pausedPlayheadMs >= loop.endMs ? loop.startMs : this.pausedPlayheadMs;
    this.playLoop = loop;
    this.clock.start(fromMs, audioEngine.currentTime + START_SLACK_S, {
      rate: this.getSpeed(),
      loop,
    });
    if (this.metronomeOn) {
      this.configureMetronome();
      this.metronome.start(this.takeGrid());
    }
    this.send('PLAY');
    this.trainingSkipNoteIds = resume?.skipNoteIds ?? null;
    this.beginPlaybackScheduler(notes, fromMs, resume?.gateFromMs ?? fromMs);
  }

  /**
   * Start (or restart) the look-ahead scheduler that plays `notes` from
   * `fromMs`. Used by playback and by overdub recording (to sound the
   * already-recorded take as backing). The clock must already be started.
   */
  private beginPlaybackScheduler(notes: NoteEvent[], fromMs: number, gateFromMs?: number): void {
    this.clearScheduler();
    this.playNotes = notes;
    this.playCursor = lowerBoundByStart(notes, fromMs);
    this.schedulePass = 0;
    // The gate must exist before the first tick. A note at the playhead sits
    // inside the lookahead, so an unarmed tick would queue the very note the
    // hold is about to ask for — the prompt would arrive after the answer.
    if (gateFromMs !== undefined) this.armTrainingGate(gateFromMs);
    this.scheduleTick();
    this.schedulerTickUnsub = audioEngine.subscribeSchedulerTick(() => {
      this.scheduleTick();
      this.metronome.topUpSchedule();
    });
    this.schedulerTimer = setInterval(() => this.scheduleTick(), SCHEDULER_INTERVAL_MS);
  }

  private scheduleTick(): void {
    // Runs during playback and while recording/counting-in (overdub backing).
    if (this.state !== 'playing' && this.state !== 'recording' && this.state !== 'countIn') {
      return;
    }
    if (this.state === 'recording' && this.clock.currentTakeMs() >= MAX_TAKE_MS) {
      this.stop();
      return;
    }
    // Everything here is on the run's unwrapped timeline (virtual time), where
    // a loop's next pass is simply further on; see `TransportClock`.
    const nowMs = this.clock.currentVirtualMs();
    // Training: stop dead on the gate rather than wherever this 25ms tick
    // landed, so the playhead parks exactly on the note being asked for.
    const gateMs = this.trainingGate ? this.trainingGateVirtualMs : null;
    if (gateMs !== null && nowMs >= gateMs) {
      this.beginTrainingWait();
      return;
    }
    // The look-ahead is audio time; at half speed it covers half as much take.
    const horizonMs = Math.min(
      nowMs + SCHEDULE_AHEAD_MS * this.clock.rate,
      gateMs === null ? Infinity : gateMs - 1,
    );
    const loop = this.playLoop;
    const passMs = loop ? loop.endMs - loop.startMs : 0;
    for (;;) {
      const note = this.playNotes[this.playCursor];
      if (note && (!loop || note.startMs < loop.endMs)) {
        const atMs = note.startMs + this.schedulePass * passMs;
        if (atMs > horizonMs) break;
        this.playCursor += 1;
        if (this.trainingSkipNoteIds?.has(note.id)) continue;
        // A loop lets every key go at its end, as hands leave the keys to
        // start the passage again, rather than ringing on over its top.
        const durationMs = loop
          ? Math.min(note.durationMs, loop.endMs - note.startMs)
          : note.durationMs;
        audioEngine.scheduleNote(
          { midi: note.midi, velocity: note.velocity, durationMs: durationMs / this.clock.rate },
          this.clock.audioTimeForVirtualMs(atMs),
          'playback',
        );
        continue;
      }
      // This pass is scheduled; the next starts at the loop's end, once that
      // comes inside the look-ahead.
      if (!loop || loop.endMs + this.schedulePass * passMs > horizonMs) break;
      this.schedulePass += 1;
      this.playCursor = lowerBoundByStart(this.playNotes, loop.startMs);
      // The notes a training hold let through were played once, not forever.
      this.trainingSkipNoteIds = null;
    }
    // Auto-pause at the end applies to normal playback only; an overdub pass
    // keeps recording past the end of the existing take, and a loop never ends.
    if (this.state === 'playing' && !loop) {
      const durationMs = this.playDurationMs;
      if (this.playCursor >= this.playNotes.length && this.clock.currentTakeMs() >= durationMs) {
        this.pauseInternal(durationMs);
      }
    }
  }

  // -------------------------------------------------------- training --

  /** True while playback is holding for the user to play the lit keys. */
  isWaitingForTraining(): boolean {
    return this.trainingWaiting;
  }

  /** The keys being asked for, empty unless a training wait is holding. */
  getTrainingTargets(): ReadonlySet<number> {
    if (!this.trainingWaiting || !this.trainingGate) return EMPTY_MIDIS;
    return this.trainingGate.midis;
  }

  /** Keys pressed at a wait point that were not being asked for. */
  getTrainingWrongMidis(): ReadonlySet<number> {
    if (this.trainingWrong.size === 0) return EMPTY_MIDIS;
    const now = Date.now();
    for (const [midi, expiry] of this.trainingWrong) {
      if (expiry <= now) this.trainingWrong.delete(midi);
    }
    if (this.trainingWrong.size === 0) return EMPTY_MIDIS;
    return new Set(this.trainingWrong.keys());
  }

  /**
   * Re-read the playback mode. Called when the user changes it, so a switch
   * mid-flight takes effect without stopping. Modelled on
   * `refreshMetronomeConfig`: the setting is read here, never pushed in.
   */
  refreshTrainingMode(): void {
    if (this.trainingWaiting) {
      // Changing the mode at a hold is as good as saying "carry on": let that
      // moment through and run on under the new mode. Clearing the gate alone
      // would strip the targets and the status but leave the transport parked,
      // which is not what changing a mode mid-playback promises.
      this.play();
      return;
    }
    if (this.state !== 'playing') return;
    // Notes inside the lookahead are already scheduled and will sound; a gate
    // on one of them would stop after it had been heard.
    this.armTrainingGate(this.clock.currentVirtualMs() + SCHEDULE_AHEAD_MS * this.clock.rate);
    for (const listener of this.stateListeners) listener();
  }

  /** Arm the next hold at or after `fromMs` on the run's unwrapped timeline. */
  private armTrainingGate(fromMs: number): void {
    this.trainingGate = null;
    // Only ever gates plain playback: an overdub pass sounds its backing
    // through the same scheduler and must never stop to ask for a note.
    if (this.state !== 'playing') return;
    const hand = trainingHandFor(useSettingsStore.getState().playbackMode);
    if (hand === null) return;
    const loop = this.playLoop;
    if (!loop) {
      this.trainingGate = nextTrainingGate(this.playNotes, Math.max(0, fromMs), hand);
      this.trainingGateVirtualMs = this.trainingGate?.atMs ?? 0;
      return;
    }
    // Round a loop: the next hold this time round, or else the first of the
    // next, where the passage starts again.
    let pass = loopPassAt(loop, fromMs);
    let takeMs = foldIntoLoop(loop, fromMs);
    for (let tries = 0; tries < 2; tries += 1) {
      const gate = nextTrainingGate(this.playNotes, Math.max(0, takeMs), hand);
      if (gate && gate.atMs < loop.endMs) {
        this.trainingGate = gate;
        this.trainingGateVirtualMs = gate.atMs + pass * (loop.endMs - loop.startMs);
        return;
      }
      pass += 1;
      takeMs = loop.startMs;
    }
  }

  private beginTrainingWait(): void {
    const gate = this.trainingGate;
    if (!gate) return;
    this.trainingWaiting = true;
    this.trainingSatisfied.clear();
    this.trainingWrong.clear();
    // An ordinary pause, parked exactly on the gate: no new transport state,
    // so nothing that switches on one has to learn about training.
    this.pauseInternal(gate.atMs);
    this.trainingInputUnsub = audioEngine.subscribeInput((event) => this.onTrainingInput(event));
    for (const listener of this.stateListeners) listener();
  }

  private onTrainingInput(event: InputNoteEvent): void {
    const gate = this.trainingGate;
    if (!this.trainingWaiting || !gate || event.type !== 'on') return;
    if (gate.midis.has(event.midi)) {
      // Presses accumulate rather than having to land together: a mouse is one
      // pointer and physically cannot hold a chord.
      this.trainingSatisfied.add(event.midi);
    } else {
      // Wrong keys sound and are flagged, but never block the way forward.
      this.trainingWrong.set(event.midi, Date.now() + WRONG_FLASH_MS);
    }
    for (const listener of this.stateListeners) listener();
    if (this.trainingSatisfied.size >= gate.midis.size) this.resumeFromTrainingGate(gate);
  }

  private resumeFromTrainingGate(gate: TrainingGate): void {
    this.endTrainingWait();
    this.startPlayback({
      skipNoteIds: gate.noteIds,
      gateFromMs: gate.atMs + CHORD_WINDOW_MS + 1,
    });
  }

  private endTrainingWait(): void {
    this.trainingWaiting = false;
    this.trainingSatisfied.clear();
    this.trainingWrong.clear();
    this.trainingInputUnsub?.();
    this.trainingInputUnsub = null;
  }

  private clearTrainingGate(): void {
    this.endTrainingWait();
    this.trainingGate = null;
    this.trainingSkipNoteIds = null;
  }

  // ------------------------------------------------- speed and loop --

  /** How fast playback runs, 1 being the take's own speed. */
  getSpeed(): number {
    return clampPlaybackSpeed(useTakeStore.getState().take.display.speed ?? 1);
  }

  /**
   * Play slower or faster, from this moment if playback is running: the note
   * under way carries on and the rest follow at the new speed. Recording is
   * unaffected — a pass always runs at the take's own speed.
   */
  setSpeed(speed: number): void {
    const next = clampPlaybackSpeed(speed);
    useTakeStore.getState().setPlaybackSpeed(next);
    if (this.state === 'playing') {
      this.retimeRun({ rate: next });
    } else if (this.metronome.isRunning && (this.state === 'idle' || this.state === 'paused')) {
      this.metronome.setGrid(this.practiceGrid());
    }
    for (const listener of this.stateListeners) listener();
  }

  /** The passage playback repeats, or null. */
  getLoop(): PlaybackLoop | null {
    return useTakeStore.getState().take.display.loop ?? null;
  }

  /**
   * Repeat a passage, or stop repeating one. Mid-playback the run starts again
   * from where it is — or from the top of the new loop, when that is outside it.
   */
  setLoop(loop: PlaybackLoop | null): void {
    useTakeStore.getState().setPlaybackLoop(loop);
    if (this.state === 'playing') {
      this.pauseInternal(Math.round(this.clock.currentTakeMs()));
      const next = this.loopFor(useTakeStore.getState().take);
      if (next && (this.pausedPlayheadMs < next.startMs || this.pausedPlayheadMs >= next.endMs)) {
        this.pausedPlayheadMs = next.startMs;
      }
      this.startPlayback(null);
    }
    for (const listener of this.stateListeners) listener();
  }

  /** A take's loop as a run can play it: inside the take, and long enough to repeat. */
  private loopFor(take: Take): PlaybackLoop | null {
    const loop = take.display.loop;
    if (!loop) return null;
    const endMs = Math.min(loop.endMs, effectivePlaybackDurationMs(take));
    return endMs - loop.startMs >= MIN_LOOP_MS ? { startMs: loop.startMs, endMs } : null;
  }

  /** Carry a running playback on from here under a new rate. */
  private retimeRun(run: ClockRun): void {
    // The clock's unwrapped timeline starts again from here, so everything
    // already placed on it by pass keeps its place relative to the playhead:
    // the scheduler may be into the loop's next pass, and so may the next hold.
    const loop = this.playLoop;
    const passMs = loop ? loop.endMs - loop.startMs : 0;
    const playheadPass = loop ? loopPassAt(loop, this.clock.currentVirtualMs()) : 0;
    const gatePass =
      loop && this.trainingGate
        ? Math.round((this.trainingGateVirtualMs - this.trainingGate.atMs) / passMs)
        : 0;
    this.clock.retime(run);
    this.schedulePass = Math.max(0, this.schedulePass - playheadPass);
    if (loop && this.trainingGate) {
      this.trainingGateVirtualMs = this.trainingGate.atMs + (gatePass - playheadPass) * passMs;
    }
    if (this.metronome.isRunning) this.metronome.setGrid(this.takeGrid());
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pauseInternal(Math.round(this.clock.currentTakeMs()));
  }

  private pauseInternal(atMs: number): void {
    // A training wait is a pause that keeps its gate; every other pause drops
    // it, so resuming by hand never lands back on the same hold.
    if (!this.trainingWaiting) this.clearTrainingGate();
    this.clearScheduler();
    this.metronome.stop();
    audioEngine.allNotesOff();
    this.clock.pause();
    const duration = this.takeDurationMs();
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
        this.clearScheduler();
        this.metronome.stop();
        audioEngine.allNotesOff();
        this.clock.pause();
        this.pausedPlayheadMs = clamp(this.recordStartMs, 0, this.takeDurationMs());
        this.clock.seek(this.pausedPlayheadMs);
        useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
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
    const endMs = clamp(Math.round(this.clock.currentTakeMs()), this.recordStartMs, MAX_TAKE_MS);
    this.clearScheduler();
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
    // Stop backing-playback voices (and any still-ringing live notes).
    audioEngine.allNotesOff();
    this.clock.pause();
    this.pausedPlayheadMs = endMs;
    useTakeStore.getState().setPlayheadMs(endMs);
    for (const callback of this.onRecordingFinalized) callback();
  }

  /** Hard cleanup used by stop, failures, and lifecycle interruptions. */
  private stopEverything(): void {
    this.clearTrainingGate();
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
    this.clearTrainingGate();
    if (this.state === 'recording' || this.state === 'countIn') {
      this.stop();
    } else if (this.state === 'playing') {
      this.pause();
    } else if (this.state === 'scrubbing') {
      this.endScrub(this.scrubTimeMs);
    }
  }

  /**
   * Called when the user navigates between app tabs. Playback deliberately
   * survives the route change; recording does not, because its UI is gone.
   */
  handleNavigation(): void {
    // A wait left armed on another route would resume playback from a
    // keypress the user meant for that page's keyboard.
    this.clearTrainingGate();
    if (this.state === 'recording' || this.state === 'countIn') {
      this.stop();
    } else if (this.state === 'scrubbing') {
      this.endScrub(this.scrubTimeMs);
    }
  }

  private clearScheduler(): void {
    this.schedulerTickUnsub?.();
    this.schedulerTickUnsub = null;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /** Restore a playhead position (e.g. when a take is loaded). */
  restorePlayhead(takeMs: number): void {
    this.pausedPlayheadMs = clamp(Math.round(takeMs), 0, this.takeDurationMs());
    this.clock.seek(this.pausedPlayheadMs);
    for (const listener of this.stateListeners) listener();
  }

  /** Clamp both controller and stored playheads after destructive edits. */
  clampPlayheadToTake(): void {
    const duration = this.takeDurationMs();
    this.pausedPlayheadMs = clamp(this.pausedPlayheadMs, 0, duration);
    this.clock.seek(this.pausedPlayheadMs);
    useTakeStore.getState().setPlayheadMs(this.pausedPlayheadMs);
    for (const listener of this.stateListeners) listener();
  }

  private takeDurationMs(): number {
    return effectivePlaybackDurationMs(useTakeStore.getState().take);
  }
}

export const transportController = new TransportController();
