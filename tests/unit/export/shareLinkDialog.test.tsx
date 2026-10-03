import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryLinkUrl, takeLinkUrl } from '@/app/hashLinks';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';
import {
  LONG_LINK_CHARS,
  MAX_LINK_CHARS,
  ShareLinkDialog,
} from '@/features/export/ShareLinkDialog';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';

const mock = vi.hoisted(() => ({
  take: null as Take | null,
  payload: '1.AbC',
  encodeTakeLink: vi.fn<(take: Take) => string>(),
  shareOrDownloadFile: vi.fn<(file: File) => Promise<'shared' | 'downloaded' | 'cancelled'>>(),
}));
vi.mock('@/features/takes/takesService', () => ({
  snapshotTake: async () => mock.take,
  takeToJsonFile: (take: Take) => new File(['{}'], `${take.title}.pokeyboard.json`),
}));
vi.mock('@/domain/takeLink', () => ({
  encodeTakeLink: (take: Take) => mock.encodeTakeLink(take),
}));
vi.mock('@/utils/download', () => ({
  shareOrDownloadFile: (file: File) => mock.shareOrDownloadFile(file),
}));

const writeText = vi.fn<(text: string) => Promise<void>>();
const share = vi.fn<(data: ShareData) => Promise<void>>();

function setNavigator(name: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

function openDialog(takeId = 'take-1') {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <ShareLinkDialog />
    </I18nContext.Provider>,
  );
  act(() => useExportUiStore.getState().openLinkShare(takeId));
}

const dialog = () => screen.findByRole('dialog', { name: en.share.linkTitle });
const field = () => screen.findByRole<HTMLInputElement>('textbox', { name: en.share.linkField });

beforeEach(() => {
  mock.take = createEmptyTake({ id: 'take-1', title: 'Evening scale' });
  mock.encodeTakeLink.mockImplementation(() => mock.payload);
  mock.shareOrDownloadFile.mockResolvedValue('downloaded');
  writeText.mockResolvedValue(undefined);
  share.mockResolvedValue(undefined);
  setNavigator('clipboard', { writeText });
  setNavigator('share', undefined);
});

afterEach(() => {
  cleanup();
  act(() => useExportUiStore.getState().closeLinkShare());
  mock.payload = '1.AbC';
  mock.encodeTakeLink.mockReset();
  mock.shareOrDownloadFile.mockReset();
  writeText.mockReset();
  share.mockReset();
});

describe('the share link dialog', () => {
  it('shows the take’s link in a read-only field, selected on focus', async () => {
    openDialog();
    const input = await field();

    expect(input).toHaveValue(takeLinkUrl('1.AbC'));
    expect(input).toHaveAttribute('readonly');
    act(() => input.focus());
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(await dialog()).toHaveTextContent(en.share.linkPrivacy);
    expect(mock.encodeTakeLink).toHaveBeenCalledWith(mock.take);
  });

  it('copies the link', async () => {
    openDialog();
    await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkCopy }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(takeLinkUrl('1.AbC'));
    expect(await screen.findByRole('status')).toHaveTextContent(en.share.linkCopied);
  });

  it('selects the link and says how to copy it when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    openDialog();
    const input = await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkCopy }));

    expect(await screen.findByRole('status')).toHaveTextContent(en.share.linkCopyManual);
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('says how to copy it where there is no clipboard at all', async () => {
    setNavigator('clipboard', undefined);
    openDialog();
    const input = await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkCopy }));

    expect(await screen.findByRole('status')).toHaveTextContent(en.share.linkCopyManual);
    expect(input).toHaveFocus();
  });

  it('offers Share… only where the browser can share', async () => {
    openDialog();
    await field();
    expect(screen.queryByRole('button', { name: en.share.linkShare })).toBeNull();
    cleanup();
    act(() => useExportUiStore.getState().closeLinkShare());

    setNavigator('share', share);
    openDialog();
    await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkShare }));
    expect(share).toHaveBeenCalledExactlyOnceWith({
      title: 'Evening scale',
      url: takeLinkUrl('1.AbC'),
    });
  });

  it('warns that some apps cut a long link, but still offers it', async () => {
    const base = takeLinkUrl('1.').length;
    mock.payload = `1.${'A'.repeat(LONG_LINK_CHARS - base)}`;
    openDialog();
    expect((await field()).value).toHaveLength(LONG_LINK_CHARS);
    expect(screen.queryByText(/some apps cut long links/)).toBeNull();
    cleanup();
    act(() => useExportUiStore.getState().closeLinkShare());

    mock.payload = `1.${'A'.repeat(LONG_LINK_CHARS + 1 - base)}`;
    openDialog();
    expect((await field()).value).toHaveLength(LONG_LINK_CHARS + 1);
    expect(await dialog()).toHaveTextContent(
      en.share.linkLong({ characters: (LONG_LINK_CHARS + 1).toLocaleString('en-US') }),
    );
  });

  it('offers only the file for a take too long for a link', async () => {
    const base = takeLinkUrl('1.').length;
    mock.payload = `1.${'A'.repeat(MAX_LINK_CHARS + 1 - base)}`;
    openDialog();

    expect(await dialog()).toHaveTextContent(en.share.linkTooLong);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: en.share.linkCopy })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkSendFile }));
    expect(mock.shareOrDownloadFile).toHaveBeenCalledOnce();
    expect(mock.shareOrDownloadFile.mock.calls[0]?.[0].name).toBe('Evening scale.pokeyboard.json');
  });

  it('sends the take as a file instead, and says how it went', async () => {
    openDialog();
    await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkSendFile }));

    expect(mock.shareOrDownloadFile).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent(en.takes.downloaded);
  });

  it('gives a Library track its short link, naming the piece', async () => {
    mock.take = createEmptyTake({ id: 'library:fur-elise', title: 'Für Elise' });
    openDialog('library:fur-elise');

    expect(await field()).toHaveValue(libraryLinkUrl('fur-elise'));
    expect(await dialog()).toHaveTextContent(en.share.linkLibrary);
    expect(mock.encodeTakeLink).not.toHaveBeenCalled();
  });

  it('says so when the take cannot be loaded', async () => {
    mock.take = null;
    openDialog();
    expect(await dialog()).toHaveTextContent(en.share.linkFailed);
  });

  it('closes on Escape, on Close and on the backdrop', async () => {
    openDialog();
    await field();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(useExportUiStore.getState().linkRequestedTakeId).toBeNull());

    act(() => useExportUiStore.getState().openLinkShare('take-1'));
    await field();
    fireEvent.click(screen.getByRole('button', { name: en.share.linkClose }));
    expect(useExportUiStore.getState().linkRequestedTakeId).toBeNull();
  });
});

describe('the export dialogs’ store', () => {
  it('opens one export dialog at a time, the link dialog among them', () => {
    const store = useExportUiStore.getState();
    store.openExport('a');
    store.openLinkShare('b');
    expect(useExportUiStore.getState()).toMatchObject({
      requestedTakeId: null,
      sheetRequestedTakeId: null,
      linkRequestedTakeId: 'b',
    });
    store.openSheetExport('c');
    expect(useExportUiStore.getState()).toMatchObject({
      sheetRequestedTakeId: 'c',
      linkRequestedTakeId: null,
    });
    store.openLinkShare('d');
    store.openExport('e');
    expect(useExportUiStore.getState()).toMatchObject({
      requestedTakeId: 'e',
      linkRequestedTakeId: null,
    });
    store.closeExport();
  });
});
