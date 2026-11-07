import type { Hand } from '@/domain/hands';
import { keyShadeStrength } from '@/features/keyboard/keyShading';
import type { Rgb8 } from './partyKeysProtocol';

/**
 * What the keyboard's lights are lit in: the on-screen keys' own colours,
 * from the dark theme in src/themes.css (a test compares them). LEDs are
 * light sources, so they take the colours a key glows with against the dark
 * key bed in either theme; the light theme's deeper bronze would only read
 * muddy on them.
 */
export const LIGHT_COLOURS = {
  /** --key-white-active-1: a key the right hand, or the player, plays. */
  right: '#e5b22d',
  /** --key-white-left-1: a key the left hand plays. */
  left: '#d56a02',
  /** --key-wrong-edge: a key pressed that the music did not ask for. */
  wrong: '#d05a5a',
  /** --accent: a key a lesson asks for, which has no hand. */
  target: '#d9a441',
} as const;

/**
 * How bright a coming note's light is: its brightest channel's level, out of
 * 255. On this user's keyboard 32 read as a quiet hint (PianoBallDesktop);
 * coming notes sit a little above, to read as "next" beside the lit ones.
 */
export const COMING_LEVEL = 40;

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A screen channel (0–1) as LED drive (0–255). LEDs wash pastel colours out,
 * so the channel is squared (gamma 2), which the user picked over the raw
 * colours on their keyboard. Levels from 64 up round to steps of 8, so a
 * swell's small changes do not resend every frame.
 */
export function ledLevel(screen: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(screen) ? screen : 0));
  const level = Math.round(clamped * 255);
  return level >= 64 ? Math.min(255, Math.round(level / 8) * 8) : level;
}

/** `hex` at `strength` (0–1) of its full light, squared as `ledLevel` explains. */
export function ledColour(hex: string, strength = 1): Rgb8 {
  const [r, g, b] = channels(hex).map((channel) => channel * channel * strength) as [
    number,
    number,
    number,
  ];
  return { r: ledLevel(r), g: ledLevel(g), b: ledLevel(b) };
}

/** `hex`'s hue as `ledColour` gives it, dimmed so its brightest channel sits at `level`. */
export function dimLight(hex: string, level: number): Rgb8 {
  const squared = channels(hex).map((channel) => channel * channel);
  const top = Math.max(...squared, 1e-6);
  const [r, g, b] = squared.map((channel) =>
    Math.min(255, Math.max(0, Math.round((channel * level) / top))),
  ) as [number, number, number];
  return { r, g, b };
}

/** A key the take (or a hand) plays at `velocity`: brighter for a harder note, as on screen. */
export function handLight(hand: Hand, velocity: number, followsVelocity: boolean): Rgb8 {
  return ledColour(LIGHT_COLOURS[hand], keyShadeStrength(velocity, followsVelocity));
}
