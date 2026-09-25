import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { KeyboardDiagram } from './KeyboardDiagram';
import { StaffSnippet } from './StaffSnippet';
import { noteLabel, type NoteSpelling } from './noteLabel';
import type { LearnPhrase } from './types';
import { QUIZ_HIGH_MIDI, QUIZ_LOW_MIDI, type QuizChoice, type QuizSession } from './useQuiz';

interface QuizPanelProps {
  session: QuizSession;
  /**
   * Play an ear round's chord. The runner's demo player, lock and all: a
   * scheduled note cannot be unscheduled, so a second press while the first
   * is still sounding must be refused rather than stacked on top.
   */
  onHear: (phrase: LearnPhrase) => void;
  /** A demo is sounding; the Hear button waits for it. */
  hearing: boolean;
}

/** An answer button's words: a note's name, or a chord's quality. */
function choiceLabel(choice: QuizChoice, spelling: NoteSpelling, m: Messages): string {
  return typeof choice === 'number'
    ? noteLabel(choice, spelling)
    : m.learn.chordQualityAnswer[choice];
}

/**
 * A recognition round: the app shows — or plays — something, and the user
 * names it.
 *
 * Rendered inline in the chapter card and deliberately **not** a dialog. The
 * computer-keyboard input layer ignores every keystroke while
 * `[aria-modal="true"]` exists anywhere on the page, so making this a modal
 * would silently kill note input for the whole lesson.
 */
export function QuizPanel({ session, onHear, hearing }: QuizPanelProps) {
  const m = useMessages();
  const byEar = session.kind === 'chordQuality';

  const prompt = byEar
    ? m.learn.chordQualityPrompt
    : session.kind === 'readNote'
      ? m.learn.readNotePrompt
      : m.learn.quizPrompt;

  const correction =
    typeof session.correct === 'number'
      ? m.learn.quizWrong({ answer: noteLabel(session.midi, session.spelling) })
      : m.learn.chordQualityWrong({ answer: m.learn.chordQuality[session.correct] });

  return (
    <div className="learn-quiz">
      {byEar ? (
        // Nothing to look at on purpose: a triad drawn on a staff can be told
        // major or minor by counting, and this question is about the sound.
        <button
          type="button"
          className="btn btn--small learn-quiz__hear"
          disabled={hearing || session.hear === null || session.satisfied}
          onClick={() => {
            if (!session.hear) return;
            onHear(session.hear);
            session.markHeard();
          }}
        >
          {m.learn.hearIt}
        </button>
      ) : session.phrase ? (
        // A reading round: the staff is the question. The label stays generic
        // on purpose — naming the note here would announce the answer, and for
        // the same reason no `litMidis` is passed: lighting the head when the
        // matching key is pressed would let the quiz be brute-forced.
        <StaffSnippet
          phrase={session.phrase}
          staves={session.staves}
          ariaLabel={m.learn.staffLabel}
        />
      ) : (
        <KeyboardDiagram
          lowMidi={QUIZ_LOW_MIDI}
          highMidi={QUIZ_HIGH_MIDI}
          highlight={[session.midi]}
          spelling={session.spelling}
          ariaLabel={m.learn.diagramLabel}
        />
      )}
      <p className="learn-quiz__prompt">{prompt}</p>
      <div className="learn-quiz__choices">
        {session.choices.map((choice) => {
          const label = choiceLabel(choice, session.spelling, m);
          return (
            <button
              key={String(choice)}
              type="button"
              className="learn-quiz__choice"
              aria-label={m.learn.quizAnswerLabel({ note: label })}
              disabled={session.satisfied || session.needsHearing}
              onClick={() => session.answer(choice)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="learn-quiz__status" role="status">
        {session.satisfied
          ? m.learn.exerciseDone
          : session.wrong !== null
            ? correction
            : m.learn.progress({ done: session.done, total: session.total })}
      </p>
    </div>
  );
}
