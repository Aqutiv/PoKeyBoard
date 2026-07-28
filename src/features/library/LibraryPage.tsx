import { useState } from 'react';
import { useRouter } from '@/app/routerContext';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { formatDurationMs } from '@/utils/timing';
import { LIBRARY_FOLDER_SUMMARIES } from './catalog';
import { LIBRARY_FOLDER_IDS } from './folders';
import { openLibraryTrack } from './libraryService';
import './library.css';

/** Curated built-in tracks: open one on Play to listen, learn, or record over. */
export function LibraryPage() {
  const m = useMessages();
  const { navigate } = useRouter();
  const activeTakeId = useTakeStore((s) => s.take.id);
  // Persisted, so the folder the user was browsing is the one they come back to.
  const folder = useSettingsStore((s) => s.libraryFolder);
  const setFolder = useSettingsStore((s) => s.setLibraryFolder);

  // A vendored score is fetched and parsed on open, so the tap is no longer
  // instant and can fail — both states have to be visible.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const open = (trackId: string): void => {
    if (openingId !== null) return;
    setOpeningId(trackId);
    setFailed(false);
    openLibraryTrack(trackId)
      .then((opened) => {
        setOpeningId(null);
        if (opened) navigate('play');
        else setFailed(true);
      })
      .catch((error: unknown) => {
        console.error('Opening library track failed:', error);
        setOpeningId(null);
        setFailed(true);
      });
  };

  return (
    <section className="page" aria-label={m.library.title}>
      <header className="page__header">
        <h1 className="page__title">{m.library.title}</h1>
      </header>
      <p className="page__hint">{m.library.hint}</p>
      <div className="library-folders" role="group" aria-label={m.library.folderLabel}>
        {LIBRARY_FOLDER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`library-folders__option${id === folder ? ' is-selected' : ''}`}
            aria-pressed={id === folder}
            onClick={() => setFolder(id)}
          >
            {m.library.folders[id]}
          </button>
        ))}
      </div>
      <ul className="library-list">
        {LIBRARY_FOLDER_SUMMARIES[folder].map((track) => {
          const isActive = track.takeId === activeTakeId;
          const isOpening = track.trackId === openingId;
          return (
            <li key={track.trackId} className={`library-item${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                className="library-item__main"
                aria-label={m.library.openLabel({ title: track.title })}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => open(track.trackId)}
              >
                <span className="library-item__title">{track.title}</span>
                <span className="library-item__byline">
                  {m.library.byline({ composer: track.composer })}
                </span>
                <span className="library-item__meta">
                  {isOpening
                    ? m.library.opening
                    : m.library.meta({
                        notes: track.noteCount,
                        duration: formatDurationMs(track.durationMs),
                        bpm: track.bpm,
                      })}
                </span>
                {track.descriptionKey ? (
                  <span className="library-item__description">
                    {m.library.descriptions[track.descriptionKey]}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="library-status">
        {failed ? m.library.openFailed : ''}
      </p>
      <p className="page__hint library-fork-hint">{m.library.forkHint}</p>
    </section>
  );
}
