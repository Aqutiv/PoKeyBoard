import { describe, expect, it } from 'vitest';
import {
  EVEN_SHADE_VELOCITY,
  KEY_SHADE_FLOOR,
  keyShade,
  keyShadeStrength,
} from '@/features/keyboard/keyShading';
import { SETTINGS_DEFAULTS } from '@/state/useSettingsStore';

describe('how deep a lit key is shaded', () => {
  it('runs from the floor at no velocity to the full colour at the loudest', () => {
    expect(keyShadeStrength(0, true)).toBe(KEY_SHADE_FLOOR);
    expect(keyShadeStrength(1, true)).toBe(1);
    expect(keyShade(0, true)).toBe('42%');
    expect(keyShade(1, true)).toBe('100%');
  });

  it('deepens by the same step for every step of velocity', () => {
    const step = keyShadeStrength(0.5, true) - keyShadeStrength(0.25, true);
    expect(keyShadeStrength(0.75, true) - keyShadeStrength(0.5, true)).toBeCloseTo(step, 12);
    expect(keyShadeStrength(0.75, true)).toBeGreaterThan(keyShadeStrength(0.5, true));
  });

  it('keeps a velocity past either end at that end', () => {
    expect(keyShadeStrength(-0.2, true)).toBe(keyShadeStrength(0, true));
    expect(keyShadeStrength(1.3, true)).toBe(keyShadeStrength(1, true));
  });

  it('shades a key it cannot read a velocity for as it would with the shading off', () => {
    expect(keyShade(Number.NaN, true)).toBe(keyShade(0.2, false));
    expect(keyShade(Number.POSITIVE_INFINITY, true)).toBe(keyShade(0.2, false));
  });

  it('shades every key alike while the shading does not follow touch', () => {
    expect(keyShade(0.1, false)).toBe(keyShade(0.95, false));
    expect(keyShade(0.1, false)).toBe(keyShade(EVEN_SHADE_VELOCITY, true));
  });

  it('evens out at the velocity the computer keyboard plays by default', () => {
    // Kept apart from the settings store, which would bring the audio engine
    // in with it; this keeps the two in step.
    expect(EVEN_SHADE_VELOCITY).toBe(SETTINGS_DEFAULTS.fixedVelocity);
  });
});
