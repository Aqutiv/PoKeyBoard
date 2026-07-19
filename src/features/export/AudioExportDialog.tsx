import { useCallback, useEffect, useRef, useState } from 'react';
import {
  audioExportService,
  ExportCancelledError,
  QUALITY_BITRATE,
  type ExportProgress,
  type ExportQuality,
  type ExportResult,
} from '@/audio/AudioExportService';
import {
  estimateRenderMemoryMB,
  estimateRenderSeconds,
  RENDER_WARN_MINUTES,
} from '@/audio/OfflineTakeRenderer';
import type { Take } from '@/domain/takeTypes';
import { getTakeForExport } from '@/features/takes/takesService';
import { transportController } from '@/features/transport/transportController';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useSettingsStore } from '@/state/useSettingsStore';
import { shareOrDownloadFile, downloadBlob } from '@/utils/download';
import { toErrorMessageKey } from '@/utils/errors';
import { formatDurationMs } from '@/utils/timing';
import './export.css';

type Phase =
  | { kind: 'options'; take: Take }
  | { kind: 'working'; take: Take; progress: ExportProgress }
  | { kind: 'ready'; take: Take; result: ExportResult; deliveredHow: string | null }
  | { kind: 'error'; take: Take | null; message: string };

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function stageLabel(m: Messages, stage: ExportProgress['stage']): string {
  switch (stage) {
    case 'saving':
      return m.exportDialog.stageSaving;
    case 'rendering':
      return m.exportDialog.stageRendering;
    case 'encoding':
      return m.exportDialog.stageEncoding;
  }
}

