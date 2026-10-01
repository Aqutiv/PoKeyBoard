import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoiceSwitch } from '@/features/settings/ChoiceSwitch';

type Sensitivity = 'light' | 'normal' | 'firm';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'normal', label: 'Normal' },
  { value: 'firm', label: 'Firm' },
] as const;

function renderSwitch(value: Sensitivity, onChange = vi.fn()) {
  const result = render(
    <ChoiceSwitch<Sensitivity>
      label="Touch sensitivity"
      value={value}
      options={OPTIONS}
      onChange={onChange}
    />,
  );
  return { ...result, onChange };
}

describe('ChoiceSwitch', () => {
  afterEach(cleanup);

  it('is a radio group named by its label, a radio per segment, the chosen one checked', () => {
    renderSwitch('normal');
    const group = screen.getByRole('radiogroup', { name: 'Touch sensitivity' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['light', 'normal', 'firm']);
    expect(within(group).getByRole('radio', { name: 'Normal' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Firm' })).not.toBeChecked();
    // One name across the group, so the browser's arrow keys stay within it.
    expect(new Set(radios.map((radio) => radio.getAttribute('name'))).size).toBe(1);
  });

  it('reports the segment chosen, and fills whichever segment its value names', () => {
    const { onChange, rerender } = renderSwitch('normal');
    fireEvent.click(screen.getByRole('radio', { name: 'Firm' }));
    expect(onChange).toHaveBeenCalledWith('firm');

    const selected = () =>
      document.querySelector('.choice-switch__option.is-selected')?.textContent ?? null;
    expect(selected()).toBe('Normal');
    rerender(
      <ChoiceSwitch<Sensitivity>
        label="Touch sensitivity"
        value="firm"
        options={OPTIONS}
        onChange={onChange}
      />,
    );
    expect(selected()).toBe('Firm');
    expect(screen.getByRole('radio', { name: 'Firm' })).toBeChecked();
  });

  it('keeps two switches on one page apart', () => {
    render(
      <>
        <ChoiceSwitch
          label="Velocity"
          value="a"
          options={[{ value: 'a', label: 'A' }]}
          onChange={vi.fn()}
        />
        <ChoiceSwitch
          label="Curve"
          value="a"
          options={[{ value: 'a', label: 'A' }]}
          onChange={vi.fn()}
        />
      </>,
    );
    const names = screen.getAllByRole('radio').map((radio) => radio.getAttribute('name'));
    expect(names[0]).not.toBe(names[1]);
    expect(screen.getByRole('radiogroup', { name: 'Velocity' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Curve' })).toBeTruthy();
  });
});
