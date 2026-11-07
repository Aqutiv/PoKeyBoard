import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getScreenCues } from '@/features/keyboard/screenCues';
import { KeyboardDiagram } from '@/features/learn/KeyboardDiagram';

afterEach(() => {
  cleanup();
});

describe('KeyboardDiagram', () => {
  it('hands the keys it marks to a light-up keyboard, and takes them back when it goes', () => {
    const { rerender, unmount } = render(
      <KeyboardDiagram lowMidi={60} highMidi={72} highlight={[65]} ariaLabel="Keys" />,
    );
    expect([...getScreenCues().pictured]).toEqual([65]);

    rerender(
      <KeyboardDiagram
        lowMidi={60}
        highMidi={72}
        highlight={[61, 63]}
        highlightSecondary={[66, 68, 70]}
        ariaLabel="Keys"
      />,
    );
    expect([...getScreenCues().pictured]).toEqual([61, 63]);
    expect([...getScreenCues().picturedSecond]).toEqual([66, 68, 70]);

    unmount();
    expect(getScreenCues().pictured.size).toBe(0);
    expect(getScreenCues().picturedSecond.size).toBe(0);
  });
});
