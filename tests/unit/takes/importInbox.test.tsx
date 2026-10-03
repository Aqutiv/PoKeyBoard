import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportDialogs } from '@/app/ImportDialogs';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';
import type { ImportPreview } from '@/features/takes/takesService';
import type { TransportState } from '@/features/transport/transportMachine';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useImportUiStore } from '@/state/useImportUiStore';
import { StorageError } from '@/utils/errors';

const mock = vi.hoisted(() => ({
  state: 'idle' as TransportState,
  listeners: new Set<() => void>(),
  commitImport: vi.fn<(preview: ImportPreview, strategy: 'copy' | 'replace') => Promise<Take>>(),
  navigate: vi.fn<(route: string) => void>(),
}));
vi.mock('@/features/takes/takesService', () => ({
  commitImport: (preview: ImportPreview, strategy: 'copy' | 'replace') =>
    mock.commitImport(preview, strategy),
}));
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    getState: () => mock.state,
    subscribeState: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
  },
}));
vi.mock('@/app/routerContext', () => ({
  useRouter: () => ({ route: 'takes', navigate: mock.navigate }),
}));

function previewOf(title: string, collision = false): ImportPreview {
  const take = createEmptyTake({
    title,
    durationMs: 400,
    notes: [{ id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 }],
  });
  return { parsed: { take, repairs: [] }, collision, fileName: `${title}.pokeyboard.json` };
}

function renderInbox() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <ImportDialogs />
    </I18nContext.Provider>,
  );
}

function openPreview(preview: ImportPreview) {
  act(() => useImportUiStore.getState().openPreview(preview));
}

function setTransport(state: TransportState) {
  act(() => {
    mock.state = state;
    for (const listener of mock.listeners) listener();
  });
}

const previewDialog = () => screen.queryByRole('dialog', { name: en.importDialog.title });

function resetStores() {
  useImportUiStore.setState({ preview: null, failure: null });
  useExportUiStore.setState({ requestedTakeId: null, sheetRequestedTakeId: null });
}

// Resolve the lazy inbox once, up front. Every test then mounts it at once,
// inside act(), so its effects (focus, the Escape listener) have run when the
// test looks, however busy the machine, and "nothing shows" means held, not
// still loading.
beforeAll(async () => {
  renderInbox();
  openPreview(previewOf('Warm-up'));
  await screen.findByRole('dialog', { name: en.importDialog.title }, { timeout: 5_000 });
  cleanup();
  resetStores();
});

beforeEach(() => {
  mock.state = 'idle';
  mock.commitImport.mockResolvedValue(createEmptyTake());
});

afterEach(() => {
  cleanup();
  resetStores();
  mock.commitImport.mockReset();
  mock.navigate.mockReset();
});

