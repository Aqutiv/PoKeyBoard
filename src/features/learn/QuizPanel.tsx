import { useMessages } from '@/i18n/i18nContext';
import { KeyboardDiagram } from './KeyboardDiagram';
import { noteLabel } from './noteLabel';
import { QUIZ_HIGH_MIDI, QUIZ_LOW_MIDI, type QuizSession } from './useQuiz';

interface QuizPanelProps {
  session: QuizSession;
}

/**
 * A recognition round: one key lights up, the user names it.
 *
 * Rendered inline in the chapter card and deliberately **not** a dialog. The
 * computer-keyboard input layer ignores every keystroke while
 * `[aria-modal="true"]` exists anywhere on the page, so making this a modal
 * would silently kill note input for the whole lesson.
 */
export function QuizPanel({ session }: QuizPanelProps) {
  const m = useMessages();

  return (
    <div className="learn-quiz">
      <KeyboardDiagram
        lowMidi={QUIZ_LOW_MIDI}
        highMidi={QUIZ_HIGH_MIDI}
        highlight={[session.midi]}
        spelling={session.spelling}
        ariaLabel={m.learn.diagramLabel}
      />
      <p className="learn-quiz__prompt">{m.learn.quizPrompt}</p>
      <div className="learn-quiz__choices">
        {session.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className="learn-quiz__choice"
            aria-label={m.learn.quizAnswerLabel({ note: noteLabel(choice, session.spelling) })}
            disabled={session.satisfied}
            onClick={() => session.answer(choice)}
          >
            {noteLabel(choice, session.spelling)}
          </button>
        ))}
      </div>
      <p className="learn-quiz__status" role="status">
        {session.satisfied
          ? m.learn.exerciseDone
          : session.wrong !== null
            ? m.learn.quizWrong({ answer: noteLabel(session.midi, session.spelling) })
            : m.learn.progress({ done: session.done, total: session.total })}
      </p>
    </div>
  );
}
