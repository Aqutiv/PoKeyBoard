import { isValidMidi } from '@/utils/midi';
import { BaseOctave } from './baseOctave';
import { isModalOpen } from './computerKeyboard';

/**
 * Game-controller input: the D-pad and face buttons play one octave, C to C,
 * read clockwise from the left button of each cluster. The bumpers shift the
 * base octave (like Z/X), the left trigger sustains (like Space), and the
 * right trigger raises the played note a semitone.
 *
 * The Gamepad API is snapshot-only — there are no button events — so this
 * polls on requestAnimationFrame, but only while a pad is actually connected.
 */
export interface GamepadCallbacks {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  setSustain(down: boolean): void;
}

/** W3C "standard" mapping button indices. */
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;

/** Button index paired with its semitone offset from the base note. */
const NOTE_BUTTONS: ReadonlyArray<readonly [number, number]> = [
  [14, 0], // D-pad Left  → C
  [12, 2], // D-pad Up    → D
  [15, 4], // D-pad Right → E
  [13, 5], // D-pad Down  → F
  [2, 7], //  X → G
  [3, 9], //  Y → A
  [1, 11], // B → B
  [0, 12], // A → C, next octave
];

/**
 * Triggers are analog, so a resting pull near a single threshold would
 * chatter. That is not cosmetic: every setSustain call reaches the recorder,
 * so a chattering left trigger writes garbage pedal events into the take, and
 * a chattering right trigger silently retunes the next note.
 */
const TRIGGER_PRESS = 0.5;
const TRIGGER_RELEASE = 0.35;

export class GamepadInput {
  private readonly downButtons = new Map<number, number>();
  private readonly pressed = new Set<number>();
  private rtDown = false;
  private ltDown = false;
  private callbacks: GamepadCallbacks | null = null;
  private velocity = 0.75;
  private frame: number | null = null;
  private readonly base: BaseOctave;

  /** Defaults to a private octave so standalone construction still works. */
  constructor(base: BaseOctave = new BaseOctave()) {
    this.base = base;
  }

  attach(callbacks: GamepadCallbacks): () => void {
    this.callbacks = callbacks;
    window.addEventListener('gamepadconnected', this.onDeviceChange);
    window.addEventListener('gamepaddisconnected', this.onDeviceChange);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Chrome hides pads until a button is pressed and fires gamepadconnected
    // then; this probe covers the browsers that expose them on load instead.
    this.sync();
    return () => {
      this.stop();
      this.releaseAll();
      window.removeEventListener('gamepadconnected', this.onDeviceChange);
      window.removeEventListener('gamepaddisconnected', this.onDeviceChange);
      window.removeEventListener('blur', this.onBlur);
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.callbacks = null;
    };
  }

  setVelocity(velocity: number): void {
    this.velocity = velocity;
  }

  releaseAll(): void {
    this.pressed.clear();
    this.rtDown = false;
    if (!this.callbacks) return;
    for (const [button, midi] of [...this.downButtons]) {
      this.downButtons.delete(button);
      this.callbacks.noteOff(midi);
    }
    if (this.ltDown) {
      this.ltDown = false;
      this.callbacks.setSustain(false);
    }
  }

  private readonly onDeviceChange = () => {
    this.sync();
  };

  private readonly onBlur = () => {
    this.releaseAll();
  };

  private readonly onVisibilityChange = () => {
    // rAF stops ticking on a hidden tab, so anything held would hang there
    // until the tab came back.
    if (document.hidden) {
      this.stop();
      this.releaseAll();
    } else {
      this.sync();
    }
  };

  /** Starts polling once a usable pad appears, and stops when the last leaves. */
  private sync(): void {
    const pads = readPads();
    if (pads.length > 0 && !document.hidden) {
      if (this.frame === null) this.frame = requestAnimationFrame(this.poll);
      return;
    }
    this.stop();
    // A hard yank can drop the pad before the next frame runs, so the
    // falling-edge diff alone would never see the buttons release.
    this.releaseAll();
  }

  private stop(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly poll = () => {
    this.frame = null;
    const pads = readPads();
    if (pads.length === 0) {
      this.releaseAll();
      return;
    }
    this.frame = requestAnimationFrame(this.poll);
    if (!this.callbacks) return;

    // Dialogs render beside the piano, so the controller stands down while one
    // is open. Unlike a key, a held button has no later "up" event to clean up
    // with, so anything sounding has to be released here.
    if (isModalOpen()) {
      this.releaseAll();
      return;
    }

    // Merging every connected pad gives multi-controller support for free.
    const isDown = (index: number) => pads.some((pad) => pad.buttons[index]?.pressed === true);
    const analog = (index: number) =>
      pads.reduce((max, pad) => {
        const button = pad.buttons[index];
        if (!button) return max;
        // Some drivers report digital-only triggers with value 0.
        return Math.max(max, button.pressed ? Math.max(button.value, 1) : button.value);
      }, 0);

    // Modifiers resolve before the note diff so that a trigger and a button
    // landing in the same frame — which happens constantly — still sharps.
    const sustained = withHysteresis(this.ltDown, analog(BTN_LT));
    if (sustained !== this.ltDown) {
      this.ltDown = sustained;
      this.callbacks.setSustain(sustained);
    }
    this.rtDown = withHysteresis(this.rtDown, analog(BTN_RT));

    for (const button of [BTN_LB, BTN_RB] as const) {
      const down = isDown(button);
      if (down === this.pressed.has(button)) continue;
      if (down) {
        this.pressed.add(button);
        this.base.shift(button === BTN_LB ? -1 : 1);
      } else {
        this.pressed.delete(button);
      }
    }

    for (const [button, semitone] of NOTE_BUTTONS) {
      const down = isDown(button);
      if (down === this.pressed.has(button)) continue;
      if (down) {
        this.pressed.add(button);
        const midi = this.base.get() + semitone + (this.rtDown ? 1 : 0);
        if (!isValidMidi(midi)) continue;
        // Keyed by button and valued by the pitch actually started: releasing
        // the trigger or shifting octave mid-hold must not strand the note.
        this.downButtons.set(button, midi);
        this.callbacks.noteOn(midi, this.velocity);
      } else {
        this.pressed.delete(button);
        const midi = this.downButtons.get(button);
        if (midi === undefined) continue;
        this.downButtons.delete(button);
        this.callbacks.noteOff(midi);
      }
    }
  };
}

/**
 * Non-standard pads order their buttons arbitrarily, so playing nothing beats
 * playing the wrong notes.
 */
function readPads(): Gamepad[] {
  const pads = navigator.getGamepads?.() ?? [];
  return [...pads].filter(
    (pad): pad is Gamepad => pad !== null && pad.connected && pad.mapping === 'standard',
  );
}

function withHysteresis(down: boolean, value: number): boolean {
  return down ? value > TRIGGER_RELEASE : value >= TRIGGER_PRESS;
}
