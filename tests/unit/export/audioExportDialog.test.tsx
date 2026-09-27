import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportOptions, ExportProgress, ExportResult } from '@/audio/AudioExportService';
import { createEmptyTake } from '@/domain/noteEvents';
import { AudioExportDialog } from '@/features/export/AudioExportDialog';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

const mock = vi.hoisted(() => ({
  onProgress: null as ((progress: ExportProgress) => void) | null,
  options: null as ExportOptions | null,
  finish: null as ((result: ExportResult) => void) | null,
  sendExportEvent: vi.fn<(event: string) => boolean>(() => true),
}));
vi.mock('@/audio/AudioExportService', () => ({
  audioExportService: {
    exportTake: (
      _take: unknown,
      options: ExportOptions,
      onProgress: (p: ExportProgress) => void,
    ) => {
      mock.onProgress = onProgress;
      mock.options = options;
      return new Promise<ExportResult>((resolve) => {
        mock.finish = resolve;
      });
    },
    cancel: vi.fn(),
    deleteCachedExport: vi.fn(),
  },
  ExportCancelledError: class extends Error {},
}));
vi.mock('@/audio/OfflineTakeRenderer', () => ({
  estimateRenderMemoryMB: () => 10,
  estimateRenderSeconds: () => 60,
  RENDER_WARN_MINUTES: 8,
}));
vi.mock('@/features/takes/takesService', () => ({
  getTakeForExport: async () => createEmptyTake({ title: 'A take' }),
}));
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    sendExportEvent: (event: string) => mock.sendExportEvent(event),
    releaseExport: vi.fn(),
  },
}));
beforeEach(() => {
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

afterEach(() => {
  cleanup();
  act(() => useExportUiStore.getState().closeExport());
  mock.onProgress = null;
  mock.options = null;
  mock.finish = null;
  mock.sendExportEvent.mockClear();
});

async function openDialog() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <AudioExportDialog />
    </I18nContext.Provider>,
  );
  act(() => useExportUiStore.getState().openExport('take-1'));
  await screen.findByRole('button', { name: en.exportDialog.renderAudio });
}

async function startExport() {
  await openDialog();
  fireEvent.click(screen.getByRole('button', { name: en.exportDialog.renderAudio }));
  expect(mock.onProgress).not.toBeNull();
}

function progress(stage: ExportProgress['stage'], fraction: number) {
  act(() => mock.onProgress!({ stage, fraction }));
}

const fill = () => document.querySelector('.export-bar__fill');

describe('the audio export progress bar', () => {
  it('shows how far the render has got once it can tell', async () => {
    await startExport();
    progress('rendering', -1);
    const bar = screen.getByRole('progressbar', { name: en.exportDialog.stageRendering });
    expect(bar.classList.contains('export-bar--indeterminate')).toBe(true);
    expect(bar.getAttribute('aria-valuenow')).toBeNull();

    progress('rendering', 0.42);
    expect(bar.classList.contains('export-bar--indeterminate')).toBe(false);
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(document.querySelector('.export-stage')?.textContent).toBe(
      `${en.exportDialog.stageRendering} 42%`,
    );
    // Only the stage is announced, not every percent on the way.
    expect(screen.getByRole('status').textContent).toBe(en.exportDialog.stageRendering);
  });

  it('starts each bar afresh rather than sweeping back across it', async () => {
    await startExport();
    progress('rendering', -1);
    const sliding = fill();
    progress('rendering', 0.42);
    const rendering = fill();
    expect(rendering).not.toBe(sliding);
    progress('rendering', 0.43);
    // Small steps keep the element, and its easing.
    expect(fill()).toBe(rendering);
    progress('encoding', 0);
    expect(fill()).not.toBe(rendering);
    expect(mock.sendExportEvent).toHaveBeenCalledWith('RENDER_DONE');
  });

  it('holds a finished render’s full bar a moment before compressing takes over', async () => {
    await startExport();
    vi.useFakeTimers();
    try {
      progress('rendering', 0.65);
      // The export says the render is done and compressing has begun in one go.
      progress('rendering', 1);
      progress('encoding', 0);
      progress('encoding', 0.05);
      const stage = () => document.querySelector('.export-stage')?.textContent;
      expect(stage()).toBe(`${en.exportDialog.stageRendering} 100%`);
      // Only the bar waits: the transport moves on at once.
      expect(mock.sendExportEvent).toHaveBeenCalledWith('RENDER_DONE');
      act(() => vi.advanceTimersByTime(249));
      expect(stage()).toBe(`${en.exportDialog.stageRendering} 100%`);
      act(() => vi.advanceTimersByTime(1));
      // Then straight to where compressing has got by now.
      expect(stage()).toBe(`${en.exportDialog.stageEncoding} 5%`);
    } finally {
      vi.useRealTimers();
    }
  });
});

