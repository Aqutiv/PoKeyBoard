import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyShadeStrength } from '@/features/keyboard/keyShading';
import { barColour, mixOklab, WATERFALL_PALETTES } from '@/features/waterfall/waterfallPalette';

/** The custom properties one theme block of src/themes.css sets. */
function themeTokens(selector: string): Map<string, string> {
  const css = readFileSync(path.resolve('src', 'themes.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1] as string,
      (match[2] as string).trim(),
    ]),
  );
}

const TOKENS = {
  dark: themeTokens(':root'),
  light: themeTokens("html[data-theme='light']"),
};

function channels(colour: string): number[] {
  if (colour.startsWith('#')) {
    const n = Number.parseInt(colour.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

/** The largest difference between two colours in any one channel, out of 255. */
function apart(a: string, b: string): number {
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - (y[i] as number))));
}

describe('WATERFALL_PALETTES', () => {
  it.each(['dark', 'light'] as const)('copies the %s theme’s key colours', (theme) => {
    const tokens = TOKENS[theme];
    const palette = WATERFALL_PALETTES[theme];
    expect(palette.stage).toBe(tokens.get('--keybed'));
    expect(palette.right).toEqual({
      white: tokens.get('--key-white-active-2'),
      black: tokens.get('--key-black-active-2'),
      edge: tokens.get('--key-black-active-1'),
    });
    expect(palette.left).toEqual({
      white: tokens.get('--key-white-left-2'),
      black: tokens.get('--key-black-left-2'),
      edge: tokens.get('--key-black-left-1'),
    });
    expect(palette.ivory).toBe(tokens.get('--ivory'));
    expect(palette.keyBlack).toBe(tokens.get('--key-black'));
    expect(palette.restart).toBe(tokens.get('--key-white-active-1'));
    // The guides are the ivory, faint.
    expect(channels(palette.guide)).toEqual(channels(tokens.get('--ivory') ?? ''));
  });
});

describe('mixOklab', () => {
  // Chromium's own color-mix(in oklab, …) for these, read back through a canvas.
  const CHROMIUM: Array<[string, number, string, string]> = [
    ['#f0c759', 0.42, '#f5efe2', '#f3dfae'],
    ['#f0c759', 0.71, '#f5efe2', '#f2d387'],
    ['#e8852c', 0.42, '#f5efe2', '#f3c49d'],
    ['#e8852c', 0.71, '#f5efe2', '#eea56b'],
    ['#977103', 0.42, '#201d1a', '#4e3f1e'],
    ['#977103', 0.71, '#201d1a', '#72571a'],
    ['#a74f0c', 0.42, '#201d1a', '#56331d'],
    ['#a74f0c', 0.71, '#201d1a', '#7d411a'],
    ['#f2cb61', 0.42, '#fbf7ec', '#f7e5b6'],
    ['#f2cb61', 0.71, '#fbf7ec', '#f5d88e'],
    ['#ef8d3b', 0.42, '#fbf7ec', '#f9cca7'],
    ['#ef8d3b', 0.71, '#fbf7ec', '#f5ad75'],
    ['#a67e0b', 0.42, '#26221e', '#584723'],
    ['#a67e0b', 0.71, '#26221e', '#7e621f'],
    ['#b25a15', 0.42, '#26221e', '#5e3a22'],
    ['#b25a15', 0.71, '#26221e', '#874a20'],
  ];

  it.each(CHROMIUM)(
    'mixes %s at %s toward %s as a key’s color-mix() does',
    (a, share, b, chromium) => {
      expect(apart(mixOklab(a, b, share), chromium)).toBeLessThanOrEqual(1);
    },
  );

  it('gives the colour itself at full share and the other at none', () => {
    expect(mixOklab('#f0c759', '#f5efe2', 1)).toBe('#f0c759');
    expect(mixOklab('#f0c759', '#f5efe2', 0)).toBe('#f5efe2');
  });
});

describe('barColour', () => {
  const palette = WATERFALL_PALETTES.dark;
  const share = (velocity: number, follows = true) =>
    Math.round(keyShadeStrength(velocity, follows) * 100) / 100;

  it('lights a bar as its key: the hand’s colour mixed toward the key’s own', () => {
    expect(barColour(palette, 'right', false, 0, true)).toBe(
      mixOklab(palette.right.white, palette.ivory, share(0)),
    );
    expect(barColour(palette, 'left', false, 0.5, true)).toBe(
      mixOklab(palette.left.white, palette.ivory, share(0.5)),
    );
    expect(barColour(palette, 'right', true, 0.5, true)).toBe(
      mixOklab(palette.right.black, palette.keyBlack, share(0.5)),
    );
    expect(barColour(palette, 'left', true, 1, true)).toBe(palette.left.black);
  });

  it('pales a soft note’s bar toward the ivory, as its key pales', () => {
    const lightness = (colour: string) => channels(colour).reduce((sum, value) => sum + value, 0);
    expect(lightness(barColour(palette, 'right', false, 0.2, true))).toBeGreaterThan(
      lightness(barColour(palette, 'right', false, 0.9, true)),
    );
  });

  it('lights every bar alike with the shading off, at the even shade', () => {
    const soft = barColour(palette, 'right', false, 0.1, false);
    expect(barColour(palette, 'right', false, 0.95, false)).toBe(soft);
    expect(soft).toBe(mixOklab(palette.right.white, palette.ivory, share(0.75)));
  });
});
