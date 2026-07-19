import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Take } from '@/domain/takeTypes';
import { normalizePaperSize, type SheetGrid } from '@/features/notation/sheetLayout';
import { drawSheetPage } from '@/features/notation/sheetRenderer';
import { getTakeForExport } from '@/features/takes/takesService';
import { transportController } from '@/features/transport/transportController';
import { useI18n } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useSettingsStore } from '@/state/useSettingsStore';
import { downloadBlob, shareOrDownloadFile } from '@/utils/download';
import { toErrorMessageKey } from '@/utils/errors';
import {
  generateSheetPdf,
  layoutTakeSheet,
  MAX_SHEET_PAGES,
  SheetCancelledError,
  SheetTooManyPagesError,
  type SheetPdfProgress,
  type SheetPdfResult,
} from './sheetPdfService';
import './export.css';

type Phase =
  | { kind: 'options'; take: Take }
  | { kind: 'working'; take: Take; progress: SheetPdfProgress }
  | { kind: 'ready'; take: Take; result: SheetPdfResult; deliveredHow: string | null }
  | { kind: 'error'; take: Take | null; message: string };

const PREVIEW_CSS_WIDTH = 250;

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function stageLabel(m: Messages, progress: SheetPdfProgress): string {
  switch (progress.stage) {
    case 'layout':
      return m.sheetDialog.workingLayout;
    case 'rendering':
      return m.sheetDialog.workingPage({
        page: progress.page ?? 1,
        pages: progress.pageCount ?? 1,
      });
    case 'assembling':
      return m.sheetDialog.workingAssemble;
  }
}

