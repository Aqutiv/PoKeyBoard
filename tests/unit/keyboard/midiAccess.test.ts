import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetForTests, getSnapshot } from '@/features/keyboard/midiAccess';

const original = Object.getOwnPropertyDescriptor(navigator, 'requestMIDIAccess');

beforeEach(() => {
  __resetForTests();
});

afterEach(() => {
  __resetForTests();
  if (original) Object.defineProperty(navigator, 'requestMIDIAccess', original);
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'requestMIDIAccess');
});

describe('midiAccess snapshot', () => {
  /**
   * Safari and Firefox have no Web MIDI. Settings has to know that before
   * anything asks for access, or it renders a live-looking toggle that can
   * never work and only corrects itself once the user clicks it.
   */
  it('reads as unsupported before anything requests access', () => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'requestMIDIAccess');
    expect(getSnapshot().kind).toBe('unsupported');
  });

  it('stays referentially stable so useSyncExternalStore cannot loop', () => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'requestMIDIAccess');
    expect(getSnapshot()).toBe(getSnapshot());
  });

  it('reads as idle where Web MIDI exists but has not been asked for', () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: () => Promise.resolve({}),
    });
    expect(getSnapshot().kind).toBe('idle');
  });
});
