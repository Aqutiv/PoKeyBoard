import { useEffect, useRef } from 'react';
import { clearHashLink, parseHashLink, type HashLink } from '@/app/hashLinks';
import { useRouter, type Route } from '@/app/routerContext';
import { libraryTakeId } from '@/domain/libraryTakes';
import { libraryTrackSummary } from '@/features/library/catalog';
import { useImportUiStore } from '@/state/useImportUiStore';
import { toErrorMessageKey } from '@/utils/errors';

/**
 * A take link becomes a preview in the import inbox — never an import by
 * itself. The decoder loads with takesService, only now that there is a link.
 */
async function openTakeLink(link: Extract<HashLink, { kind: 'take' }>): Promise<void> {
  const store = useImportUiStore.getState();
  try {
    const { previewTakeLink } = await import('@/features/takes/takesService');
    store.openPreview(await previewTakeLink(link.version, link.data));
  } catch (error) {
    store.fail(toErrorMessageKey(error));
  }
}

/**
 * A library link opens its track on Play, as the Library's own row would. A
 * Classics score is fetched the first time it opens, so offline it may not:
 * then the link says why, and the Library is left showing the track, ready
 * for when the connection is back — as a Learn hand-off does.
 *
 * `signal` aborts when an export or a recording starts while the track is on
 * its way. The open then gives way (it never swaps the take out from under
 * either), and the link waits its turn again.
 */
async function openLibraryLink(
  trackId: string,
  navigate: (route: Route) => void,
  signal: AbortSignal,
): Promise<void> {
  const store = useImportUiStore.getState();
  if (libraryTrackSummary(libraryTakeId(trackId)) === undefined) {
    store.fail('libraryLinkUnknown');
    return;
  }
  let opened = false;
  try {
    const { openLibraryTrack } = await import('@/features/library/libraryService');
    opened = await openLibraryTrack(trackId, signal);
  } catch (error) {
    if (!signal.aborted) console.error('Opening a library link failed:', error);
  }
  if (signal.aborted) {
    // Unless a newer link has come in meanwhile: that one wins.
    if (useImportUiStore.getState().pendingLink === null) {
      store.receiveLink({ kind: 'library', trackId });
    }
    return;
  }
  if (opened) {
    navigate('play');
    return;
  }
  store.fail('libraryLinkOffline');
  try {
    const { revealHandoffInLibrary } = await import('@/features/learn/handoff');
    revealHandoffInLibrary(trackId);
  } catch {
    // The Library opens on its last folder instead; the alert has said why.
  }
  navigate('library');
}

/**
 * The shell's share-link intake, run by the always-mounted `ImportDialogs`.
 *
 * A link is read when the app starts on one and whenever one is followed while
 * it is open. The address is swapped for `#/play` at once, before anything is
 * decoded, so a reload, Back, or StrictMode's second mount never meets the same
 * link twice. The link then waits in the import store until nothing is `busy`
 * — the condition the inbox holds its dialogs on — and is opened once.
 *
 * Nothing here runs before the take is restored: `RouterProvider`, which this
 * lives inside, mounts only once `persistenceService.init()` has finished.
 */
export function useHashLinkIntake(busy: boolean): void {
  const { navigate } = useRouter();
  const pendingLink = useImportUiStore((state) => state.pendingLink);
  const opening = useRef<AbortController | null>(null);

  useEffect(() => {
    const takeIn = () => {
      const link = parseHashLink(window.location.hash);
      if (link === null) return;
      clearHashLink();
      useImportUiStore.getState().receiveLink(link);
    };
    takeIn();
    window.addEventListener('hashchange', takeIn);
    return () => window.removeEventListener('hashchange', takeIn);
  }, []);

  useEffect(() => {
    if (busy) {
      opening.current?.abort();
      return;
    }
    if (pendingLink === null) return;
    // Claimed from the store rather than taken from this render, so an effect
    // run twice over the same render opens the link once.
    const link = useImportUiStore.getState().claimLink();
    if (link === null) return;
    if (link.kind === 'take') {
      void openTakeLink(link);
      return;
    }
    const controller = new AbortController();
    opening.current = controller;
    void openLibraryLink(link.trackId, navigate, controller.signal).finally(() => {
      if (opening.current === controller) opening.current = null;
    });
  }, [busy, pendingLink, navigate]);
}
