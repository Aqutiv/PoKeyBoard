import { useCallback, useState } from 'react';
import { usePlayheadMs, useTransportState } from '@/app/hooks/useTransport';
import { useMessages } from '@/i18n/i18nContext';
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
  const m = useMessages();
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
    <div className="transport" role="group" aria-label={m.transport.groupLabel}>
      <div className="transport__buttons">
        <button
          type="button"
          className="transport__btn"
          aria-label={m.transport.returnToStart}
          onClick={() => transportController.returnToStart()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
            <path d="M6 5h2v14H6zM20 5v14L9 12z" />
          </svg>
        </button>
        <button
          type="button"
          className={`transport__btn transport__btn--record${recording ? ' is-active' : ''}`}
          aria-label={recording ? m.transport.recordActive : m.transport.recordInactive}
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
          aria-label={playing ? m.transport.pause : m.transport.play}
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
          aria-label={m.transport.stop}
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
            aria-label={m.transport.undoLastPass}
          >
            {m.transport.undoPass}
          </button>
        ) : null}

        <label className="transport__mode">
          <span className="visually-hidden">{m.transport.recordingMode}</span>
          <select
            value={recordMode}
            onChange={(event) => setRecordMode(event.target.value as RecordMode)}
            disabled={recording}
            aria-label={m.transport.recordingMode}
          >
            <option value="overdub">{m.transport.overdub}</option>
            <option value="replace">{m.transport.replace}</option>
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
        aria-label={m.transport.seekPosition}
        aria-valuetext={formatDurationMs(playheadMs, true)}
      />
      {state === 'countIn' ? (
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
