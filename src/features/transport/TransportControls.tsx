import { useMediaQuery } from '@/app/hooks/useMediaQuery';
import { TooltipButton } from '@/ui/TooltipButton';
import { useCallback } from 'react';
import {
  useCountingIn,
  usePlayhead,
  usePlayheadMs,
  useTrainingWaiting,
  useTransportState,
} from '@/app/hooks/useTransport';
import { usePianoPlayable, usePianoReady } from '@/app/hooks/useAudioEngine';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { formatDurationMs } from '@/utils/timing';
import { LoopButton } from './LoopButton';
import { ModeMenu } from './ModeMenu';
import { practiceStyleOf } from './modes';
import { SpeedMenu } from './SpeedMenu';
import { canTransition } from './transportMachine';
import { transportController } from './transportController';
import { effectivePlaybackDurationMs } from './sustainPedal';
import './transport.css';

const strokeProps = {
  fill: 'currentColor',
  stroke: 'none',
} as const;

const atStart = (ms: number) => ms === 0;

/**
 * The time readout. On its own, so that the playhead, which changes ten times
 * a second during playback, renders this and not every control beside it.
 */
function PlayheadReadout({ durationMs }: { durationMs: number }) {
  const playheadMs = usePlayheadMs();
  return (
    <span className="transport__time" aria-live="off">
      {formatDurationMs(playheadMs, true)}
      {/* Dropped on a phone, where the row is needed for the mode select
          and the seek slider already shows how much take there is. */}
      <span className="transport__total"> / {formatDurationMs(durationMs, true)}</span>
    </span>
  );
}

/** The seek slider, rendered with the playhead for the same reason. */
function SeekSlider({
  durationMs,
  disabled,
  playing,
}: {
  durationMs: number;
  disabled: boolean;
  playing: boolean;
}) {
  const m = useMessages();
  const playheadMs = usePlayheadMs();
  const onSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (playing) transportController.pause();
      transportController.seek(value);
    },
    [playing],
  );
  return (
    <input
      type="range"
      className="transport__seek"
      min={0}
      max={Math.max(durationMs, 1)}
      step={10}
      value={Math.min(playheadMs, durationMs)}
      onChange={onSeek}
      disabled={disabled}
      aria-label={m.transport.seekPosition}
      aria-valuetext={formatDurationMs(playheadMs, true)}
    />
  );
}

export function TransportControls() {
  const m = useMessages();
  const desktop = useMediaQuery('(min-width: 900px) and (min-height: 501px)');
  // The style alone, so a change of hand does not render the controls.
  const practiceStyle = useSettingsStore((s) => practiceStyleOf(s.playbackMode));
  const state = useTransportState();
  // Play carries on through a change of piano; a recording waits for the new one.
  const pianoPlayable = usePianoPlayable();
  const pianoReady = usePianoReady();
  const playheadAtStart = usePlayhead(atStart);
  // A number, so a note recorded or an edit renders the controls only when it
  // changes how long the take plays.
  const durationMs = useTakeStore((s) => effectivePlaybackDurationMs(s.take));
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const canUndoPass = useTakeStore(
    (s) => s.lastPassNoteIds.length > 0 || s.lastPassPedalEvents.length > 0,
  );
  const undoLastPass = useTakeStore((s) => s.undoLastPass);
  const recordMode = useSettingsStore((s) => s.recordMode);
  const waitingForTraining = useTrainingWaiting();
  const runCountingIn = useCountingIn();
  // A recording's count-in, or a Keep-time run's: either way, the bars before
  // the music sets off.
  const countingIn = state === 'countIn' || runCountingIn;

  const recording = state === 'recording' || state === 'countIn';
  const playing = state === 'playing';

  const onRecord = useCallback(() => {
    if (recording) {
      transportController.stop();
      return;
    }
    if (!canTransition(state, 'RECORD')) return;
    if (recordMode === 'replace') {
      const { take } = useTakeStore.getState();
      const playhead = transportController.getPlayheadMs();
      // Replace also truncates notes that start before the playhead but ring
      // past it, so flag any note whose end crosses the playhead — matching the
      // trim in transportController.record().
      const willModify = take.notes.some((note) => note.startMs + note.durationMs > playhead);
      if (willModify) {
        const ok = window.confirm(m.transport.replaceConfirm);
        if (!ok) return;
      }
    }
    void transportController.record(recordMode);
  }, [recording, state, recordMode, m]);

  const onPlayPause = useCallback(() => {
    if (playing) transportController.pause();
    else transportController.play();
  }, [playing]);

  const seekDisabled = recording || durationMs === 0;

  const onUndoLastPass = useCallback(() => {
    undoLastPass();
    transportController.clampPlayheadToTake();
  }, [undoLastPass]);

  return (
    <div className="transport" role="group" aria-label={m.transport.groupLabel}>
      <div className="transport__buttons">
        <TooltipButton
          type="button"
          className="transport__btn"
          aria-label={m.transport.returnToStart}
          onClick={() => transportController.returnToStart()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </TooltipButton>
        <TooltipButton
          type="button"
          className={`transport__btn transport__btn--record${recording ? ' is-active' : ''}`}
          aria-label={recording ? m.transport.recordActive : m.transport.recordInactive}
          aria-pressed={recording}
          onClick={onRecord}
          disabled={!recording && !pianoReady}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <circle cx="12" cy="12" r="7" />
          </svg>
        </TooltipButton>
        <TooltipButton
          type="button"
          className="transport__btn transport__btn--play"
          aria-label={playing ? m.transport.pause : m.transport.play}
          onClick={onPlayPause}
          disabled={!playing && (!pianoPlayable || !canTransition(state, 'PLAY'))}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </TooltipButton>
        <TooltipButton
          type="button"
          className="transport__btn"
          aria-label={m.transport.stop}
          onClick={() => transportController.stop()}
          disabled={state === 'idle' && playheadAtStart}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </TooltipButton>

        <PlayheadReadout durationMs={durationMs} />

        {canUndoPass && !recording && !playing ? (
          <button
            type="button"
            className="transport__undo"
            onClick={onUndoLastPass}
            aria-label={m.transport.undoLastPass}
          >
            {m.transport.undoPass}
          </button>
        ) : null}

        <ModeMenu disabled={recording} desktop={desktop} />
      </div>

      <div className="transport__seek-row">
        <SeekSlider durationMs={durationMs} disabled={seekDisabled} playing={playing} />
        {/* Practice controls: playback only, so a recording pass leaves them be. */}
        <SpeedMenu disabled={recording || !hasNotes} />
        <LoopButton disabled={recording || !hasNotes} />
      </div>
      {desktop && practiceStyle !== null && !recording && !waitingForTraining && !countingIn ? (
        <p className="transport__status">
          {practiceStyle === 'wait' ? m.workflow.practiceHint : m.workflow.keepTimeHint}
        </p>
      ) : null}
      {waitingForTraining ? (
        <p className="transport__status transport__status--waiting" role="status">
          {m.transport.waitingForYou}
        </p>
      ) : null}
      {countingIn ? (
        <p className="transport__status" role="status">
          {m.transport.countIn}
        </p>
      ) : null}
      {state === 'recording' ? (
        <p className="transport__status transport__status--recording" role="status">
          {m.transport.recording}
        </p>
      ) : null}
      {!hasNotes && state === 'idle' ? (
        <p className="transport__status">{m.transport.emptyHint}</p>
      ) : null}
    </div>
  );
}
