import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/app/routerContext';
import { loadPracticeRecords } from '@/data/practiceResultsRepository';
import {
  chipFor,
  headlinePercent,
  practiceModeOf,
  type PracticeChip,
  type PracticeRecords,
} from '@/features/practice/practiceRecords';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { SegmentedSwitch } from '@/ui/SegmentedSwitch';
import { formatDurationMs } from '@/utils/timing';
import { filterLibrarySections, LIBRARY_FOLDER_SECTIONS } from './catalog';
import { LIBRARY_FOLDER_IDS, type LibraryFolderId } from './folders';
import { openLibraryTrack } from './libraryService';
import {
  readLibraryScroll,
  rememberLibraryScroll,
  readLibraryQuery,
  rememberLibraryQuery,
} from './scrollMemory';
import './library.css';

/**
 * A track's chip in words: on it, the way it was practised and its best's
 * headline share, "Right hand · 92%"; and in full, for a screen reader, which
 * hears it as the row's description.
 */
function chipWords(m: Messages, { mode, best }: PracticeChip): { label: string; detail: string } {
  const { style, hand } = practiceModeOf(mode);
  const percent = headlinePercent(best, style);
  const hands =
    style === 'wait'
      ? { left: m.practice.handLeft, right: m.practice.handRight, both: m.practice.handBoth }
      : {
          left: m.practice.handLeftInTime,
          right: m.practice.handRightInTime,
          both: m.practice.handBothInTime,
        };
  return {
    label: m.practice.chip({ hand: hands[hand], percent }),
    detail: m.practice.chipDetail({ hand, keepTime: style === 'playAlong', percent }),
  };
}

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

  // Classics has a large catalog; the smaller Originals folder needs no filter.
  const [query, setQuery] = useState(() => readLibraryQuery(folder));
  const filterInput = useRef<HTMLInputElement>(null);
  const showFilter = folder === 'classics';
  const sections = useMemo(
    () => filterLibrarySections(LIBRARY_FOLDER_SECTIONS[folder], showFilter ? query : ''),
    [folder, query, showFilter],
  );

  // Opening a track routes to Play and unmounts this page, so the list has to be
  // put back where it was left — 63 classics are a long way to scroll twice.
  // Each folder keeps its own place; the memory lasts as long as the tab does.
  const groups = useRef<HTMLDivElement>(null);
  const openFolder = useRef(folder);
  const rememberCurrentScroll = (): void => {
    if (groups.current) rememberLibraryScroll(folder, groups.current.scrollTop);
  };

  // Restore before paint on folder changes; editing a search explicitly starts
  // its new results at the top.
  useLayoutEffect(() => {
    openFolder.current = folder;
    if (groups.current) groups.current.scrollTop = readLibraryScroll(folder);
  }, [folder]);

  // Leaving is the other half. A layout effect cleanup is the last moment the
  // offset can be read — a detached node reports 0 — and the node is held onto
  // rather than read off the ref, which React need not still be pointing at.
  useLayoutEffect(() => {
    const el = groups.current;
    if (!el) return;
    return () => rememberLibraryScroll(openFolder.current, el.scrollTop);
  }, []);

  const chooseFolder = (id: LibraryFolderId): void => {
    // Recorded before the switch, not on the way out of the effect above: by
    // then the shorter list has rendered and clamped the offset it would read.
    rememberCurrentScroll();
    setQuery(readLibraryQuery(id));
    setFolder(id);
  };

  const clearFilter = (): void => {
    setQuery('');
    rememberLibraryQuery(folder, '');
    rememberLibraryScroll(folder, 0);
    if (groups.current) groups.current.scrollTop = 0;
    filterInput.current?.focus();
  };

  // Each track's best, read once as the page opens. Only the practice session
  // writes them, as a run through a track ends, and the page is not open then.
  const [records, setRecords] = useState<PracticeRecords | null>(null);
  const chipId = useId();
  useEffect(() => {
    let cancelled = false;
    void loadPracticeRecords()
      // A list without its chips beats a list that never renders.
      .catch((error: unknown) => {
        console.error('Loading practice results failed:', error);
        return null;
      })
      .then((loaded) => {
        if (!cancelled) setRecords(loaded);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A download outlives the page if the user navigates away mid-open. Abort it
  // on unmount: a score that arrives late must not activate itself and pull the
  // user back to Play, overriding wherever they went instead.
  const openAbort = useRef<AbortController | null>(null);
  useEffect(() => () => openAbort.current?.abort(), []);

  const open = (trackId: string): void => {
    if (openingId !== null) return;
    const controller = new AbortController();
    openAbort.current = controller;
    setOpeningId(trackId);
    setFailed(false);
    openLibraryTrack(trackId, controller.signal)
      .then((opened) => {
        if (controller.signal.aborted) return;
        setOpeningId(null);
        if (opened) navigate('play');
        else setFailed(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
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
      <SegmentedSwitch
        ariaLabel={m.library.folderLabel}
        options={LIBRARY_FOLDER_IDS.map((id) => ({ value: id, label: m.library.folders[id] }))}
        value={folder}
        onChange={chooseFolder}
      />
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
            onChange={(event) => {
              setQuery(event.target.value);
              rememberLibraryQuery(folder, event.target.value);
              rememberLibraryScroll(folder, 0);
              if (groups.current) groups.current.scrollTop = 0;
            }}
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
      <div className="library-groups" ref={groups}>
        {sections.map((section) => {
          const list = (
            <ul className="library-list">
              {section.tracks.map((track) => {
                const isActive = track.takeId === activeTakeId;
                const isOpening = track.trackId === openingId;
                const chip = records ? chipFor(records.tracks[track.takeId], track) : null;
                const words = chip ? chipWords(m, chip) : null;
                const detailId = `${chipId}${track.trackId}`;
                return (
                  <li key={track.trackId} className={`library-item${isActive ? ' is-active' : ''}`}>
                    {/* Named as ever, the chip's words its description: a name
                        that changed with every best would be no name to find
                        the track by. */}
                    <button
                      type="button"
                      className="library-item__main"
                      aria-label={m.library.openLabel({ title: track.title })}
                      aria-describedby={words ? detailId : undefined}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => open(track.trackId)}
                    >
                      <span className="library-item__heading">
                        <span className="library-item__title">{track.title}</span>
                        {words ? (
                          <span className="library-item__best" aria-hidden="true">
                            {words.label}
                          </span>
                        ) : null}
                      </span>
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
                      {words ? (
                        <span id={detailId} className="visually-hidden">
                          {words.detail}
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