export function SheetExportDialog() {
  const { m, locale } = useI18n();
  const requestedTakeId = useExportUiStore((s) => s.sheetRequestedTakeId);
  const closeSheetExport = useExportUiStore((s) => s.closeSheetExport);
  // Guard against a corrupt/restored setting so the radios and layout agree.
  const paper = normalizePaperSize(useSettingsStore((s) => s.sheetPaperSize));
  const setSheetPaperSize = useSettingsStore((s) => s.setSheetPaperSize);

  const [phase, setPhase] = useState<Phase | null>(null);
  const [lastRequestedId, setLastRequestedId] = useState<string | null>(null);
  const [grid, setGrid] = useState<SheetGrid>('1/16');
  const abortRef = useRef<AbortController | null>(null);

  // Adjust-during-render: reset the dialog whenever the request changes.
  if (requestedTakeId !== lastRequestedId) {
    setLastRequestedId(requestedTakeId);
    setPhase(null);
  }

  // Load the take when a request arrives.
  useEffect(() => {
    if (!requestedTakeId) return;
    let alive = true;
    void getTakeForExport(requestedTakeId)
      .then((take) => {
        if (!alive) return;
        if (!take) {
          setPhase({ kind: 'error', take: null, message: m.sheetDialog.errorCouldNotLoad });
        } else {
          setGrid(take.display.quantization === 'off' ? '1/16' : take.display.quantization);
          setPhase({ kind: 'options', take });
        }
      })
      .catch(() => {
        // Flushing the active take before export can reject (e.g. quota full);
        // surface it instead of leaving the dialog stuck on the loading phase.
        if (alive)
          setPhase({ kind: 'error', take: null, message: m.sheetDialog.errorCouldNotLoad });
      });
    return () => {
      alive = false;
    };
  }, [requestedTakeId, m]);

  const close = useCallback(() => {
    if (phase?.kind === 'working') return; // must cancel first
    transportController.releaseExport();
    closeSheetExport();
  }, [phase, closeSheetExport]);

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

  const formatSubtitle = useCallback(
    (take: Take): string => {
      const date = new Date(take.createdAt);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
    },
    [locale],
  );

  // Live layout for the preview and the page estimate.
  const layout = useMemo(() => {
    if (phase?.kind !== 'options') return null;
    return layoutTakeSheet(phase.take, paper, grid, formatSubtitle(phase.take));
  }, [phase, paper, grid, formatSubtitle]);

  // Draw page 1 into the preview canvas.
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!layout) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const page = layout.pages[0];
    if (!page) return;
    const cssHeight = Math.round(
      (PREVIEW_CSS_WIDTH * page.metrics.pageHeightPt) / page.metrics.pageWidthPt,
    );
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(PREVIEW_CSS_WIDTH * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${PREVIEW_CSS_WIDTH}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(
      (PREVIEW_CSS_WIDTH * dpr) / page.metrics.pageWidthPt,
      0,
      0,
      (PREVIEW_CSS_WIDTH * dpr) / page.metrics.pageWidthPt,
      0,
      0,
    );
    drawSheetPage(ctx, page);
  }, [layout]);

  const startGenerate = useCallback(
    (take: Take) => {
      if (!transportController.sendSheetExportEvent('SHEET_EXPORT_START')) {
        setPhase({ kind: 'error', take, message: m.exportDialog.errorStopPlayback });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: 'working', take, progress: { stage: 'layout', fraction: -1 } });
      generateSheetPdf(
        take,
        { paper, grid, subtitle: formatSubtitle(take) },
        (progress) => {
          setPhase((current) => (current?.kind === 'working' ? { ...current, progress } : current));
        },
        controller.signal,
      )
        .then((result) => {
          abortRef.current = null;
          transportController.sendSheetExportEvent('SHEET_EXPORT_DONE');
          setPhase({ kind: 'ready', take, result, deliveredHow: null });
        })
        .catch((error: unknown) => {
          abortRef.current = null;
          transportController.sendSheetExportEvent('SHEET_EXPORT_CANCEL');
          if (error instanceof SheetCancelledError) {
            setPhase({ kind: 'options', take });
          } else if (error instanceof SheetTooManyPagesError) {
            setPhase({
              kind: 'error',
              take,
              message: m.sheetDialog.tooManyPages({ pages: error.pageCount, max: MAX_SHEET_PAGES }),
            });
          } else {
            setPhase({ kind: 'error', take, message: m.errors[toErrorMessageKey(error)] });
          }
        });
    },
    [paper, grid, formatSubtitle, m],
  );

  const cancelGenerate = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (!requestedTakeId || !phase) return null;

  const tooManyPages = layout !== null && layout.pages.length > MAX_SHEET_PAGES;

  return (
    <div className="modal-backdrop" onClick={phase.kind === 'working' ? undefined : close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="sheet-dialog-title" className="modal__title">
          {m.sheetDialog.title}
        </h2>

        {phase.kind === 'options' ? (
          <>
            <p className="export-summary">
              {m.sheetDialog.summary({
                title: phase.take.title,
                measures: layout?.measureCount ?? 0,
              })}
            </p>
            <fieldset className="export-options">
              <legend>{m.sheetDialog.paperSize}</legend>
              <label>
                <input
                  type="radio"
                  name="sheet-paper"
                  checked={paper === 'a4'}
                  onChange={() => setSheetPaperSize('a4')}
                />
                {m.sheetDialog.paperA4}
              </label>
              <label>
                <input
                  type="radio"
                  name="sheet-paper"
                  checked={paper === 'letter'}
                  onChange={() => setSheetPaperSize('letter')}
                />
                {m.sheetDialog.paperLetter}
              </label>
            </fieldset>
            <fieldset className="export-options">
              <legend>{m.sheetDialog.grid}</legend>
              <label>
                <input
                  type="radio"
                  name="sheet-grid"
                  checked={grid === '1/8'}
                  onChange={() => setGrid('1/8')}
                />
                {m.sheetDialog.grid8}
              </label>
              <label>
                <input
                  type="radio"
                  name="sheet-grid"
                  checked={grid === '1/16'}
                  onChange={() => setGrid('1/16')}
                />
                {m.sheetDialog.grid16}
              </label>
            </fieldset>
            <p className="export-note">{m.sheetDialog.gridHint}</p>
            <div className="sheet-preview">
              <canvas
                ref={previewCanvasRef}
                className="sheet-preview__canvas"
                aria-label={m.sheetDialog.previewLabel}
              />
              <p className="sheet-preview__label">
                {m.sheetDialog.previewLabel} ·{' '}
                {m.sheetDialog.pageEstimate({ pages: layout?.pages.length ?? 1 })}
              </p>
            </div>
            {tooManyPages && layout ? (
              <p className="export-warning" role="alert">
                {m.sheetDialog.tooManyPages({ pages: layout.pages.length, max: MAX_SHEET_PAGES })}
              </p>
            ) : null}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={close}>
                {m.sheetDialog.cancel}
              </button>
              <button
                ref={primaryRef}
                type="button"
                className="btn btn--primary"
                disabled={tooManyPages}
                onClick={() => startGenerate(phase.take)}
              >
                {m.sheetDialog.generate}
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'working' ? (
          <>
            <p className="export-stage" role="status">
              {stageLabel(m, phase.progress)}
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
              <button type="button" className="btn" onClick={cancelGenerate}>
                {m.sheetDialog.cancel}
              </button>
            </div>
          </>
        ) : null}

        {phase.kind === 'ready' ? (
          <>
            <p className="export-stage" role="status">
              {m.sheetDialog.ready({
                pages: phase.result.pageCount,
                size: formatBytes(phase.result.sizeBytes),
              })}
            </p>
            {phase.deliveredHow ? <p className="export-note">{phase.deliveredHow}</p> : null}
            <div className="modal__actions modal__actions--wrap">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  downloadBlob(phase.result.blob, phase.result.fileName);
                  setPhase({ ...phase, deliveredHow: m.takes.downloaded });
                }}
              >
                {m.sheetDialog.downloadPdf}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const file = new File([phase.result.blob], phase.result.fileName, {
                    type: 'application/pdf',
                  });
                  void shareOrDownloadFile(file).then((how) => {
                    if (how === 'cancelled') return;
                    setPhase({
                      ...phase,
                      deliveredHow:
                        how === 'shared' ? m.sheetDialog.delivered : m.sheetDialog.deliveredNoShare,
                    });
                  });
                }}
              >
                {m.sheetDialog.sharePdf}
              </button>
              <button type="button" className="btn" onClick={close}>
                {m.sheetDialog.close}
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
                  {m.sheetDialog.back}
                </button>
              ) : null}
              <button type="button" className="btn" onClick={close}>
                {m.sheetDialog.close}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
