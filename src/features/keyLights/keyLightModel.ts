import type { Hand, KeyCue } from '@/domain/hands';
import { COMING_LEVEL, dimLight, handLight, ledColour, LIGHT_COLOURS } from './ledColours';
import {
  DARK,
  noteOfKey,
  PARTYKEYS_KEYS,
  type KeyboardShift,
  type Rgb8,
} from './partyKeysProtocol';
import type { DeviceLights } from './keyLightSession';

/**
 * Everything the keyboard's lights show, by note: the same state the
 * on-screen keys are drawn from.
 */
export interface KeyLightScene {
  /** False with nothing on screen to mirror (the page away): every key dark. */
  readonly shown: boolean;
  /** Display → velocity shading: softer notes light dimmer, as on screen. */
  readonly followsVelocity: boolean;
  /** Keys the take plays under the playhead, in their hand, as hard as heard. */
  readonly cues: ReadonlyMap<number, KeyCue>;
  /**
   * Keys held from another input (the screen, the computer keyboard, a game
   * controller), at their velocity. The lit keyboard's own presses are not
   * among them: its firmware lights a held key white over any colour.
   */
  readonly held: ReadonlyMap<number, number>;
  /** Keys the music waits for or a lesson asks for, in their hand where they have one. */
  readonly targets: ReadonlyMap<number, Hand | null>;
  /** Keys the music did not ask for, flashing as on screen. */
  readonly wrong: ReadonlySet<number>;
  /** The practised hand's next notes, before they are due. */
  readonly coming: ReadonlyMap<number, Hand>;
  /** Keys a lesson's picture marks second, apart from its main marks: a dim accent. */
  readonly faint: ReadonlySet<number>;
}

const NONE = new Map<never, never>();

export const EMPTY_SCENE: KeyLightScene = {
  shown: true,
  followsVelocity: true,
  cues: NONE,
  held: NONE,
  targets: NONE,
  wrong: new Set(),
  coming: NONE,
  faint: new Set(),
};

/**
 * One note's light. Highest first, as the screen layers them: a wrong key, a
 * key held from elsewhere, the take's own, a key asked for (or marked on a
 * lesson's picture), a note coming, a picture's second marks, else dark.
 */
export function noteLight(scene: KeyLightScene, note: number): Rgb8 {
  if (!scene.shown) return DARK;
  if (scene.wrong.has(note)) return ledColour(LIGHT_COLOURS.wrong);
  const held = scene.held.get(note);
  if (held !== undefined) return handLight('right', held, scene.followsVelocity);
  const cue = scene.cues.get(note);
  if (cue) return handLight(cue.hand, cue.velocity, scene.followsVelocity);
  const target = scene.targets.get(note);
  if (target !== undefined) {
    return target ? ledColour(LIGHT_COLOURS[target]) : ledColour(LIGHT_COLOURS.target);
  }
  const coming = scene.coming.get(note);
  if (coming) return dimLight(LIGHT_COLOURS[coming], COMING_LEVEL);
  if (scene.faint.has(note)) return dimLight(LIGHT_COLOURS.target, COMING_LEVEL);
  return DARK;
}

/** The 36 keys' lights for `scene`, with the keyboard at `shift`. */
export function deviceLights(scene: KeyLightScene, shift: KeyboardShift): DeviceLights {
  return Array.from({ length: PARTYKEYS_KEYS }, (_, key) => {
    const note = noteOfKey(key, shift);
    return note >= 0 && note < 128 ? noteLight(scene, note) : DARK;
  });
}
