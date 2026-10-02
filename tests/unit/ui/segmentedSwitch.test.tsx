import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedSwitch } from '@/ui/SegmentedSwitch';

type Level = 'beginner' | 'intermediate' | 'advanced';

const OPTIONS: { value: Level; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

function renderSwitch(value: Level, onChange: (value: Level) => void = () => {}) {
  render(
    <SegmentedSwitch ariaLabel="Learn level" options={OPTIONS} value={value} onChange={onChange} />,
  );
  return screen.getByRole('group', { name: 'Learn level' });
}

describe('SegmentedSwitch', () => {
  afterEach(cleanup);

  it('offers one toggle button per option, in order, the value pressed', () => {
    const group = renderSwitch('intermediate');
    const segments = within(group).getAllByRole('button');
    expect(segments.map((segment) => segment.textContent)).toEqual([
      'Beginner',
      'Intermediate',
      'Advanced',
    ]);
    expect(segments.map((segment) => segment.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('reports the option pressed', () => {
    const onChange = vi.fn();
    const group = renderSwitch('beginner', onChange);
    fireEvent.click(within(group).getByRole('button', { name: 'Advanced' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('advanced');
  });
});
