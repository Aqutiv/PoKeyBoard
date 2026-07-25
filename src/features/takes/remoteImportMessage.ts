import type { Messages } from '@/i18n/types';
import { RemoteImportError, toErrorMessageKey } from '@/utils/errors';

/**
 * Translate a failed download. Only the HTTP case carries a parameter, so it
 * comes from the dialog namespace; everything else is a plain error key.
 * Shared by the URL dialog and the drop handler so their wording cannot drift.
 */
export function remoteImportMessage(m: Messages, error: unknown): string {
  if (error instanceof RemoteImportError && error.kind === 'http' && error.status !== undefined) {
    return m.importUrlDialog.httpError({ status: error.status });
  }
  return m.errors[toErrorMessageKey(error)];
}
