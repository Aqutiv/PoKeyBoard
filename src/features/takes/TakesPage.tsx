import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/app/routerContext';
import { listTakeSummaries, type TakeSummary } from '@/data/takeRepository';
import { isScoreFileName } from '@/domain/mxlContainer';
import { ShareMenu } from '@/features/export/ShareMenu';
import { useI18n, useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { shareOrDownloadFile, downloadBlob } from '@/utils/download';
import { toErrorMessageKey } from '@/utils/errors';
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
  previewImportScoreFile,
  renameTake,
  restoreBackupFile,
  takeJsonFile,
  type ImportPreview,
} from './takesService';
import './takes.css';

function formatUpdated(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TakesPage() {
  const { navigate } = useRouter();
  const m = useMessages();
  const { locale } = useI18n();
  const activeTakeId = useTakeStore((s) => s.take.id);
  const [summaries, setSummaries] = useState<TakeSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preparedShare, setPreparedShare] = useState<{ id: string; file: File } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const scoreInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    listTakeSummaries()
      .then(setSummaries)
      .catch((error: unknown) => setMessage(m.errors[toErrorMessageKey(error)]));
  }, [m]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // File preparation can touch IndexedDB, so do it when the action row is
  // opened. The later Share click can call navigator.share synchronously and
  // retain user activation.
  useEffect(() => {
    if (!expandedId) return;
    let alive = true;
    void takeJsonFile(expandedId)
      .then((file) => {
        if (alive && file) setPreparedShare({ id: expandedId, file });
      })
      .catch((error: unknown) => {
        if (alive) setMessage(m.errors[toErrorMessageKey(error)]);
      });
    return () => {
      alive = false;
    };
  }, [expandedId, summaries, m]);

  const act = useCallback(
    async (work: () => Promise<void>, doneMessage?: string) => {
      try {
        await work();
        if (doneMessage) setMessage(doneMessage);
        refresh();
      } catch (error) {
        setMessage(m.errors[toErrorMessageKey(error)]);
      }
    },
    [refresh, m],
  );

  const startImport = useCallback(
    async (file: File) => {
      try {
        setImportPreview(
          await (isScoreFileName(file.name)
            ? previewImportScoreFile(file)
            : previewImportFile(file)),
        );
      } catch (error) {
        setMessage(m.errors[toErrorMessageKey(error)]);
      }
    },
    [m],
  );

  const onImportChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void startImport(file);
    },
    [startImport],
  );

  const onScoreImportChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      void previewImportScoreFile(file)
        .then(setImportPreview)
        .catch((error: unknown) => setMessage(m.errors[toErrorMessageKey(error)]));
    },
    [m],
  );

  const onRestoreChosen = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      void act(async () => {
        const result = await restoreBackupFile(file);
        setMessage(
          m.takes.backupRestored({
            imported: result.imported,
            skipped: result.skipped,
            settingsRestored: result.settingsRestored,
          }),
        );
      });
    },
    [act, m],
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
      aria-label={m.takes.title}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="page__header">
        <h1 className="page__title">{m.takes.title}</h1>
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
            {m.takes.newTake}
          </button>
          <button type="button" className="btn" onClick={() => scoreInputRef.current?.click()}>
            {m.takes.importMxl}
          </button>
          <button type="button" className="btn" onClick={() => importInputRef.current?.click()}>
            {m.takes.importJson}
          </button>
        </div>
      </header>

      {message ? (
        <p className="takes-message" role="status">
          {message}
        </p>
      ) : null}

      {summaries === null ? (
        <p className="page__hint">{m.takes.loading}</p>
      ) : summaries.length === 0 ? (
        <p className="page__hint">{m.takes.empty}</p>
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
                    aria-label={m.takes.openLabel({ title: summary.title })}
                  >
                    <span className="take-item__title">
                      {summary.title}
                      {summary.isDraft ? (
                        <span className="take-item__draft">{m.takes.draft}</span>
                      ) : null}
                      {isActive ? (
                        <span
                          className="take-item__active-dot"
                          aria-label={m.takes.currentlyOpen}
                        />
                      ) : null}
                    </span>
                    <span className="take-item__meta">
                      {m.takes.meta({
                        notes: summary.noteCount,
                        duration: formatDurationMs(summary.durationMs),
                        bpm: Math.round(summary.bpm),
                        updated: formatUpdated(summary.updatedAt, locale),
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="take-item__more"
                    aria-expanded={expanded}
                    aria-label={m.takes.moreActionsLabel({ title: summary.title })}
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
                          aria-label={m.takes.newTitle}
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
                        {m.takes.rename}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => void act(() => duplicateTake(summary.id), m.takes.duplicated)}
                    >
                      {m.takes.duplicate}
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
                      {m.takes.exportJson}
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={preparedShare?.id !== summary.id}
                      onClick={() => {
                        if (preparedShare?.id !== summary.id) return;
                        void shareOrDownloadFile(preparedShare.file).then((how) => {
                          if (how !== 'cancelled') {
                            setMessage(how === 'shared' ? m.takes.shared : m.takes.downloaded);
                          }
                        });
                      }}
                    >
                      {m.takes.shareJson}
                    </button>
                    <ShareMenu
                      takeId={summary.id}
                      disabled={summary.noteCount === 0}
                      triggerClassName="btn btn--small"
                      align="left"
                    />
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        if (window.confirm(m.takes.removeNotesConfirm({ title: summary.title }))) {
                          void act(() => clearTakeNotes(summary.id), m.takes.notesCleared);
                        }
                      }}
                    >
                      {m.takes.clearNotes}
                    </button>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => {
                        if (window.confirm(m.takes.deleteConfirm({ title: summary.title }))) {
                          void act(() => deleteTake(summary.id), m.takes.deleted);
                        }
                      }}
                    >
                      {m.takes.delete}
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
            }, m.takes.backupDownloaded)
          }
        >
          {m.takes.backupAll}
        </button>
        <button type="button" className="btn" onClick={() => restoreInputRef.current?.click()}>
          {m.takes.restoreBackup}
        </button>
      </footer>

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.pokeyboard.json,application/json"
        className="visually-hidden"
        onChange={onImportChosen}
        aria-label={m.takes.importFileLabel}
      />
      {/* Do not add accept: iOS Files greys out .mxl because its custom extension is
          not consistently associated with the MusicXML MIME type. */}
      <input
        ref={scoreInputRef}
        type="file"
        className="visually-hidden"
        onChange={onScoreImportChosen}
        aria-label={m.takes.importMxlFileLabel}
      />
      <input
        ref={restoreInputRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        onChange={onRestoreChosen}
        aria-label={m.takes.restoreFileLabel}
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
            }, m.takes.takeImported);
          }}
        />
      ) : null}
    </section>
  );
}
