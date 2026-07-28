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

  const open = (trackId: string): void => {
    openLibraryTrack(trackId)
      .then((opened) => {
        if (opened) navigate('play');
      })
      .catch((error: unknown) => {
        console.error('Opening library track failed:', error);
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
                  {m.library.meta({
                    notes: track.noteCount,
                    duration: formatDurationMs(track.durationMs),
                    bpm: track.bpm,
                  })}
                </span>
                <span className="library-item__description">
                  {m.library.descriptions[track.descriptionKey]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="page__hint library-fork-hint">{m.library.forkHint}</p>
    </section>
  );
}
