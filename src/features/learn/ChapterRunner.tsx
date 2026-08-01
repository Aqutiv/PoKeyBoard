import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSampleLoadProgress } from '@/app/hooks/useAudioEngine';
import { useRouter } from '@/app/routerContext';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import { isBusyState } from '@/features/transport/transportMachine';
import { transportController } from '@/features/transport/transportController';
import { useI18n } from '@/i18n/i18nContext';
import { KeyboardDiagram } from './KeyboardDiagram';
import { QuizPanel } from './QuizPanel';
import { StaffSnippet } from './StaffSnippet';
import { findLearnChapter } from './chapters';
import { loadChapterProse } from './content';
import type { ChapterProse } from './content/types';
import { playPhrase } from './demo';
import { needsRangeShift, targetMidisFor, type MidiRange } from './exerciseMatcher';
import { chapterStep, withChapterDone, withChapterStep, type LearnProgress } from './progress';
import type { LearnChapter, LearnChapterId, LearnStep } from './types';
import { useExercise } from './useExercise';
import { useQuiz } from './useQuiz';

const DEFAULT_ANCHOR_MIDI = 60;
const EMPTY_TARGETS: ReadonlySet<number> = new Set();

interface ChapterRunnerProps {
  chapterId: LearnChapterId;
  progress: LearnProgress;
  onProgress: (next: LearnProgress) => void;
  onClose: () => void;
}

/**
 * Runs one chapter full-screen: theory in a card, the keyboard docked beneath.
 *
 * Full-screen rather than a dialog over Play, because two mounted keyboards
 * would each attach their own computer-keyboard listener to `window` (doubling
 * every keypress into two voices under one source id) and the second unmount
 * would clear the first one's sustain. Never mounting them together is the
 * only fix that needs no changes to `PianoKeyboard`'s ownership model.
 */
