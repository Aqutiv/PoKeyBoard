import { useRouter } from '@/app/routerContext';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { formatDurationMs } from '@/utils/timing';
import { LIBRARY_TRACK_SUMMARIES } from './catalog';
import { openLibraryTrack } from './libraryService';
import './library.css';

/** Curated built-in tracks: open one on Play to listen, learn, or record over. */
export function LibraryPage() {
  const m = useMessages();
  const { navigate } = useRouter();
  const activeTakeId = useTakeStore((s) => s.take.id);

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
      <ul className="library-list">
        {LIBRARY_TRACK_SUMMARIES.map((track) => {
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