export function AudioExportDialog() {
  const m = useMessages();
  const requestedTakeId = useExportUiStore((s) => s.requestedTakeId);
  const closeExport = useExportUiStore((s) => s.closeExport);
  const metronomeVolume = useSettingsStore((s) => s.metronomeVolume);

  const [phase, setPhase] = useState<Phase | null>(null);
  const [lastRequestedId, setLastRequestedId] = useState<string | null>(null);
  const [quality, setQuality] = useState<ExportQuality>('share');
  const [includeMetronome, setIncludeMetronome] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Adjust-during-render: reset the dialog whenever the request changes.
  if (requestedTakeId !== lastRequestedId) {
    setLastRequestedId(requestedTakeId);
    setPhase(null);
    setPreviewUrl(null);
  }

  // Load the take when a request arrives.
  useEffect(() => {
    if (!requestedTakeId) return;
    let alive = true;
    void getTakeForExport(requestedTakeId).then((take) => {
      if (!alive) return;
      if (!take) {
        setPhase({ kind: 'error', take: null, message: m.exportDialog.errorCouldNotLoad });
      } else {
        setPhase({ kind: 'options', take });
      }
    });
    return () => {
      alive = false;
    };
  }, [requestedTakeId, m]);

  // Revoke preview object URLs.
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const close = useCallback(() => {
    if (phase?.kind === 'working') return; // must cancel first
    // Always release the transport, whatever phase we close from, so a
    // dismissed dialog can never leave it stuck in an export state.
    transportController.releaseExport();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    closeExport();
  }, [phase, closeExport]);

  // Escape closes (except mid-render, where Cancel is the way out).
  useEffect(() => {
    if (!requestedTakeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestedTakeId, close]);

  // Focus the primary action when the options phase appears.
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (phase?.kind === 'options') primaryRef.current?.focus();
  }, [phase?.kind]);

  const startRender = useCallback(
    (take: Take) => {
      if (!transportController.sendExportEvent('EXPORT_START')) {
        setPhase({ kind: 'error', take, message: m.exportDialog.errorStopPlayback });
        return;
      }
      setPhase({ kind: 'working', take, progress: { stage: 'saving', fraction: -1 } });
      audioExportService
        .exportTake(take, { quality, includeMetronome, metronomeVolume }, (progress) => {
          if (progress.stage === 'encoding') {
            transportController.sendExportEvent('RENDER_DONE');
          }
          setPhase((current) => (current?.kind === 'working' ? { ...current, progress } : current));
        })
        .then((result) => {
          if (result.fromCache) transportController.sendExportEvent('RENDER_DONE');
          transportController.sendExportEvent('ENCODE_DONE');
          setPhase({ kind: 'ready', take, result, deliveredHow: null });
        })
        .catch((error: unknown) => {
          transportController.sendExportEvent('EXPORT_CANCEL');
          if (error instanceof ExportCancelledError) {
            setPhase({ kind: 'options', take });
          } else {
            setPhase({ kind: 'error', take, message: m.errors[toErrorMessageKey(error)] });
          }
        });
    },
    [quality, includeMetronome, metronomeVolume, m],
  );

  const cancelRender = useCallback(() => {
    audioExportService.cancel();
  }, []);

  if (!requestedTakeId || !phase) return null;

  return (
    <div className="modal-backdrop" onClick={phase.kind === 'working' ? undefined : close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="export-dialog-title" className="modal__title">
          {m.exportDialog.title}
        </h2>

        {phase.kind === 'options' ? (
          <>
            <p className="export-summary">
              {m.exportDialog.summary({
                title: phase.take.title,
                duration: formatDurationMs(Math.round(estimateRenderSeconds(phase.take) * 1000)),
              })}
            </p>
            <fieldset className="export-options">
              <legend>{m.exportDialog.quality}</legend>
              <label>
                <input
                  type="radio"
                  name="quality"
                  checked={quality === 'share'}
                  onChange={() => setQuality('share')}
                />
                {m.exportDialog.shareable({ kbps: QUALITY_BITRATE.share })}
              </label>
              <label>
                <input
                  type="radio"
                  name="quality"
                  checked={quality === 'high'}
                  onChange={() => setQuality('high')}
                />
                {m.exportDialog.high({ kbps: QUALITY_BITRATE.high })}
              </label>
            </fieldset>
            <label className="export-metronome">
              <input
                type="checkbox"
                checked={includeMetronome}
                onChange={(event) => setIncludeMetronome(event.target.checked)}
              />
              {m.exportDialog.includeMetronome}
            </label>
            <p className="export-note">{m.exportDialog.reverbNote}</p>
            {estimateRenderSeconds(phase.take) > RENDER_WARN_MINUTES * 60 ? (
              <p className="export-warning" role="alert">
                {m.exportDialog.longTakeWarning({ mb: estimateRenderMemoryMB(phase.take) })}
              </p>
            ) : null}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={close}>
                {m.exportDialog.cancel}
              </button>
              <button
                ref={primaryRef}
                type="button"
                className="btn btn--primary"
                onClick={() => startRender(phase.take)}
              >
                {m.exportDialog.renderAudio}
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'working' ? (
          <>
            <p className="export-stage" role="status">
              {stageLabel(m, phase.progress.stage)}
              {phase.progress.fraction >= 0
                ? ` ${Math.round(phase.progress.fraction * 100)}%`
                : null}
            </p>
            <div
              className={`export-bar${phase.progress.fraction < 0 ? ' export-bar--indeterminate' : ''}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                phase.progress.fraction >= 0 ? Math.round(phase.progress.fraction * 100) : undefined
              }
            >
              <div
                className="export-bar__fill"
                style={
                  phase.progress.fraction >= 0
                    ? { width: `${Math.round(phase.progress.fraction * 100)}%` }
                    : undefined
                }
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={cancelRender}>
                {m.exportDialog.cancel}
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'ready' ? (
          <>
            <p className="export-stage" role="status">
              {m.exportDialog.ready({
                fromCache: phase.result.fromCache,
                size: formatBytes(phase.result.sizeBytes),
                duration: formatDurationMs(phase.result.durationMs),
              })}
            </p>
            {phase.deliveredHow ? <p className="export-note">{phase.deliveredHow}</p> : null}
            {previewUrl ? <audio className="export-preview" controls src={previewUrl} /> : null}
            <div className="modal__actions modal__actions--wrap">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (!previewUrlRef.current) {
                    previewUrlRef.current = URL.createObjectURL(phase.result.blob);
                  }
                  setPreviewUrl(previewUrlRef.current);
                }}
              >
                {m.exportDialog.playPreview}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void audioExportService
                    .deleteCachedExport(phase.take.id)
                    .then(() => setPhase({ ...phase, deliveredHow: m.exportDialog.cachedDeleted }));
                }}
              >
                {m.exportDialog.deleteCached}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  downloadBlob(phase.result.blob, phase.result.fileName);
                  setPhase({ ...phase, deliveredHow: m.takes.downloaded });
                }}
              >
                {m.exportDialog.downloadMp3}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const file = new File([phase.result.blob], phase.result.fileName, {
                    type: 'audio/mpeg',
                  });
                  void shareOrDownloadFile(file).then((how) => {
                    if (how === 'cancelled') return;
                    setPhase({
                      ...phase,
                      deliveredHow:
                        how === 'shared'
                          ? m.exportDialog.delivered
                          : m.exportDialog.deliveredNoShare,
                    });
                  });
                }}
              >
                {m.exportDialog.shareAudio}
              </button>
              <button type="button" className="btn" onClick={close}>
                {m.exportDialog.close}
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'error' ? (
          <>
            <p className="export-warning" role="alert">
              {phase.message}
            </p>
            <div className="modal__actions">
              {phase.take ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPhase({ kind: 'options', take: phase.take as Take })}
                >
                  {m.exportDialog.back}
                </button>
              ) : null}
              <button type="button" className="btn" onClick={close}>
                {m.exportDialog.close}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
