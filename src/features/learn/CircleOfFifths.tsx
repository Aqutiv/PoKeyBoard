import { CIRCLE_SLOTS, circleCount, circleKeyName, slotHolds } from './circleSlots';

interface CircleOfFifthsProps {
  /** Keys to fill with the accent colour, by signature in fifths. */
  highlight?: readonly number[];
  /** Keys to ring, for showing one group apart from another. */
  highlightSecondary?: readonly number[];
  ariaLabel: string;
}

/** The drawing's own units; the SVG scales to whatever width it is given. */
const SIZE = 200;
const CENTRE = SIZE / 2;
/** The ring the keys sit on. */
const RING_R = 74;
/** Each key's disc: a little air between neighbours, 38 apart on the ring. */
const DISC_R = 17;
/** Where each key's sharp or flat count sits, inside the ring. */
const COUNT_R = 44;

/** A point `radius` out from the centre at slot `index`, clockwise from the top. */
function at(radius: number, index: number): { x: number; y: number } {
  const angle = (index * Math.PI) / 6;
  return { x: CENTRE + radius * Math.sin(angle), y: CENTRE - radius * Math.cos(angle) };
}

/**
 * A picture of the circle of fifths: the twelve major keys in a ring, each with
 * its count of sharps or flats. Tinted the way the keyboard diagram is — filled
 * for what a step is naming, ringed for a second group — and, like it, the
 * first tint wins, so a key in both shows only the first.
 *
 * Styled from `learn.css` rather than through presentation attributes, so the
 * theme tokens reach the SVG in both themes.
 */
export function CircleOfFifths({ highlight, highlightSecondary, ariaLabel }: CircleOfFifthsProps) {
  const marked = (keys: readonly number[] | undefined, slot: number): boolean =>
    keys?.some((fifths) => slotHolds(slot, fifths)) ?? false;

  return (
    <div className="learn-circle" role="img" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
        <circle className="learn-circle__ring" cx={CENTRE} cy={CENTRE} r={RING_R} />
        {CIRCLE_SLOTS.map((slot, index) => {
          const disc = at(RING_R, index);
          const count = at(COUNT_R, index);
          const name = circleKeyName(slot);
          const mark = marked(highlight, slot)
            ? ' is-circle-mark'
            : marked(highlightSecondary, slot)
              ? ' is-circle-mark-2'
              : '';
          return (
            <g key={slot} className={`learn-circle__key${mark}`} data-fifths={slot}>
              <circle cx={disc.x} cy={disc.y} r={DISC_R} />
              <text
                className={`learn-circle__name${name.includes('/') ? ' learn-circle__name--pair' : ''}`}
                x={disc.x}
                y={disc.y}
              >
                {name}
              </text>
              <text className="learn-circle__count" x={count.x} y={count.y}>
                {circleCount(slot)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