describe('the import inbox', () => {
  it('shows a preview opened from anywhere, its Import button focused', async () => {
    renderInbox();
    openPreview(previewOf('Imported scale'));
    const dialog = await screen.findByRole('dialog', { name: en.importDialog.title });
    expect(dialog).toHaveTextContent('Imported scale');
    expect(screen.getByRole('button', { name: en.importDialog.import })).toHaveFocus();
  });

  it('closes the preview on Cancel or Escape, importing nothing', async () => {
    renderInbox();
    openPreview(previewOf('One'));
    fireEvent.click(await screen.findByRole('button', { name: en.importDialog.cancel }));
    expect(previewDialog()).toBeNull();
    expect(useImportUiStore.getState().preview).toBeNull();

    openPreview(previewOf('Two'));
    await screen.findByRole('dialog', { name: en.importDialog.title });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(previewDialog()).toBeNull();
    expect(useImportUiStore.getState().preview).toBeNull();
    expect(mock.commitImport).not.toHaveBeenCalled();
  });

  it('commits with the strategy chosen, then opens the take on Play', async () => {
    let finish: (take: Take) => void = () => {};
    mock.commitImport.mockImplementation(
      () =>
        new Promise<Take>((resolve) => {
          finish = resolve;
        }),
    );
    renderInbox();
    const preview = previewOf('Clash', true);
    openPreview(preview);
    // A clash defaults to a copy; replacing takes a deliberate choice.
    expect(await screen.findByRole('radio', { name: en.importDialog.importAsCopy })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: en.importDialog.replaceExisting }));
    fireEvent.click(screen.getByRole('button', { name: en.importDialog.import }));

    // The preview closes at once; Play waits for the take to be stored.
    expect(previewDialog()).toBeNull();
    expect(mock.commitImport).toHaveBeenCalledExactlyOnceWith(preview, 'replace');
    expect(mock.navigate).not.toHaveBeenCalled();

    await act(async () => finish(preview.parsed.take));
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith('play'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('starts a preview that replaces an open one afresh, at Copy with Import focused', async () => {
    renderInbox();
    openPreview(previewOf('First clash', true));
    const replace = await screen.findByRole('radio', { name: en.importDialog.replaceExisting });
    fireEvent.click(replace);
    replace.focus();
    expect(replace).toBeChecked();

    // A newer pick lands while the first is still open.
    openPreview(previewOf('Second clash', true));
    expect(previewDialog()).toHaveTextContent('Second clash');
    // Replacing has to be chosen for the take it would replace, never inherited.
    expect(screen.getByRole('radio', { name: en.importDialog.importAsCopy })).toBeChecked();
    expect(screen.getByRole('button', { name: en.importDialog.import })).toHaveFocus();
  });

  // A recording only meets a preview that finished loading after the user left
  // Takes for Play; an export, whenever one was started first.
  it.each(['renderingSheet', 'renderingAudio', 'encodingAudio', 'countIn', 'recording'] as const)(
    'holds a preview while the transport is %s, then shows it',
    async (busy) => {
      renderInbox();
      setTransport(busy);
      openPreview(previewOf('Waiting'));
      expect(previewDialog()).toBeNull();
      // Held, not dropped.
      expect(useImportUiStore.getState().preview?.parsed.take.title).toBe('Waiting');

      setTransport('idle');
      expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toHaveTextContent(
        'Waiting',
      );
    },
  );

  it('holds a preview while an export dialog is open, then shows it', async () => {
    renderInbox();
    act(() => useExportUiStore.getState().openSheetExport('take-1'));
    openPreview(previewOf('Waiting'));
    expect(previewDialog()).toBeNull();
    // Swapping one export dialog for the other still holds it.
    act(() => useExportUiStore.getState().openExport('take-1'));
    expect(previewDialog()).toBeNull();

    act(() => useExportUiStore.getState().closeExport());
    expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toHaveTextContent(
      'Waiting',
    );
  });

  it('says why a commit failed in an alert, and lands nowhere', async () => {
    mock.commitImport.mockRejectedValue(new StorageError('Take write failed after retry'));
    renderInbox();
    openPreview(previewOf('Unsaved'));
    fireEvent.click(await screen.findByRole('button', { name: en.importDialog.import }));

    const alert = await screen.findByRole('alertdialog', { name: en.importDialog.title });
    expect(alert).toHaveAccessibleDescription(en.errors.storageFailed);
    const close = screen.getByRole('button', { name: en.importDialog.close });
    // The failure lands from the commit's promise, outside act(), so its focus
    // effect can follow the dialog by a tick.
    await waitFor(() => expect(close).toHaveFocus());
    expect(mock.navigate).not.toHaveBeenCalled();

    fireEvent.click(close);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useImportUiStore.getState().failure).toBeNull();
  });

  it('closes the failure alert with Escape too', async () => {
    renderInbox();
    act(() => useImportUiStore.getState().fail('generic'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(en.errors.generic);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useImportUiStore.getState().failure).toBeNull();
  });

  it('shows a failure before a preview that came in behind it', async () => {
    renderInbox();
    act(() => useImportUiStore.getState().fail('storageFull'));
    openPreview(previewOf('Next'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(en.errors.storageFull);
    expect(previewDialog()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.importDialog.close }));
    expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toHaveTextContent(
      'Next',
    );
  });
});
