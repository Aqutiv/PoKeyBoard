import { useMemo, useRef, useState } from 'react';
import { useRouter } from '@/app/routerContext';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { formatDurationMs } from '@/utils/timing';
import { filterLibrarySections, LIBRARY_FOLDER_SECTIONS } from './catalog';
import { LIBRARY_FOLDER_IDS, type LibraryFolderId } from './folders';
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

  // Classics runs to 63 tracks; Originals is six and needs no filter.
  const [query, setQuery] = useState('');
  const filterInput = useRef<HTMLInputElement>(null);
  const showFilter = folder === 'classics';
  const sections = useMemo(
    () => filterLibrarySections(LIBRARY_FOLDER_SECTIONS[folder], showFilter ? query : ''),
    [folder, query, showFilter],
  );

  const chooseFolder = (id: LibraryFolderId): void => {
    // A filter left behind in a hidden folder would silently shorten the list
    // the next time it is opened.
    setQuery('');
    setFolder(id);
  };

  const clearFilter = (): void => {
    setQuery('');
    filterInput.current?.focus();
  };

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
            onClick={() => chooseFolder(id)}
          >
            {m.library.folders[id]}
          </button>
        ))}
      </div>
      {showFilter ? (
        <div className="library-filter">
          <svg
            className="library-filter__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6" />
            <path d="M15.5 15.5 20 20" />
          </svg>
          <input
            ref={filterInput}
            type="search"
            className="library-filter__input"
            aria-label={m.library.filterLabel}
            placeholder={m.library.filterPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== '' ? (
            <button
              type="button"
              className="library-filter__clear"
              aria-label={m.library.filterClear}
              onClick={clearFilter}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
      {sections.length === 0 ? (
        <p role="status" className="page__hint library-empty">
          {m.library.filterEmpty({ query })}
        </p>
      ) : null}
      <div className="library-groups">
        {sections.map((section) => {
          const list = (
            <ul className="library-list">
              {section.tracks.map((track) => {
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
          );
          // The pinned run above the first heading carries no composer of its own.
          if (section.composer === null) return <div key="pinned">{list}</div>;
          const headingId = `library-group-${section.composer.replace(/\W+/g, '-').toLowerCase()}`;
          return (
            <section className="library-group" key={section.composer} aria-labelledby={headingId}>
              <h2 className="library-group__heading" id={headingId}>
                <span>{section.composer}</span>
                <span className="library-group__count">
                  {m.library.groupCount({ count: section.tracks.length })}
                </span>
              </h2>
              {list}
            </section>
          );
        })}
      </div>
      <p role="status" className="library-status">
        {failed ? m.library.openFailed : ''}
      </p>
      <p className="page__hint library-fork-hint">{m.library.forkHint}</p>
    </section>
  );
}
