import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstrumentSwitchState } from '@/audio/AudioEngine';
import type { PianoInstrumentId } from '@/audio/instruments';
import { PianoSwitchRing } from '@/features/settings/PianoSwitchRing';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function state(
  sounding: PianoInstrumentId,
  pending: PianoInstrumentId | null = null,
  progress = 0,
  failed: PianoInstrumentId | null = null,
): InstrumentSwitchState {
  return { sounding, pending, failed, progress };
}

function ring(container: HTMLElement) {
  const svg = container.querySelector('.switch-ring');
  const arc = container.querySelector<SVGRectElement>('.switch-ring__arc');
  return {
    state: svg?.getAttribute('data-ring-state') ?? null,
    offset: arc ? Number.parseFloat(arc.style.strokeDashoffset) : null,
  };
}

describe('the ring a change of piano draws on its control', () => {
  it('runs round as the new piano decodes', () => {
    const { container, rerender } = render(
      <PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0)} />,
    );
    expect(ring(container)).toEqual({ state: 'loading', offset: 100 });
    rerender(<PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0.4)} />);
    expect(ring(container)).toEqual({ state: 'loading', offset: 60 });
  });

  it('glows as the new piano takes over, then goes', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0.9)} />,
    );
    rerender(<PianoSwitchRing state={state('bitklavier-grand')} />);
    expect(ring(container)).toEqual({ state: 'done', offset: 0 });
    act(() => vi.advanceTimersByTime(1_000));
    expect(ring(container).state).toBeNull();
  });

  it('flashes red when the new piano cannot be loaded', () => {
    const { container, rerender } = render(
      <PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0.3)} />,
    );
    rerender(<PianoSwitchRing state={state('salamander-grand', null, 0, 'bitklavier-grand')} />);
    expect(ring(container).state).toBe('failed');
  });

  it('simply goes when the switch is called off', () => {
    const { container, rerender } = render(
      <PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0.3)} />,
    );
    rerender(<PianoSwitchRing state={state('salamander-grand')} />);
    expect(ring(container).state).toBeNull();
  });

  it('starts afresh for a newer choice, rather than running back', () => {
    const { container, rerender } = render(
      <PianoSwitchRing state={state('salamander-grand', 'bitklavier-grand', 0.7)} />,
    );
    const first = container.querySelector('.switch-ring');
    rerender(<PianoSwitchRing state={state('salamander-grand', 'headroom-grand', 0)} />);
    expect(ring(container)).toEqual({ state: 'loading', offset: 100 });
    expect(container.querySelector('.switch-ring')).not.toBe(first);
  });

  it('on a piano card, shows only that piano’s switch', () => {
    const loading = state('salamander-grand', 'bitklavier-grand', 0.5);
    const steinway = render(<PianoSwitchRing state={loading} piano="bitklavier-grand" />);
    const headroom = render(<PianoSwitchRing state={loading} piano="headroom-grand" />);
    expect(ring(steinway.container).state).toBe('loading');
    expect(ring(headroom.container).state).toBeNull();

    // Overtaken by the Headroom: the Steinway card's ring goes without a glow.
    const overtaken = state('salamander-grand', 'headroom-grand', 0);
    steinway.rerender(<PianoSwitchRing state={overtaken} piano="bitklavier-grand" />);
    headroom.rerender(<PianoSwitchRing state={overtaken} piano="headroom-grand" />);
    expect(ring(steinway.container).state).toBeNull();
    expect(ring(headroom.container).state).toBe('loading');
  });
});
