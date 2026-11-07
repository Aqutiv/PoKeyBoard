import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deviceLights,
  EMPTY_SCENE,
  noteLight,
  type KeyLightScene,
} from '@/features/keyLights/keyLightModel';
import {
  COMING_LEVEL,
  dimLight,
  handLight,
  ledColour,
  ledLevel,
  LIGHT_COLOURS,
} from '@/features/keyLights/ledColours';
import { DARK } from '@/features/keyLights/partyKeysProtocol';

const top = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b);

function scene(overrides: Partial<KeyLightScene>): KeyLightScene {
  return { ...EMPTY_SCENE, ...overrides };
}

describe('LED colours', () => {
  it('squares each channel, and steps bright levels by 8', () => {
    expect(ledLevel(1)).toBe(255);
    expect(ledLevel(0)).toBe(0);
    expect(ledLevel(0.32 * 0.32)).toBe(26);
    expect(ledLevel(0.7) % 8).toBe(0);
    expect(ledLevel(0.04)).toBe(10);
  });

  it('lights the hands in the dark theme’s key colours, as the user checked them on the keyboard', () => {
    // The swatch confirmed on the user's PartyKeys (2026-11-07): distinct, and closer to the screen than raw.
    expect(ledColour(LIGHT_COLOURS.right)).toEqual({ r: 208, g: 128, b: 8 });
    expect(ledColour(LIGHT_COLOURS.left)).toEqual({ r: 176, g: 44, b: 0 });
    expect(ledColour(LIGHT_COLOURS.wrong)).toEqual({ r: 168, g: 32, b: 32 });
  });

  it('keeps the colours in step with src/themes.css', () => {
    // The dark theme's own block (as waterfallPalette.test reads it): `:root {` … `}`.
    const css = readFileSync('src/themes.css', 'utf8');
    const start = css.indexOf(':root {');
    const dark = css.slice(start, css.indexOf('}', start));
    const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(dark)?.[1];
    expect(token('--key-white-active-1')).toBe(LIGHT_COLOURS.right);
    expect(token('--key-white-left-1')).toBe(LIGHT_COLOURS.left);
    expect(token('--key-wrong-edge')).toBe(LIGHT_COLOURS.wrong);
    expect(token('--accent')).toBe(LIGHT_COLOURS.target);
  });

  it('lights a soft note dimmer than a loud one, and evenly with the shading off', () => {
    expect(top(handLight('right', 0, true))).toBeLessThan(top(handLight('right', 1, true)));
    expect(top(handLight('right', 0, true))).toBeGreaterThan(0);
    expect(handLight('right', 0, false)).toEqual(handLight('right', 1, false));
  });

  it('dims a hint to its level, keeping the hue', () => {
    const hint = dimLight(LIGHT_COLOURS.left, COMING_LEVEL);
    expect(top(hint)).toBe(COMING_LEVEL);
    expect(hint.r).toBeGreaterThan(hint.g);
  });
});

describe('noteLight', () => {
  const cue = { hand: 'left' as const, velocity: 0.5 };

  it('is dark with nothing to show', () => {
    expect(noteLight(EMPTY_SCENE, 60)).toEqual(DARK);
    expect(noteLight(scene({ shown: false, cues: new Map([[60, cue]]) }), 60)).toEqual(DARK);
  });

  it('lights the take’s notes in their hand', () => {
    expect(noteLight(scene({ cues: new Map([[60, cue]]) }), 60)).toEqual(
      handLight('left', 0.5, true),
    );
  });

  it('layers as the screen does: wrong over held over the take over a target over a coming note', () => {
    const full = scene({
      wrong: new Set([60]),
      held: new Map([
        [60, 1],
        [62, 1],
      ]),
      cues: new Map([
        [60, cue],
        [62, cue],
        [64, cue],
      ]),
      targets: new Map<number, 'left' | 'right' | null>([
        [64, 'right'],
        [65, 'right'],
        [67, null],
      ]),
      coming: new Map([
        [65, 'left'],
        [69, 'left'],
      ]),
    });
    expect(noteLight(full, 60)).toEqual(ledColour(LIGHT_COLOURS.wrong));
    expect(noteLight(full, 62)).toEqual(handLight('right', 1, true));
    expect(noteLight(full, 64)).toEqual(handLight('left', 0.5, true));
    expect(noteLight(full, 65)).toEqual(ledColour(LIGHT_COLOURS.right));
    expect(noteLight(full, 67)).toEqual(ledColour(LIGHT_COLOURS.target));
    expect(noteLight(full, 69)).toEqual(dimLight(LIGHT_COLOURS.left, COMING_LEVEL));
  });
});

describe('deviceLights', () => {
  it('puts C3–B5 on the 36 keys, and follows the keyboard’s octave', () => {
    const lit = scene({
      cues: new Map([
        [48, { hand: 'right', velocity: 1 }],
        [83, { hand: 'right', velocity: 1 }],
        [84, { hand: 'right', velocity: 1 }],
      ]),
    });
    const atZero = deviceLights(lit, { octave: 0, transpose: 0 });
    expect(atZero).toHaveLength(36);
    expect(top(atZero[0] as typeof DARK)).toBeGreaterThan(0);
    expect(top(atZero[35] as typeof DARK)).toBeGreaterThan(0);

    const up = deviceLights(lit, { octave: 1, transpose: 0 });
    expect(top(up[0] as typeof DARK)).toBe(0);
    expect(top(up[24] as typeof DARK)).toBeGreaterThan(0); // 84 = C6, key 24 at OCT+1
  });
});
