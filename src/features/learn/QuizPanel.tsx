import { majorTonicName } from '@/features/notation/keySignature';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import { KeyboardDiagram } from './KeyboardDiagram';
import { StaffSnippet } from './StaffSnippet';
import { noteLabel } from './noteLabel';
import type { LearnPhrase } from './types';
import { QUIZ_HIGH_MIDI, QUIZ_LOW_MIDI, type QuizSession } from './useQuiz';

interface QuizPanelProps {
  session: QuizSession;
  /**
   * Play an ear round's chord. The runner's demo player, lock and all: a
   * scheduled note cannot be unscheduled, so a second press while the first
   * is still sounding must be refused rather than stacked on top.
   */
  onHear: (phrase: LearnPhrase) => Promise<boolean>;
  /** A demo is sounding; the Hear button waits for it. */
  hearing: boolean;
}

/*
 * Each of these switches over the question's kind, like the runner's
 * `canAdvance`: a new kind of question is a compile error here rather than a
 * round quietly asked in another kind's words.
 */

/** What the round asks, in words. */
function promptFor(session: QuizSession, m: Messages): string {
  switch (session.kind) {
    case 'nameTheKey':
      return m.learn.quizPrompt;
    case 'readNote':
      return m.learn.readNotePrompt;
    case 'chordQuality':
      return m.learn.chordQualityPrompt;
    case 'keySignature':
      return m.learn.keySignaturePrompt;
  }
}

/** Answer button `index`'s words: a note's name, a key's, or a chord's quality. */
function choiceLabel(session: QuizSession, index: number, m: Messages): string {
  const choice = session.choices[index] ?? 0;
  switch (session.kind) {
    case 'keySignature':
      // By the key, not the home note: F♯ major and G♭ major share one.
      return majorTonicName(session.keys?.[index] ?? 0);
    case 'nameTheKey':
    case 'readNote':
    case 'chordQuality':
      return typeof choice === 'number'
        ? noteLabel(choice, session.spelling)
        : m.learn.chordQualityAnswer[choice];
  }
}

/** What a wrong answer is corrected to. */
function correctionFor(session: QuizSession, m: Messages): string {
  switch (session.kind) {
    case 'keySignature':
      // The round's own key, never a note built from `midi`: a signature
      // round draws no key to build one from.
      return m.learn.keySignatureWrong({
        key: m.learn.majorKey({ note: majorTonicName(session.signature ?? 0) }),
      });
    case 'nameTheKey':
    case 'readNote':
    case 'chordQuality':
      return typeof session.correct === 'number'
        ? m.learn.quizWrong({ answer: noteLabel(session.midi, session.spelling) })
        : m.learn.chordQualityWrong({ answer: m.learn.chordQuality[session.correct] });
  }
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
            const { markHeard } = session;
            // Heard once it is actually scheduled, not on the click: loading a
            // cold range takes time and can fail, and answers unlocked on the
            // click would open the round with nothing played.
            void onHear(session.hear).then((played) => {
              if (played) markHeard();
            });
          }}
        >
          {m.learn.hearIt}
        </button>
      ) : session.phrase ? (
        // The staff is the question. For a note, the label stays generic on
        // purpose — naming the note would announce the answer, and for the
        // same reason no `litMidis` is passed: lighting the head when the
        // matching key is pressed would let the quiz be brute-forced. A
        // signature is different: saying "two sharps" is saying what is drawn,
        // and leaves the key to be worked out, so it is said.
        <StaffSnippet
          phrase={session.phrase}
          staves={session.staves}
          ariaLabel={
            session.signature !== null
              ? m.learn.keySignatureLabel({ fifths: session.signature })
              : m.learn.staffLabel
          }
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
      <p className="learn-quiz__prompt">{promptFor(session, m)}</p>
      <div className="learn-quiz__choices">
        {session.choices.map((choice, index) => {
          const label = choiceLabel(session, index, m);
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
            ? correctionFor(session, m)
            : m.learn.progress({ done: session.done, total: session.total })}
      </p>
    </div>
  );
}
