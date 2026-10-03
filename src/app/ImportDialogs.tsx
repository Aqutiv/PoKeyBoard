import { lazy, Suspense } from 'react';
import { isExportState } from '@/features/transport/transportMachine';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useImportUiStore } from '@/state/useImportUiStore';
import { useTransportState } from './hooks/useTransport';

const ImportInbox = lazy(() =>
  import('@/features/takes/ImportInbox').then((module) => ({ default: module.ImportInbox })),
);

/**
 * The import inbox, mounted once in the shell beside the export dialogs, so a
 * preview opened anywhere shows over whichever route is up. Only the stores are
 * read here: the dialogs, and takesService behind them, load when there is
 * something to show.
 *
 * Living outside the routed view, a preview outlives a route change — the
 * browser's Back button now, and the hash change a shared link will arrive by —
 * while its modal backdrop keeps the nav out of reach.
 *
 * It waits its turn. While an export is under way or an export dialog is open,
 * or a recording is counting in or running, a preview stays in the store and
 * shows once that clears: two modals never stack, an import never swaps the
 * active take out from under an export the user is watching, and no dialog
 * lands in the middle of a performance. Leaving a route stops a recording, so
 * that last case is only a file or link that finished loading after the user
 * left Takes for Play.
 */
export function ImportDialogs() {
  const pending = useImportUiStore((state) => state.preview !== null || state.failure !== null);
  const exportDialogOpen = useExportUiStore(
    (state) => state.requestedTakeId !== null || state.sheetRequestedTakeId !== null,
  );
  const transport = useTransportState();
  const busy = isExportState(transport) || transport === 'countIn' || transport === 'recording';
  return (
    <Suspense fallback={null}>
      {pending && !exportDialogOpen && !busy ? <ImportInbox /> : null}
    </Suspense>
  );
}