export function ChapterRunner({ chapterId, progress, onProgress, onClose }: ChapterRunnerProps) {
  const { m, language } = useI18n();
  const { navigate } = useRouter();
  const meta = findLearnChapter(chapterId);

  const [chapter, setChapter] = useState<LearnChapter | null>(null);
  const [prose, setProse] = useState<ChapterProse | null>(null);
  // Held apart from `index` so the async load handler can close over a value
  // that never moves, without reading a ref during render.
  const [openingIndex] = useState(() => chapterStep(chapterId, progress));
  const [index, setIndex] = useState(openingIndex);
  const [anchorMidi, setAnchorMidi] = useState(DEFAULT_ANCHOR_MIDI);
  const [range, setRange] = useState<MidiRange>({ lowMidi: 60, highMidi: 72 });
  const [showingHint, setShowingHint] = useState(false);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [settledStepId, setSettledStepId] = useState<string | null>(null);

  // Playback deliberately survives navigation, so a take can still be running
  // when a chapter opens. A lesson cannot compete with it.
  useEffect(() => {
    if (isBusyState(transportController.getState())) transportController.stop();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = meta?.load;
    if (!load) return;
    void Promise.all([load(), loadChapterProse(chapterId, language)]).then(
      ([loadedChapter, loadedProse]) => {
        if (cancelled) return;
        setChapter(loadedChapter);
        setProse(loadedProse);
        // Settle the opening step here rather than letting the render-phase
        // reset below catch it. The keyboard is live while the chapter module
        // is still in flight, so a user who shifts the range in that window
        // would otherwise have it snapped back the moment the chapter landed.
        const opening = loadedChapter.steps[Math.min(openingIndex, loadedChapter.steps.length - 1)];
        if (opening) {
          setSettledStepId(opening.id);
          if (opening.anchorMidi !== undefined) setAnchorMidi(opening.anchorMidi);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [chapterId, language, meta, openingIndex]);

  const steps = chapter?.steps ?? [];
  const step: LearnStep | undefined = steps[Math.min(index, steps.length - 1)];
  const spec = step?.kind === 'exercise' ? step.spec : null;

  const exercise = useExercise(spec);
  const quiz = useQuiz(step?.kind === 'quiz' ? step : null);
  const loadProgress = useSampleLoadProgress();
  // `noteOn` emits no input event when the pitch has no decoded sample, so an
  // exercise offered before the core pack lands would be quietly unwinnable.
  const pianoReady = loadProgress.phase === 'core-ready' || loadProgress.phase === 'loading-extra';

  // Everything that resets when the step changes, adjusted during render
  // rather than in an effect — an effect would paint the new step once with
  // the previous one's hint still showing.
  if (step !== undefined && settledStepId !== step.id) {
    setSettledStepId(step.id);
    setShowingHint(false);
    // Park the keyboard where the step wants it without touching the persisted
    // Play-tab anchor; the ‹ › shifter still moves this local copy.
    if (step.anchorMidi !== undefined) setAnchorMidi(step.anchorMidi);
  }

  const targetMidis = useMemo(() => {
    if (!spec || !showingHint) return EMPTY_TARGETS;
    return targetMidisFor(spec, exercise.state, range);
  }, [spec, showingHint, exercise.state, range]);

  const wantsShift = spec ? needsRangeShift(spec, exercise.state, range) : false;

  const onRangeChange = useCallback((next: MidiRange) => setRange(next), []);

  const goTo = useCallback(
    (next: number) => {
      setIndex(next);
      onProgress(withChapterStep(progress, chapterId, next));
    },
    [chapterId, onProgress, progress],
  );

  const isLast = steps.length > 0 && index >= steps.length - 1;
  const canAdvance =
    step?.kind === 'exercise'
      ? exercise.progress.satisfied || exercise.skipAvailable
      : step?.kind === 'quiz'
        ? quiz.satisfied
        : true;

  const finish = useCallback(() => {
    onProgress(withChapterDone(progress, chapterId));
    onClose();
  }, [chapterId, onClose, onProgress, progress]);

  const advance = useCallback(() => {
    if (isLast) finish();
    else goTo(index + 1);
  }, [finish, goTo, index, isLast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const listen = step?.listen;
  const demoTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(demoTimer.current);
    },
    [],
  );

  const onListen = useCallback(() => {
    if (!listen) return;
    void playPhrase(listen).then((durationMs) => {
      // Scheduled notes cannot be unscheduled, and `allNotesOff` would cut the
      // user's own keys — so the button simply waits the phrase out.
      setDemoPlaying(true);
      window.clearTimeout(demoTimer.current);
      demoTimer.current = window.setTimeout(() => setDemoPlaying(false), durationMs);
    });
  }, [listen]);

  const title = m.learn.chapterTitles[chapterId];
  const text = step ? prose?.[step.id] : undefined;

  return (
    <section
      className="page learn-runner"
      aria-label={title}
      data-piano-ready={pianoReady ? 'true' : 'false'}
    >
      <header className="learn-runner__bar">
        <div className="learn-runner__heading">
          <h1 className="learn-runner__title">{title}</h1>
          <p className="learn-runner__step">
            {steps.length > 0
              ? m.learn.stepOf({ step: index + 1, steps: steps.length })
              : m.learn.loadingChapter}
          </p>
        </div>
        <button
          type="button"
          className="learn-runner__close"
          aria-label={m.learn.close}
          onClick={onClose}
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
      </header>

      <div className="learn-runner__card">
        {text ? (
          <>
            <h2 className="learn-card__heading">{text.heading}</h2>
            {text.body.map((paragraph) => (
              <p key={paragraph} className="learn-card__body">
                {paragraph}
              </p>
            ))}
          </>
        ) : (
          <p className="learn-card__body">{m.learn.loadingChapter}</p>
        )}

        {step?.visual?.kind === 'keyboard' ? (
          <KeyboardDiagram
            lowMidi={step.visual.lowMidi}
            highMidi={step.visual.highMidi}
            highlight={step.visual.highlight}
            highlightSecondary={step.visual.highlightSecondary}
            labels={step.visual.labels}
            ariaLabel={m.learn.diagramLabel}
          />
        ) : null}
        {step?.visual?.kind === 'staff' ? (
          <StaffSnippet phrase={step.visual.phrase} ariaLabel={m.learn.staffLabel} />
        ) : null}

        {listen ? (
          <button
            type="button"
            className="btn btn--small learn-card__listen"
            onClick={onListen}
            disabled={demoPlaying}
          >
            {m.learn.listen}
          </button>
        ) : null}

        {step?.kind === 'quiz' ? <QuizPanel session={quiz} /> : null}

        {step?.kind === 'exercise' ? (
          <div className="learn-exercise">
            <p className="learn-exercise__prompt">{text?.prompt}</p>
            <p className="learn-exercise__progress" role="status">
              {!pianoReady
                ? m.learn.loadingPiano
                : exercise.progress.satisfied
                  ? m.learn.exerciseDone
                  : m.learn.progress({
                      done: exercise.progress.done,
                      total: exercise.progress.total,
                    })}
            </p>
            {wantsShift && pianoReady && !exercise.progress.satisfied ? (
              <p className="learn-exercise__shift">{m.learn.shiftHint}</p>
            ) : null}
            <div className="learn-exercise__actions">
              {exercise.hintAvailable && !showingHint ? (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setShowingHint(true);
                    if (listen) onListen();
                  }}
                >
                  {m.learn.showMe}
                </button>
              ) : null}
              {exercise.progress.done > 0 && !exercise.progress.satisfied ? (
                <button type="button" className="btn btn--small" onClick={exercise.reset}>
                  {m.learn.tryAgain}
                </button>
              ) : null}
              {exercise.skipAvailable ? (
                <button type="button" className="btn btn--small" onClick={advance}>
                  {m.learn.skipStep}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {isLast && steps.length > 0 ? (
          <div className="learn-card__outro">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                onProgress(withChapterDone(progress, chapterId));
                navigate('play');
              }}
            >
              {m.learn.tryOnPlay}
            </button>
          </div>
        ) : null}
      </div>

      <footer className="learn-runner__footer">
        <button
          type="button"
          className="btn"
          onClick={() => goTo(Math.max(0, index - 1))}
          disabled={index === 0}
        >
          {m.learn.back}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={advance}
          disabled={!canAdvance || steps.length === 0}
        >
          {isLast ? m.learn.finish : m.learn.next}
        </button>
      </footer>

      <div className="learn-runner__keyboard">
        <PianoKeyboard
          targetMidis={targetMidis}
          anchorMidi={anchorMidi}
          onAnchorChange={setAnchorMidi}
          onRangeChange={onRangeChange}
        />
      </div>
    </section>
  );
}
