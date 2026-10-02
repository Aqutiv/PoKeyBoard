import './segmentedSwitch.css';

export interface SegmentedSwitchOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  /** The group's accessible name: the switch shows no title of its own. */
  ariaLabel: string;
  options: readonly SegmentedSwitchOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Lets the labels shrink on a narrow phone: the type steps down from 14px
   * with the viewport, and ellipsis backs it up for whichever locale still
   * overruns. For a switch whose segments are too many, or their labels too
   * long, to hold 14px at 320px; a roomier one keeps its labels at full size.
   */
  shrink?: boolean;
}

/**
 * One segment per choice, filling the page width, the chosen one filled: the
 * library's folders, Learn's levels and Settings' sections. A named group of
 * toggle buttons, each saying whether it is the one pressed.
 */
export function SegmentedSwitch<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  shrink = false,
}: SegmentedSwitchProps<T>) {
  return (
    <div
      className={`segmented-switch${shrink ? ' segmented-switch--shrink' : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented-switch__option${option.value === value ? ' is-selected' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