const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

describe('the audio export’s choices', () => {
  it('offers FLAC beside MP3, with bit depths for its quality, and remembers each', async () => {
    await openDialog();
    const d = en.exportDialog;
    expect(radio(d.formatMp3).checked).toBe(true);
    expect(radio(d.shareable({ kbps: 128 })).checked).toBe(true);
    expect(radio(d.loudnessNormalized).checked).toBe(true);

    fireEvent.click(radio(d.formatFlac));
    expect(useSettingsStore.getState().audioExportFormat).toBe('flac');
    expect(screen.queryByRole('radio', { name: d.shareable({ kbps: 128 }) })).toBeNull();
    expect(radio(d.bitsStandard({ bits: 16 })).checked).toBe(true);
    fireEvent.click(radio(d.bitsStudio({ bits: 24 })));
    expect(useSettingsStore.getState().audioExportFlacBits).toBe(24);
    fireEvent.click(radio(d.loudnessAsPlayed));
    expect(useSettingsStore.getState().audioExportLoudness).toBe('asPlayed');

    // Each format keeps its own quality.
    fireEvent.click(radio(d.formatMp3));
    expect(radio(d.shareable({ kbps: 128 })).checked).toBe(true);
    fireEvent.click(radio(d.high({ kbps: 192 })));
    fireEvent.click(radio(d.formatFlac));
    expect(radio(d.bitsStudio({ bits: 24 })).checked).toBe(true);
    expect(useSettingsStore.getState().audioExportMp3Kbps).toBe(192);
  });

  it('exports with the choices remembered from last time, the metronome off', async () => {
    useSettingsStore.setState({
      audioExportFormat: 'flac',
      audioExportFlacBits: 24,
      audioExportLoudness: 'asPlayed',
    });
    await startExport();
    expect(mock.options).toEqual({
      encoding: { format: 'flac', bits: 24 },
      includeMetronome: false,
      metronomeVolume: SETTINGS_DEFAULTS.metronomeVolume,
      loudness: 'asPlayed',
    });
  });

  it('names the format it downloads, and offers to delete only a cached file', async () => {
    const finish = async (result: Partial<ExportResult>) => {
      await startExport();
      await act(async () =>
        mock.finish!({
          blob: new Blob(['x']),
          fileName: 'PoKeyBoard - A take.flac',
          format: 'flac',
          durationMs: 1000,
          sizeBytes: 1,
          fromCache: false,
          cached: false,
          ...result,
        }),
      );
    };
    await finish({ format: 'flac', cached: false });
    expect(
      screen.getByRole('button', { name: en.exportDialog.download({ format: 'FLAC' }) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.exportDialog.deleteCached })).toBeNull();
    cleanup();
    act(() => useExportUiStore.getState().closeExport());

    await finish({ format: 'mp3', fileName: 'PoKeyBoard - A take.mp3', cached: true });
    expect(
      screen.getByRole('button', { name: en.exportDialog.download({ format: 'MP3' }) }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.exportDialog.deleteCached })).toBeInTheDocument();
  });
});
