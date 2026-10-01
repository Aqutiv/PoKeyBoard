import { useId } from 'react';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A setting with a few short choices, on one row: its name, then the choices
 * as segments, the chosen one filled. Each segment is a real radio button
 * spread invisibly over it, so the group keeps its radio roles, its arrow keys
 * and its tab stop. When the name and the segments do not fit one line, the
 * segments wrap beneath the name.
 */
export function ChoiceSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  // One name per switch, so the browser's arrow keys move within it.
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className="setting-row choice-row" role="radiogroup" aria-labelledby={labelId}>
      <span id={labelId}>{label}</span>
      <span className="choice-switch">
        {options.map((option) => (
          <label
            key={option.value}
            className={`choice-switch__option${option.value === value ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className="choice-switch__text">{option.label}</span>
          </label>
        ))}
      </span>
    </div>
  );
}
