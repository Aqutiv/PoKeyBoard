import { useMessages } from '@/i18n/i18nContext';
import { midiToNoteName } from '@/utils/midi';
import { KeyboardDiagram } from './KeyboardDiagram';
import { QUIZ_BASE_MIDI, QUIZ_HIGH_MIDI, QUIZ_LOW_MIDI, type QuizSession } from './useQuiz';

/** The letter alone: octave numbers are not what is being asked about. */
function letterOf(pitchClass: number): string {
  return midiToNoteName(QUIZ_BASE_MIDI + pitchClass).replace(/\d/g, '');
}

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
        ariaLabel={m.learn.diagramLabel}
      />
      <p className="learn-quiz__prompt">{m.learn.quizPrompt}</p>
      <div className="learn-quiz__choices">
        {session.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className="learn-quiz__choice"
            aria-label={m.learn.quizAnswerLabel({ note: letterOf(choice) })}
            disabled={session.satisfied}
            onClick={() => session.answer(choice)}
          >
            {letterOf(choice)}
          </button>
        ))}
      </div>
      <p className="learn-quiz__status" role="status">
        {session.satisfied
          ? m.learn.exerciseDone
          : session.wrong !== null
            ? m.learn.quizWrong({ answer: letterOf(session.midi % 12) })
            : m.learn.progress({ done: session.done, total: session.total })}
      </p>
    </div>
  );
}
