import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareMenu } from '@/features/export/ShareMenu';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { useExportUiStore } from '@/state/useExportUiStore';

vi.mock('@/features/export/midiFile', () => ({ takeMidiFile: async () => null }));

afterEach(() => {
  cleanup();
  act(() => useExportUiStore.setState({ linkRequestedTakeId: null }));
});

describe('the Share menu', () => {
  it('ends with Link…, which opens the link dialog for its take', () => {
    render(
      <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
        <ShareMenu takeId="take-7" triggerClassName="btn" />
      </I18nContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.share.trigger }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      en.share.audio,
      en.share.sheet,
      en.share.midi,
      en.share.link,
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: en.share.link }));
    expect(useExportUiStore.getState().linkRequestedTakeId).toBe('take-7');
  });
});
