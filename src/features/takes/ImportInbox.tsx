import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from '@/app/routerContext';
import { useMessages } from '@/i18n/i18nContext';
import type { ErrorMessageKey } from '@/i18n/types';
import { useImportUiStore } from '@/state/useImportUiStore';
import { toErrorMessageKey } from '@/utils/errors';
import { ImportTakeDialog } from './ImportTakeDialog';
import { commitImport } from './takesService';
import './importDialog.css';

/**
 * The import inbox's dialogs: the preview waiting in useImportUiStore and, if
 * committing one failed, why. The shell mounts this lazily (ImportDialogs), so
 * whatever read the file — a Takes picker, a drop, a link — only has to open
 * the preview.
 */
export function ImportInbox() {
  const { navigate } = useRouter();
  const preview = useImportUiStore((state) => state.preview);
  const previewSeq = useImportUiStore((state) => state.previewSeq);
  const failure = useImportUiStore((state) => state.failure);
  const closePreview = useImportUiStore((state) => state.closePreview);

  const confirm = useCallback(
    (strategy: 'copy' | 'replace') => {
      if (preview === null) return;
      closePreview();
      // Closing the preview can unmount this before the commit settles, so the
      // outcome goes to the router and the store, never to component state.
      void commitImport(preview, strategy).then(
        () => navigate('play'),
        (error: unknown) => useImportUiStore.getState().fail(toErrorMessageKey(error)),
      );
    },
    [preview, closePreview, navigate],
  );

  // A failure goes first: it reports on something the user already did, while
  // a preview waiting behind it is still a question, and keeps.
  if (failure !== null) return <ImportFailedAlert messageKey={failure} />;
  if (preview === null) return null;
  // Keyed by the preview's number, so one that replaces another while it is
  // open starts again at Copy with Import focused: a choice to replace belongs
  // to the take it was made for, and is never handed on to the next.
  return (
    <ImportTakeDialog
      key={previewSeq}
      preview={preview}
      onCancel={closePreview}
      onConfirm={confirm}
    />
  );
}

/**
 * Why a confirmed import was not stored, headed like the preview it follows, as
 * the export dialogs head their errors. Escape, the backdrop or Close dismisses
 * it.
 */
function ImportFailedAlert({ messageKey }: { messageKey: ErrorMessageKey }) {
  const m = useMessages();
  const dismiss = useImportUiStore((state) => state.dismissFailure);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return (
    // A file dropped here is swallowed, as on the preview's backdrop.
    <div
      className="modal-backdrop"
      onClick={dismiss}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="import-failure-title"
        aria-describedby="import-failure-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="import-failure-title" className="modal__title">
          {m.importDialog.title}
        </h2>
        <p id="import-failure-message" className="import-failure">
          {m.errors[messageKey]}
        </p>
        <div className="modal__actions">
          <button ref={closeRef} type="button" className="btn" onClick={dismiss}>
            {m.importDialog.close}
          </button>
        </div>
      </div>
    </div>
  );
}
