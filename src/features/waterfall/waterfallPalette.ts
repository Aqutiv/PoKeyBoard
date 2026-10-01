import type { ResolvedTheme } from '@/app/theme';
import type { Hand } from '@/domain/hands';
import { keyShadeStrength } from '@/features/keyboard/keyShading';

/**
 * The falling-notes view's colours, copied from src/themes.css: keep the two
 * in step (a test reads the file and compares). A bar is lit as its key is
 * lit: the hand's loudest colour mixed toward the key's own by how hard the
 * note is played (keyShading.ts, keyboard.css), so a bar is already the colour
 * its key turns as it lands.
 */
export interface HandColours {
  /** A white key lit at full strength: --key-white-active-2 / --key-white-left-2. */
  readonly white: string;
  /** A black key lit at full strength: --key-black-active-2 / --key-black-left-2. */
  readonly black: string;
  /** The outline every bar of the hand gets, unmixed: --key-black-active-1 / --key-black-left-1. */
  readonly edge: string;
}

export interface WaterfallPalette {
  /** --keybed: the bars fall out of the key bed's own colour, in both themes. */
  readonly stage: string;
  readonly right: HandColours;
  readonly left: HandColours;
  /** --ivory and --key-black: the keys' own colours, which a softer note pales toward. */
  readonly ivory: string;
  readonly keyBlack: string;
  /** The octave guides: the ivory, faint. */
  readonly guide: string;
  /** Where each bar starts: the ivory, less faint than a guide. */
  readonly barLine: string;
  /** Where a loop starts again, and the glow on a note practice waits for: --key-white-active-1. */
  readonly restart: string;
  /** A note's name on a white key's bar: --key-black-edge, as dark as a black key's edge. */
  readonly inkOnWhite: string;
  /** A note's name on a black key's bar: --ivory. */
  readonly inkOnBlack: string;
}

export const WATERFALL_PALETTES: Readonly<Record<ResolvedTheme, WaterfallPalette>> = {
  dark: {
    stage: '#0b0908',
    right: { white: '#f0c759', black: '#977103', edge: '#b78a16' },
    left: { white: '#e8852c', black: '#a74f0c', edge: '#ca6719' },
    ivory: '#f5efe2',
    keyBlack: '#201d1a',
    guide: 'rgba(245, 239, 226, 0.07)',
    barLine: 'rgba(245, 239, 226, 0.16)',
    restart: '#e5b22d',
    inkOnWhite: '#0b0908',
    inkOnBlack: '#f5efe2',
  },
  light: {
    stage: '#2e2822',
    right: { white: '#f2cb61', black: '#a67e0b', edge: '#c69a2b' },
    left: { white: '#ef8d3b', black: '#b25a15', edge: '#d77122' },
    ivory: '#fbf7ec',
    keyBlack: '#26221e',
    guide: 'rgba(251, 247, 236, 0.08)',
    barLine: 'rgba(251, 247, 236, 0.16)',
    restart: '#e9b732',
    inkOnWhite: '#14110e',
    inkOnBlack: '#fbf7ec',
  },
};

type Oklab = readonly [number, number, number];

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function encoded(value: number): string {
  const c = Math.min(1, Math.max(0, value));
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
}

/** A `#rrggbb` colour in OKLab (Björn Ottosson's matrices, as CSS Color 4 uses). */
function toOklab(hex: string): Oklab {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = linear((n >> 16) & 255);
  const g = linear((n >> 8) & 255);
  const b = linear(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function toHex([lightness, a, b]: Oklab): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return `#${encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${encoded(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
  )}${encoded(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}

const mixes = new Map<string, string>();

/**
 * `colour` mixed `share` of the way from `toward`, in OKLab: what a lit key's
 * `color-mix(in oklab, colour share, toward)` paints. Worked out here because
 * a canvas cannot be counted on to read `color-mix()`. The share comes in
 * whole percents, as `keyShade` writes it, so there are few mixes, and each is
 * worked out once.
 */
export function mixOklab(colour: string, toward: string, share: number): string {
  if (share >= 1) return colour;
  if (share <= 0) return toward;
  const key = `${colour} ${toward} ${share}`;
  let mixed = mixes.get(key);
  if (mixed === undefined) {
    const a = toOklab(colour);
    const b = toOklab(toward);
    mixed = toHex([
      a[0] * share + b[0] * (1 - share),
      a[1] * share + b[1] * (1 - share),
      a[2] * share + b[2] * (1 - share),
    ]);
    mixes.set(key, mixed);
  }
  return mixed;
}

/**
 * The colour a bar is drawn in: the colour its key lights with, at the
 * strength its note is played. With the shading off, every bar takes the
 * even shade, as every key does.
 */
export function barColour(
  palette: WaterfallPalette,
  hand: Hand,
  black: boolean,
  velocity: number,
  followsVelocity: boolean,
): string {
  const share = Math.round(keyShadeStrength(velocity, followsVelocity) * 100) / 100;
  const colours = hand === 'left' ? palette.left : palette.right;
  return mixOklab(
    black ? colours.black : colours.white,
    black ? palette.keyBlack : palette.ivory,
    share,
  );
}
