import { create } from 'zustand';
// Types only: the shell reads this store, so a value import from takesService
// would pull that module into the entry chunk.
import type { HashLink } from '@/app/hashLinks';
import type { ImportPreview } from '@/features/takes/takesService';
import type { ErrorMessageKey } from '@/i18n/types';

interface ImportUiState {
  /**
   * An import waiting for the user's yes or no, shown by the shell's import
   * inbox rather than by the page that read the file, so it can be opened from
   * any route and outlives the route it was opened on.
   */
  preview: ImportPreview | null;
  /**
   * How many previews have been opened, so the inbox can tell a newer preview
   * from the one it replaced and start its dialog afresh, at Copy.
   */
  previewSeq: number;
  /** Why the last confirmed import could not be stored, until dismissed. */
  failure: ErrorMessageKey | null;
  /**
   * A share link taken out of the address bar, until the shell is free to open
   * it: nothing is opened under an export or a recording. See useHashLinkIntake.
   */
  pendingLink: HashLink | null;
  /** A newer preview replaces one still waiting: the latest pick wins. */
  openPreview(preview: ImportPreview): void;
  closePreview(): void;
  fail(key: ErrorMessageKey): void;
  dismissFailure(): void;
  /** A newer link replaces one still waiting, as a newer preview does. */
  receiveLink(link: HashLink): void;
  /**
   * Hand the waiting link over and empty the slot, so it is opened once: a
   * second claim — StrictMode's second effect, say — gets null.
   */
  claimLink(): HashLink | null;
}

// The slots are independent: a failure arriving while a preview waits (or the
// reverse) leaves the other where it is, and the inbox shows them in turn.
export const useImportUiStore = create<ImportUiState>()((set, get) => ({
  preview: null,
  previewSeq: 0,
  failure: null,
  pendingLink: null,
  openPreview: (preview) => set((state) => ({ preview, previewSeq: state.previewSeq + 1 })),
  closePreview: () => set({ preview: null }),
  fail: (failure) => set({ failure }),
  dismissFailure: () => set({ failure: null }),
  receiveLink: (pendingLink) => set({ pendingLink }),
  claimLink: () => {
    const link = get().pendingLink;
    if (link !== null) set({ pendingLink: null });
    return link;
  },
}));
