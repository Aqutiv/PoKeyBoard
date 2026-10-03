import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
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
import { ShareLinkError } from '@/utils/errors';

const mock = vi.hoisted(() => ({
  state: 'idle' as TransportState,
  listeners: new Set<() => void>(),
  previewTakeLink: vi.fn<(version: number, data: string) => Promise<ImportPreview>>(),
  commitImport: vi.fn<(preview: ImportPreview, strategy: 'copy' | 'replace') => Promise<Take>>(),
  openLibraryTrack: vi.fn<(trackId: string, signal?: AbortSignal) => Promise<boolean>>(),
  revealHandoffInLibrary: vi.fn<(trackId: string) => void>(),
  navigate: vi.fn<(route: string) => void>(),
}));
vi.mock('@/features/takes/takesService', () => ({
  previewTakeLink: (version: number, data: string) => mock.previewTakeLink(version, data),
  commitImport: (preview: ImportPreview, strategy: 'copy' | 'replace') =>
    mock.commitImport(preview, strategy),
}));
vi.mock('@/features/library/libraryService', () => ({
  openLibraryTrack: (trackId: string, signal?: AbortSignal) =>
    mock.openLibraryTrack(trackId, signal),
}));
vi.mock('@/features/learn/handoff', () => ({
  revealHandoffInLibrary: (trackId: string) => mock.revealHandoffInLibrary(trackId),
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
  useRouter: () => ({ route: 'play', navigate: mock.navigate }),
}));

const CLASSIC = 'score-chopin-ballade-no-1-in-g-minor-op-23';

function previewOf(title: string): ImportPreview {
  const take = createEmptyTake({
    id: 'sender-take',
    title,
    durationMs: 400,
    notes: [{ id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 }],
  });
  return { parsed: { take, repairs: [] }, collision: false, fileName: 'link' };
}

function renderShell() {
  render(
    <StrictMode>
      <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
        <ImportDialogs />
      </I18nContext.Provider>
    </StrictMode>,
  );
}

/** Open the app on `hash`, as following a link from another app does. */
function openAppOn(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  renderShell();
}

