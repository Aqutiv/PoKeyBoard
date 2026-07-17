import { useCallback, useState } from 'react';
import { usePlayheadMs, useTransportState } from '@/app/hooks/useTransport';
import { useTakeStore } from '@/state/useTakeStore';
import { formatDurationMs } from '@/utils/timing';
import { canTransition } from './transportMachine';
import { transportController, type RecordMode } from './transportController';
import './transport.css';

const strokeProps = {
  fill: 'currentColor',
  stroke: 'none',
} as const;

export function TransportControls() {
  const state = useTransportState();
  const playheadMs = usePlayheadMs();
  const durationMs = useTakeStore((s) => s.take.durationMs);
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const canUndoPass = useTakeStore((s) => s.lastPassNoteIds.length > 0);
  const undoLastPass = useTakeStore((s) => s.undoLastPass);
  const [recordMode, setRecordMode] = useState<RecordMode>('overdub');

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
      const willRemove = take.notes.some((note) => note.startMs >= playhead);
      if (willRemove) {
        const ok = window.confirm(
          'Replace mode deletes every note from the playhead onward before recording. Continue?',
        );
        if (!ok) return;
      }
    }
    void transportController.record(recordMode);
  }, [recording, state, recordMode]);

  const onPlayPause = useCallback(() => {
    if (playing) transportController.pause();
    else transportController.play();
  }, [playing]);

  const onSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (playing) transportController.pause();
      transportController.seek(value);
    },
    [playing],
  );

  const seekDisabled = recording || durationMs === 0;

  return (
    <div className="transport" role="group" aria-label="Transport">
      <div className="transport__buttons">
        <button
          type="button"
          className="transport__btn"
          aria-label="Return to beginning"
          onClick={() => transportController.returnToStart()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </button>
        <button
          type="button"
          className={`transport__btn transport__btn--record${recording ? ' is-active' : ''}`}
          aria-label={recording ? 'Record, active — stop recording' : 'Record, inactive'}
          aria-pressed={recording}
          onClick={onRecord}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <circle cx="12" cy="12" r="7" />
          </svg>
        </button>
        <button
          type="button"
          className="transport__btn transport__btn--play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onPlayPause}
          disabled={!playing && !canTransition(state, 'PLAY')}
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
        </button>
        <button
          type="button"
          className="transport__btn"
          aria-label="Stop"
          onClick={() => transportController.stop()}
          disabled={state === 'idle' && playheadMs === 0}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>

        <span className="transport__time" aria-live="off">
          {formatDurationMs(playheadMs, true)} / {formatDurationMs(durationMs, true)}
        </span>

        {canUndoPass && !recording && !playing ? (
          <button
            type="button"
            className="transport__undo"
            onClick={() => undoLastPass()}
            aria-label="Undo last recording pass"
          >
            Undo pass
          </button>
        ) : null}

        <label className="transport__mode">
          <span className="visually-hidden">Recording mode</span>
          <select
            value={recordMode}
            onChange={(event) => setRecordMode(event.target.value as RecordMode)}
            disabled={recording}
            aria-label="Recording mode"
          >
            <option value="overdub">Overdub</option>
            <option value="replace">Replace</option>
          </select>
        </label>
      </div>

      <input
        type="range"
        className="transport__seek"
        min={0}
        max={Math.max(durationMs, 1)}
        step={10}
        value={Math.min(playheadMs, durationMs)}
        onChange={onSeek}
        disabled={seekDisabled}
        aria-label="Seek position"
        aria-valuetext={formatDurationMs(playheadMs, true)}
      />
      {state === 'countIn' ? (
        <p className="transport__status" role="status">
          Count-in…
        </p>
      ) : null}
      {state === 'recording' ? (
        <p className="transport__status transport__status--recording" role="status">
          ● Recording
        </p>
      ) : null}
      {!hasNotes && state === 'idle' ? (
        <p className="transport__status">Press record and play something to capture a take.</p>
      ) : null}
    </div>
  );
}
