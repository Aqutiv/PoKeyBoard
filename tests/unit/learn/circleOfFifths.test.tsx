import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CircleOfFifths } from '@/features/learn/CircleOfFifths';
import { CIRCLE_SLOTS, circleCount, circleKeyName, slotHolds } from '@/features/learn/circleSlots';
import { majorTonicPitchClass } from '@/features/notation/keySignature';

describe('the circle’s slots', () => {
  it('run clockwise from C, a fifth up at every step', () => {
    expect(CIRCLE_SLOTS.map(circleKeyName)).toEqual([
      'C',
      'G',
      'D',
      'A',
      'E',
      'B',
      'F♯/G♭',
      'D♭',
      'A♭',
      'E♭',
      'B♭',
      'F',
    ]);
    CIRCLE_SLOTS.forEach((slot, i) => {
      const next = CIRCLE_SLOTS[(i + 1) % CIRCLE_SLOTS.length] as number;
      expect((majorTonicPitchClass(slot) + 7) % 12, circleKeyName(slot)).toBe(
        majorTonicPitchClass(next),
      );
    });
  });

  it('count one more sharp clockwise and one more flat anticlockwise', () => {
    expect(CIRCLE_SLOTS.map(circleCount)).toEqual([
      '0',
      '1♯',
      '2♯',
      '3♯',
      '4♯',
      '5♯',
      '6♯/6♭',
      '5♭',
      '4♭',
      '3♭',
      '2♭',
      '1♭',
    ]);
  });

  it('meet at the bottom, where six sharps and six flats are one key', () => {
    expect(slotHolds(6, 6)).toBe(true);
    expect(slotHolds(6, -6)).toBe(true);
    expect(slotHolds(-5, -6)).toBe(false);
    expect(slotHolds(2, 2)).toBe(true);
    expect(slotHolds(2, -2)).toBe(false);
  });
});

describe('CircleOfFifths', () => {
  afterEach(cleanup);

  const slotClass = (container: HTMLElement, fifths: number) =>
    container.querySelector(`[data-fifths="${fifths}"]`)?.getAttribute('class');

  it('is one picture, named for a screen reader, of the twelve keys in order', () => {
    const { container } = render(<CircleOfFifths ariaLabel="Circle of fifths" />);
    expect(screen.getByRole('img', { name: 'Circle of fifths' })).toBeTruthy();
    const names = [...container.querySelectorAll('.learn-circle__name')].map(
      (name) => name.textContent,
    );
    expect(names).toEqual(CIRCLE_SLOTS.map(circleKeyName));
  });

  it('fills the first tint and rings the second', () => {
    const { container } = render(
      <CircleOfFifths ariaLabel="c" highlight={[1]} highlightSecondary={[-1]} />,
    );
    expect(slotClass(container, 1)).toBe('learn-circle__key is-circle-mark');
    expect(slotClass(container, -1)).toBe('learn-circle__key is-circle-mark-2');
    expect(slotClass(container, 0)).toBe('learn-circle__key');
  });

  it('lets the first tint win a key named in both, as the keyboard diagram does', () => {
    const { container } = render(
      <CircleOfFifths ariaLabel="c" highlight={[2]} highlightSecondary={[2]} />,
    );
    expect(slotClass(container, 2)).toBe('learn-circle__key is-circle-mark');
  });

  it('marks the bottom slot for either of the keys it stands for', () => {
    const { container } = render(<CircleOfFifths ariaLabel="c" highlight={[-6]} />);
    expect(slotClass(container, 6)).toBe('learn-circle__key is-circle-mark');
  });
});
