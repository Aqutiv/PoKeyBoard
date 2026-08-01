import { useCallback, useEffect, useState } from 'react';
import { loadLearnProgress, saveLearnProgress } from '@/data/learnProgressRepository';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { ChapterRunner } from './ChapterRunner';
import { LEARN_SECTIONS_BY_LEVEL } from './chapters';
import { LEARN_LEVEL_IDS, type LearnLevelId } from './levels';
import { chapterStatus, EMPTY_LEARN_PROGRESS, type LearnProgress } from './progress';
import type { LearnChapterId, LearnChapterMeta } from './types';
import './learn.css';

/** A course in playing: chapters of theory and exercises, beginner to advanced. */
export function LearnPage() {
  const m = useMessages();
  // Persisted, so the level the user was browsing is the one they come back to.
  const level = useSettingsStore((s) => s.learnLevel);
  const setLevel = useSettingsStore((s) => s.setLearnLevel);

  const [progress, setProgress] = useState<LearnProgress>(EMPTY_LEARN_PROGRESS);
  const [openId, setOpenId] = useState<LearnChapterId | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadLearnProgress().then((loaded) => {
      // A late arrival must not clobber progress made while it was in flight.
      if (!cancelled) setProgress(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: LearnProgress) => {
    setProgress(next);
    void saveLearnProgress(next).catch((error: unknown) => {
      // Losing a step marker is not worth interrupting a lesson for.
      console.error('Saving learn progress failed:', error);
    });
  }, []);

  if (openId !== null) {
    return (
      <ChapterRunner
        chapterId={openId}
        progress={progress}
        onProgress={persist}
        onClose={() => setOpenId(null)}
      />
    );
  }

  const renderChapter = (chapter: LearnChapterMeta) => {
    const title = m.learn.chapterTitles[chapter.id];
    const status = chapterStatus(chapter, progress);
    const locked = status === 'comingSoon';
    const step = progress.chapters[chapter.id]?.step ?? 0;
    return (
      <li key={chapter.id} className={`learn-item is-${status}`}>
        <button
          type="button"
          className="learn-item__main"
          disabled={locked}
          aria-label={locked ? m.learn.lockedLabel({ title }) : m.learn.openLabel({ title })}
          onClick={() => setOpenId(chapter.id)}
        >
          <span className="learn-item__number">
            {m.learn.chapterNumber({ order: chapter.order })}
            {locked ? (
              <svg
                className="learn-item__lock"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
              </svg>
            ) : null}
          </span>
          <span className="learn-item__title">{title}</span>
          <span className="learn-item__blurb">{m.learn.chapterBlurbs[chapter.id]}</span>
          <span className="learn-item__meta">
            {locked ? m.learn.comingSoon : null}
            {status === 'completed' ? m.learn.completed : null}
            {status === 'inProgress' ? m.learn.resumeAt({ step: step + 1 }) : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="page" aria-label={m.learn.title}>
      <header className="page__header">
        <h1 className="page__title">{m.learn.title}</h1>
      </header>
      <p className="page__hint">{m.learn.hint}</p>
      <div className="learn-levels" role="group" aria-label={m.learn.levelLabel}>
        {LEARN_LEVEL_IDS.map((id: LearnLevelId) => (
          <button
            key={id}
            type="button"
            className={`learn-levels__option${id === level ? ' is-selected' : ''}`}
            aria-pressed={id === level}
            onClick={() => setLevel(id)}
          >
            {m.learn.levels[id]}
          </button>
        ))}
      </div>
      {/* One scroller over all the parts, not one per part, so the headings
          can stick as their chapters pass beneath them. */}
      <div className="learn-scroll">
        {LEARN_SECTIONS_BY_LEVEL[level].map((section) => {
          const headingId = `learn-part-${section.part}`;
          return (
            <section className="learn-part" key={section.part} aria-labelledby={headingId}>
              <h2 className="learn-part__heading" id={headingId}>
                {m.learn.partTitles[section.part]}
              </h2>
              <ul className="learn-list">{section.chapters.map(renderChapter)}</ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