/** Follow a link while the app is open: the address changes, and hashchange fires. */
function follow(hash: string) {
  act(() => {
    window.history.pushState(null, '', `/${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function setTransport(state: TransportState) {
  act(() => {
    mock.state = state;
    for (const listener of mock.listeners) listener();
  });
}

const previewDialog = () => screen.queryByRole('dialog', { name: en.importDialog.title });

function resetStores() {
  useImportUiStore.setState({ preview: null, failure: null, pendingLink: null });
  useExportUiStore.setState({ requestedTakeId: null, sheetRequestedTakeId: null });
}

// Resolve the lazy inbox up front, so a test waiting on a dialog waits on the
// link, not on a chunk.
beforeAll(async () => {
  renderShell();
  act(() => useImportUiStore.getState().openPreview(previewOf('Warm-up')));
  await screen.findByRole('dialog', { name: en.importDialog.title }, { timeout: 5_000 });
  cleanup();
  resetStores();
});

beforeEach(() => {
  mock.state = 'idle';
  mock.previewTakeLink.mockResolvedValue(previewOf('Linked take'));
  mock.openLibraryTrack.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  resetStores();
  vi.restoreAllMocks();
  mock.previewTakeLink.mockReset();
  mock.openLibraryTrack.mockReset();
  mock.revealHandoffInLibrary.mockReset();
  mock.navigate.mockReset();
  window.history.replaceState(null, '', '/');
});

describe('a take link', () => {
  it('opens its preview, clearing the address once even under StrictMode', async () => {
    window.history.replaceState(null, '', '/#/s/1.AbC');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderShell();

    // Cleared before anything is decoded: a reload or Back finds Play.
    expect(window.location.hash).toBe('#/play');
    expect(replaceState).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toHaveTextContent(
      'Linked take',
    );
    expect(mock.previewTakeLink).toHaveBeenCalledExactlyOnceWith(1, 'AbC');
    expect(useImportUiStore.getState().pendingLink).toBeNull();
  });

  it('opens a link followed while the app is open', async () => {
    renderShell();
    follow('#/s/1.XyZ');

    expect(window.location.hash).toBe('#/play');
    expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toBeVisible();
    expect(mock.previewTakeLink).toHaveBeenCalledExactlyOnceWith(1, 'XyZ');
  });

  it('never imports before the preview is answered', async () => {
    openAppOn('#/s/1.AbC');
    await screen.findByRole('dialog', { name: en.importDialog.title });
    expect(mock.commitImport).not.toHaveBeenCalled();
  });

  it('says why a damaged link would not open', async () => {
    mock.previewTakeLink.mockRejectedValue(new ShareLinkError('invalid', ['cut short']));
    openAppOn('#/s/1.AbC');

    const alert = await screen.findByRole('alertdialog', { name: en.importDialog.title });
    expect(alert).toHaveTextContent(en.errors.shareLinkInvalid);
    expect(previewDialog()).toBeNull();
  });

  it('says a link from a newer PoKeyBoard needs an update', async () => {
    mock.previewTakeLink.mockRejectedValue(new ShareLinkError('newer'));
    openAppOn('#/s/2.AbC');

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(en.errors.shareLinkNewer);
    expect(mock.previewTakeLink).toHaveBeenCalledWith(2, 'AbC');
  });

  it.each(['renderingSheet', 'renderingAudio', 'encodingAudio', 'countIn', 'recording'] as const)(
    'waits while the transport is %s, then opens',
    async (busy) => {
      setTransport(busy);
      openAppOn('#/s/1.AbC');

      // Out of the address at once, but held in the store.
      expect(window.location.hash).toBe('#/play');
      expect(useImportUiStore.getState().pendingLink).toEqual({
        kind: 'take',
        version: 1,
        data: 'AbC',
      });
      expect(mock.previewTakeLink).not.toHaveBeenCalled();

      setTransport('idle');
      expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toBeVisible();
      expect(mock.previewTakeLink).toHaveBeenCalledOnce();
    },
  );

  it('waits while an export dialog is open, then opens', async () => {
    renderShell();
    act(() => useExportUiStore.getState().openSheetExport('take-1'));
    follow('#/s/1.AbC');
    expect(mock.previewTakeLink).not.toHaveBeenCalled();

    act(() => useExportUiStore.getState().closeSheetExport());
    expect(await screen.findByRole('dialog', { name: en.importDialog.title })).toBeVisible();
  });
});

describe('a library link', () => {
  it('opens its track on Play', async () => {
    openAppOn('#/lib/a-beautiful-day');

    expect(window.location.hash).toBe('#/play');
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith('play'));
    expect(mock.openLibraryTrack).toHaveBeenCalledExactlyOnceWith(
      'a-beautiful-day',
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says so when it names no track the Library has, opening nothing', async () => {
    openAppOn('#/lib/no-such-piece');

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(en.errors.libraryLinkUnknown);
    expect(mock.openLibraryTrack).not.toHaveBeenCalled();
    expect(mock.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['cannot be fetched', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['does not open', () => Promise.resolve(false)],
  ])('shows a classic that %s in the Library, saying why', async (_case, outcome) => {
    mock.openLibraryTrack.mockImplementation(outcome);
    openAppOn(`#/lib/${CLASSIC}`);

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(en.errors.libraryLinkOffline);
    expect(mock.revealHandoffInLibrary).toHaveBeenCalledExactlyOnceWith(CLASSIC);
    expect(mock.navigate).toHaveBeenCalledExactlyOnceWith('library');
  });

  it('waits for an export, and is tried again if one starts while it opens', async () => {
    // The first open is still fetching when the export starts; it gives way.
    mock.openLibraryTrack.mockImplementationOnce(
      (_trackId, signal) =>
        new Promise<boolean>((resolve) => {
          signal?.addEventListener('abort', () => resolve(false));
        }),
    );
    openAppOn(`#/lib/${CLASSIC}`);
    await waitFor(() => expect(mock.openLibraryTrack).toHaveBeenCalledOnce());

    setTransport('renderingAudio');
    await waitFor(() =>
      expect(useImportUiStore.getState().pendingLink).toEqual({
        kind: 'library',
        trackId: CLASSIC,
      }),
    );
    expect(mock.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    setTransport('idle');
    await waitFor(() => expect(mock.navigate).toHaveBeenCalledWith('play'));
    expect(mock.openLibraryTrack).toHaveBeenCalledTimes(2);
    expect(mock.revealHandoffInLibrary).not.toHaveBeenCalled();
  });
});

describe('any other address', () => {
  it('is left to the router', () => {
    window.history.pushState(null, '', '/#/takes');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderShell();
    follow('#/library');

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/library');
    expect(useImportUiStore.getState().pendingLink).toBeNull();
  });
});
