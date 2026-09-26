import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportProgress } from '@/audio/AudioExportService';
import { createEmptyTake } from '@/domain/noteEvents';
import { AudioExportDialog } from '@/features/export/AudioExportDialog';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';

const mock = vi.hoisted(() => ({
  onProgress: null as ((progress: ExportProgress) => void) | null,
  sendExportEvent: vi.fn<(event: string) => boolean>(() => true),
}));
vi.mock('@/audio/AudioExportService', () => ({
  audioExportService: {
    exportTake: (_take: unknown, _options: unknown, onProgress: (p: ExportProgress) => void) => {
      mock.onProgress = onProgress;
      return new Promise(() => undefined);
    },
    cancel: vi.fn(),
    deleteCachedExport: vi.fn(),
  },
  ExportCancelledError: class extends Error {},
  QUALITY_BITRATE: { share: 128, high: 192 },
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
vi.mock('@/state/useSettingsStore', () => ({
  useSettingsStore: (select: (state: { metronomeVolume: number }) => unknown) =>
    select({ metronomeVolume: 0.6 }),
}));

afterEach(() => {
  cleanup();
  act(() => useExportUiStore.getState().closeExport());
  mock.onProgress = null;
  mock.sendExportEvent.mockClear();
});

async function startExport() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <AudioExportDialog />
    </I18nContext.Provider>,
  );
  act(() => useExportUiStore.getState().openExport('take-1'));
  fireEvent.click(await screen.findByRole('button', { name: en.exportDialog.renderAudio }));
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
