import { useMemo } from 'react';
import { layoutKeyboard } from '@/features/keyboard/keyboardGeometry';
import { noteLabel, type NoteSpelling } from './noteLabel';
import '@/features/keyboard/keyboard.css';

interface KeyboardDiagramProps {
  lowMidi: number;
  highMidi: number;
  /** Tinted with the accent colour. */
  highlight?: readonly number[];
  /** A second tint, for showing one group apart from another. */
  highlightSecondary?: readonly number[];
  /** Keys to print a name on. */
  labels?: readonly number[];
  /** Which name a labelled black key gets. Defaults to sharps. */
  spelling?: NoteSpelling;
  ariaLabel: string;
}

/**
 * A picture of a keyboard: the same geometry and key styling as the real one,
 * with no pointer handling. Imports `keyboard.css` itself rather than relying
 * on the live keyboard having been mounted first.
 */
export function KeyboardDiagram({
  lowMidi,
  highMidi,
  highlight,
  highlightSecondary,
  labels,
  spelling,
  ariaLabel,
}: KeyboardDiagramProps) {
  const layout = useMemo(() => layoutKeyboard(lowMidi, highMidi), [lowMidi, highMidi]);
  const whiteWidthPercent = 100 / layout.whiteCount;

  const classFor = (midi: number, isBlack: boolean): string => {
    const base = `piano-key piano-key--${isBlack ? 'black' : 'white'}`;
    if (highlight?.includes(midi)) return `${base} is-diagram-mark`;
    if (highlightSecondary?.includes(midi)) return `${base} is-diagram-mark-2`;
    return base;
  };

  const render = (isBlack: boolean) =>
    layout.keys
      .filter((key) => key.isBlack === isBlack)
      .map((key) => (
        <div
          key={key.midi}
          className={classFor(key.midi, isBlack)}
          style={{
            left: `${key.x * whiteWidthPercent}%`,
            width: `${key.width * whiteWidthPercent}%`,
          }}
        >
          {labels?.includes(key.midi) ? (
            // The name alone: octave numbers are a chapter 1 step 9 idea.
            <span className="learn-diagram__label">{noteLabel(key.midi, spelling)}</span>
          ) : null}
        </div>
      ));

  return (
    <div className="learn-diagram" role="img" aria-label={ariaLabel}>
      <div className="learn-diagram__keys">
        {render(false)}
        {render(true)}
      </div>
    </div>
  );
}
