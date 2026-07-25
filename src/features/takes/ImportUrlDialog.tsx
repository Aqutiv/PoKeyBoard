import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import { RemoteImportCancelled, RemoteImportError } from '@/utils/errors';
import { remoteImportMessage } from './remoteImportMessage';
import { previewImportUrl, type ImportPreview } from './takesService';

type Phase =
  { kind: 'input' } | { kind: 'loading' } | { kind: 'error'; message: string; blocked: boolean };

interface ImportUrlDialogProps {
  onCancel: () => void;
  onLoaded: (preview: ImportPreview) => void;
  /** Offered after a blocked download, which is the common cross-origin outcome. */
  onUseFilePicker: () => void;
}

/** Paste a link to a score or take file, download it, and hand back a preview. */
export function ImportUrlDialog({ onCancel, onLoaded, onUseFilePicker }: ImportUrlDialogProps) {
  const m = useMessages();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      abortRef.current?.abort();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (url.trim() === '' || phase.kind === 'loading') return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'loading' });
    try {
      const preview = await previewImportUrl(url, controller.signal);
      if (!aliveRef.current) return;
      onLoaded(preview);
    } catch (error) {
      if (!aliveRef.current || error instanceof RemoteImportCancelled) return;
      const blocked = error instanceof RemoteImportError && error.kind === 'blocked';
      setPhase({ kind: 'error', message: remoteImportMessage(m, error), blocked });
    } finally {
      abortRef.current = null;
    }
  };

  const loading = phase.kind === 'loading';

  return (
    <div className="modal-backdrop" onClick={loading ? undefined : onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-url-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="import-url-dialog-title" className="modal__title">
          {m.importUrlDialog.title}
        </h2>
        {/* noValidate so our translated message wins over the browser's bubble. */}
        <form onSubmit={submit} noValidate>
          <input
            className="import-url__input"
            type="url"
            inputMode="url"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={2048}
            disabled={loading}
            value={url}
            aria-label={m.importUrlDialog.urlLabel}
            placeholder={m.importUrlDialog.placeholder}
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="import-url__hint">{m.importUrlDialog.hint}</p>

          {phase.kind === 'error' ? (
            <p className="import-url__error" role="alert">
              {phase.message}
            </p>
          ) : null}
          {loading ? <p role="status">{m.importUrlDialog.loading}</p> : null}

          <div className="modal__actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                abortRef.current?.abort();
                onCancel();
              }}
            >
              {m.importUrlDialog.cancel}
            </button>
            {phase.kind === 'error' && phase.blocked ? (
              <button type="button" className="btn" onClick={onUseFilePicker}>
                {m.importUrlDialog.useFilePicker}
              </button>
            ) : null}
            <button
              type="submit"
              className="btn btn--primary"
              disabled={url.trim() === '' || loading}
            >
              {m.importUrlDialog.fetch}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
