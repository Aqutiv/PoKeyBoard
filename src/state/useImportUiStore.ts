import { create } from 'zustand';
// Types only: the shell reads this store, so a value import from takesService
// would pull that module into the entry chunk.
import type { ImportPreview } from '@/features/takes/takesService';
import type { ErrorMessageKey } from '@/i18n/types';

interface ImportUiState {
  /**
   * An import waiting for the user's yes or no, shown by the shell's import
   * inbox rather than by the page that read the file, so it can be opened from
   * any route and outlives the route it was opened on.
   */
  preview: ImportPreview | null;
  /** Why the last confirmed import could not be stored, until dismissed. */
  failure: ErrorMessageKey | null;
  /** A newer preview replaces one still waiting: the latest pick wins. */
  openPreview(preview: ImportPreview): void;
  closePreview(): void;
  fail(key: ErrorMessageKey): void;
  dismissFailure(): void;
}

// The two slots are independent: a failure arriving while a preview waits (or
// the reverse) leaves the other where it is, and the inbox shows them in turn.
export const useImportUiStore = create<ImportUiState>()((set) => ({
  preview: null,
  failure: null,
  openPreview: (preview) => set({ preview }),
  closePreview: () => set({ preview: null }),
  fail: (failure) => set({ failure }),
  dismissFailure: () => set({ failure: null }),
}));
