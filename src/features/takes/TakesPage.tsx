import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/app/routerContext';
import { listTakeSummaries, type TakeSummary } from '@/data/takeRepository';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useTakeStore } from '@/state/useTakeStore';
import { shareOrDownloadFile, downloadBlob } from '@/utils/download';
import { toUserMessage } from '@/utils/errors';
import { formatDurationMs } from '@/utils/timing';
import { ImportTakeDialog } from './ImportTakeDialog';
import {
  backupAllFile,
  clearTakeNotes,
  commitImport,
  createNewTake,
  deleteTake,
  duplicateTake,
  openTake,
  previewImportFile,
  renameTake,
  restoreBackupFile,
  takeJsonFile,
  type ImportPreview,
} from './takesService';
import './takes.css';

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TakesPage() {
  const { navigate } = useRouter();
  const activeTakeId = useTakeStore((s) => s.take.id);
  const openExport = useExportUiStore((s) => s.openExport);
  const [summaries, setSummaries] = useState<TakeSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    listTakeSummaries()
      .then(setSummaries)
      .catch((error: unknown) => setMessage(toUserMessage(error)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = useCallback(
    async (work: () => Promise<void>, doneMessage?: string) => {
      try {
        await work();
        if (doneMessage) setMessage(doneMessage);
        refresh();
      } catch (error) {
        setMessage(toUserMessage(error));
      }
    },
    [refresh],
  );

  const startImport = useCallback(async (file: File) => {
    try {
      setImportPreview(await previewImportFile(file));
    } catch (error) {
      setMessage(toUserMessage(error));
    }
  }, []);

  const onImportChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void startImport(file);
    },
    [startImport],
  );

  const onRestoreChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      void act(async () => {
        const result = await restoreBackupFile(file);
        setMessage(
          `Backup restored: ${result.imported} take(s)` +
            (result.skipped > 0 ? `, ${result.skipped} skipped` : '') +
            (result.settingsRestored ? ', settings applied' : ''),
        );
      });
    },
    [act],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void startImport(file);
    },
    [startImport],
  );

  const commitRename = useCallback(
    (id: string) => {
      const title = renameText;
      setRenamingId(null);
      void act(() => renameTake(id, title));
    },
    [renameText, act],
  );

  return (
    <section
      className={`page${dragOver ? ' page--dragover' : ''}`}
      aria-label="Takes"
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="page__header">
        <h1 className="page__title">Takes</h1>
        <div className="takes-toolbar">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              void act(async () => {
                await createNewTake();
                navigate('play');
              })
            }
          >
            New take
          </button>
          <button type="button" className="btn" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
        </div>
      </header>

      {message ? (
        <p className="takes-message" role="status">
          {message}
        </p>
      ) : null}

      {summaries === null ? (
        <p className="page__hint">Loading…</p>
      ) : summaries.length === 0 ? (
        <p className="page__hint">
          No takes yet. Record something on the Play screen, or import a take JSON file.
        </p>
      ) : (
        <ul className="take-list">
          {summaries.map((summary) => {
            const isActive = summary.id === activeTakeId;
            const expanded = expandedId === summary.id;
            return (
              <li key={summary.id} className={`take-item${isActive ? ' is-active' : ''}`}>
                <div className="take-item__row">
                  <button
                    type="button"
                    className="take-item__main"
                    onClick={() =>
                      void act(async () => {
                        await openTake(summary.id);
                        navigate('play');
                      })
                    }
                    aria-label={`Open ${summary.title}`}
                  >
                    <span className="take-item__title">
                      {summary.title}
                      {summary.isDraft ? <span className="take-item__draft">Draft</span> : null}
                      {isActive ? <span className="take-item__active-dot" aria-label="Currently open" /> : null}
                    </span>
                    <span className="take-item__meta">
                      {summary.noteCount} notes · {formatDurationMs(summary.durationMs)} ·{' '}
                      {Math.round(summary.bpm)} BPM · {formatUpdated(summary.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="take-item__more"
                    aria-expanded={expanded}
                    aria-label={`More actions for ${summary.title}`}
                    onClick={() => setExpandedId(expanded ? null : summary.id)}
                  >
                    ⋯
                  </button>
                </div>

                {expanded ? (
                  <div className="take-item__actions">
                    {renamingId === summary.id ? (
                      <form
                        className="take-item__rename"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitRename(summary.id);
                        }}
                      >
                        <input
                          autoFocus
                          value={renameText}
                          onChange={(event) => setRenameText(event.target.value)}
                          onBlur={() => commitRename(summary.id)}
                          aria-label="New title"
                          maxLength={200}
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                          setRenamingId(summary.id);
                          setRenameText(summary.title);
                        }}
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => void act(() => duplicateTake(summary.id), 'Duplicated.')}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() =>
                        void act(async () => {
                          const file = await takeJsonFile(summary.id);
                          if (file) downloadBlob(file, file.name);
                        })
                      }
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() =>
                        void act(async () => {
                          const file = await takeJsonFile(summary.id);
                          if (file) {
                            const how = await shareOrDownloadFile(file);
                            setMessage(how === 'shared' ? 'Shared.' : 'Downloaded.');
                          }
                        })
                      }
                    >
                      Share JSON
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={summary.noteCount === 0}
                      onClick={() => openExport(summary.id)}
                    >
                      Share audio
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        if (window.confirm(`Remove all notes from “${summary.title}”?`)) {
                          void act(() => clearTakeNotes(summary.id), 'Notes cleared.');
                        }
                      }}
                    >
                      Clear notes
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => {
                        if (window.confirm(`Delete “${summary.title}”? This cannot be undone.`)) {
                          void act(() => deleteTake(summary.id), 'Deleted.');
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="takes-footer">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void act(async () => {
              const file = await backupAllFile();
              downloadBlob(file, file.name);
            }, 'Backup downloaded.')
          }
        >
          Backup all takes
        </button>
        <button type="button" className="btn" onClick={() => restoreInputRef.current?.click()}>
          Restore backup
        </button>
      </footer>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.pokeyboard.json,application/json"
        className="visually-hidden"
        onChange={onImportChosen}
        aria-label="Import take JSON file"
      />
      <input
        ref={restoreInputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={onRestoreChosen}
        aria-label="Restore backup file"
      />

      {importPreview ? (
        <ImportTakeDialog
          preview={importPreview}
          onCancel={() => setImportPreview(null)}
          onConfirm={(strategy) => {
            const preview = importPreview;
            setImportPreview(null);
            void act(async () => {
              await commitImport(preview, strategy);
              navigate('play');
            }, 'Take imported.');
          }}
        />
      ) : null}
    </section>
  );
}
