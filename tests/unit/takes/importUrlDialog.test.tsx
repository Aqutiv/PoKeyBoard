import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { MAX_TAKE_LINK_CHARS } from '@/domain/takeLink';
import { ImportUrlDialog } from '@/features/takes/ImportUrlDialog';
import type { ImportPreview } from '@/features/takes/takesService';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';

const mock = vi.hoisted(() => ({
  previewImportLink: vi.fn<(raw: string, signal?: AbortSignal) => Promise<ImportPreview | null>>(),
}));
vi.mock('@/features/takes/takesService', () => ({
  previewImportLink: (raw: string, signal?: AbortSignal) => mock.previewImportLink(raw, signal),
}));

function renderDialog() {
  const onLoaded = vi.fn<(preview: ImportPreview | null) => void>();
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <ImportUrlDialog onCancel={vi.fn()} onLoaded={onLoaded} onUseFilePicker={vi.fn()} />
    </I18nContext.Provider>,
  );
  return { onLoaded };
}

function submit(link: string) {
  fireEvent.change(screen.getByRole('textbox', { name: en.importUrlDialog.urlLabel }), {
    target: { value: link },
  });
  fireEvent.click(screen.getByRole('button', { name: en.importUrlDialog.fetch }));
}

afterEach(() => {
  cleanup();
  mock.previewImportLink.mockReset();
});

describe('the link dialog on Takes', () => {
  it('takes a share link far longer than a link to download may be', async () => {
    const preview: ImportPreview = {
      parsed: { take: createEmptyTake({ title: 'Linked take' }), repairs: [] },
      collision: false,
      fileName: 'link',
    };
    mock.previewImportLink.mockResolvedValue(preview);
    const { onLoaded } = renderDialog();

    // A browser cuts what is typed or pasted at maxLength: the field must hold
    // the longest link a take can make.
    const field = screen.getByRole<HTMLInputElement>('textbox', {
      name: en.importUrlDialog.urlLabel,
    });
    expect(field.maxLength).toBeGreaterThan(MAX_TAKE_LINK_CHARS);

    const link = `https://pokeyboard.example/#/s/1.${'A'.repeat(30_000)}`;
    submit(link);

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(preview));
    expect(mock.previewImportLink).toHaveBeenCalledWith(link, expect.any(AbortSignal));
  });

  it('closes once a library link has gone to the address bar', async () => {
    mock.previewImportLink.mockResolvedValue(null);
    const { onLoaded } = renderDialog();

    submit('https://pokeyboard.example/#/lib/fur-elise');

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(null));
  });
});
