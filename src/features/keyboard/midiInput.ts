import type { VelocityMode } from '@/state/useSettingsStore';
import { MIDI_MAX, MIDI_MIN } from '@/utils/midi';
import { isModalOpen } from './computerKeyboard';
import { ensureAccessIfGranted, subscribePorts } from './midiAccess';

/**
 * Web MIDI input: a connected MIDI keyboard plays the piano with its own
 * velocity and sustain pedal.
 *
 * Unlike the Gamepad API this is event-driven, so there is no polling and no
 * edge diff — a hardware key always sends its own release. What replaces the
 * gamepad's resync machinery is one rule: only release what we actually
 * started. A note suppressed while the tab was hidden is not in `down`, so the
 * release that follows it is swallowed rather than fired at the engine.
 *
 * Deliberately keeps sounding when the *window* loses focus. Keystrokes and
 * gamepad buttons belong to whichever app has focus, so those inputs stand
 * down; a MIDI port is delivered only to the page that opened it, so standing
 * down would just cut off anyone playing along to a score in a window on top.
 * A hidden tab and an open modal still stand down.
 */
export interface MidiCallbacks {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  setSustain(down: boolean): void;
  /** Pitch bend past the threshold, once per press. */
  shiftRange(direction: 1 | -1): void;
  /** CC7, 0..1. */
  setVolume(value: number): void;
}

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;
const PITCH_BEND = 0xe0;

const CC_MODULATION = 1;
const CC_VOLUME = 7;
const CC_SUSTAIN = 64;
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;

/** Below this a CC64 pedal reads as up; at or above it, down. */
const SUSTAIN_THRESHOLD = 64;

/**
 * Bend buttons send a continuous ramp — 250-odd messages for one press — so
 * a bare threshold would fire a shift on every message near it. Same
 * hysteresis shape as the gamepad's analog triggers.
 */
const BEND_SHIFT_AT = 0.6;
const BEND_RELEASE_AT = 0.3;
const BEND_CENTER = 8192;

export class MidiInput {
  /**
   * Held pitch to the port that started it, and the ports currently holding
   * the pedal. Ownership matters when two keyboards are connected: unplugging
   * one must not cut off notes the other is still holding.
   */
  private readonly down = new Map<number, EventTarget>();
  private readonly sustainPorts = new Set<EventTarget>();
  private readonly boundPorts = new Set<MIDIInput>();
  private callbacks: MidiCallbacks | null = null;
  private bendLatched = false;
  private velocity = 0.75;
  private velocityMode: VelocityMode = 'touch';
  private unsubscribePorts: (() => void) | null = null;

  attach(callbacks: MidiCallbacks): () => void {
    this.callbacks = callbacks;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.unsubscribePorts = subscribePorts(this.bindPorts);
    // Never prompts: the Settings toggle is where permission is asked for.
    void ensureAccessIfGranted();
    return () => {
      this.unsubscribePorts?.();
      this.unsubscribePorts = null;
      for (const port of this.boundPorts)
        port.removeEventListener('midimessage', this.onMidiMessage);
      this.boundPorts.clear();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.releaseAll();
      this.callbacks = null;
    };
  }

  /** The fixed-velocity value; used only when the mode is 'fixed'. */
  setVelocity(velocity: number): void {
    this.velocity = velocity;
  }

  setVelocityMode(mode: VelocityMode): void {
    this.velocityMode = mode;
  }

  /** Releases one port's notes and pedal, or everything when none is given. */
  releaseAll(port?: EventTarget): void {
    const sustained = this.sustainPorts.size > 0;
    for (const [midi, owner] of [...this.down]) {
      if (port && owner !== port) continue;
      this.down.delete(midi);
      this.callbacks?.noteOff(midi);
    }
    if (port) this.sustainPorts.delete(port);
    else this.sustainPorts.clear();
    if (sustained && this.sustainPorts.size === 0) this.callbacks?.setSustain(false);
  }

  private readonly bindPorts = (inputs: readonly MIDIInput[]) => {
    const live = new Set(inputs);
    for (const port of [...this.boundPorts]) {
      if (live.has(port)) continue;
      // An unplugged device never sends the note-off for what it was holding.
      port.removeEventListener('midimessage', this.onMidiMessage);
      this.boundPorts.delete(port);
      this.releaseAll(port);
    }
    for (const port of inputs) {
      if (this.boundPorts.has(port)) continue;
      // addEventListener rather than onmidimessage: a second consumer
      // assigning the handler would silently replace ours.
      port.addEventListener('midimessage', this.onMidiMessage);
      this.boundPorts.add(port);
    }
  };

  private readonly onVisibilityChange = () => {
    if (document.hidden) this.releaseAll();
  };

  private readonly onMidiMessage = (event: Event) => {
    const data = (event as MIDIMessageEvent).data;
    const port = event.target;
    if (!this.callbacks || !port || !data || data.length < 2) return;
    const status = data[0]!;
    // Web MIDI delivers whole messages with running status already expanded,
    // so a data byte here is something we do not understand and guessing at
    // it would sound phantom notes. >= 0xf0 drops sysex, clock and active
    // sensing, which many controllers stream continuously.
    if (status < 0x80 || status >= 0xf0) return;
    const command = status & 0xf0; // channel deliberately unread — omni
    const data1 = data[1]! & 0x7f;
    const data2 = (data[2] ?? 0) & 0x7f;

    if (command === NOTE_ON && data2 > 0) {
      this.start(data1, data2, port);
      return;
    }
    // A Note On with velocity 0 is a Note Off. Not a curiosity: it is the
    // only release the M-Audio Keystation sends, so treating it as anything
    // else hangs every note it plays.
    if (command === NOTE_ON || command === NOTE_OFF) {
      this.stop(data1);
      return;
    }
    if (command === PITCH_BEND) {
      this.bend((((data2 << 7) | data1) - BEND_CENTER) / BEND_CENTER);
      return;
    }
    if (command !== CONTROL_CHANGE) return;
    if (data1 === CC_SUSTAIN) {
      this.pedal(data2 >= SUSTAIN_THRESHOLD, port);
      return;
    }
    if (data1 === CC_VOLUME) {
      this.callbacks.setVolume(data2 / 127);
      return;
    }
    // A sampled piano has nothing to modulate, so the mod wheel is dropped
    // explicitly rather than falling through to the panic handler below.
    if (data1 === CC_MODULATION) return;
    if (data1 === CC_ALL_SOUND_OFF || data1 === CC_ALL_NOTES_OFF) this.releaseAll();
  };

  private start(midi: number, rawVelocity: number, port: EventTarget): void {
    if (midi < MIDI_MIN || midi > MIDI_MAX) return;
    if (this.suppressed()) return;
    if (this.down.has(midi)) return;
    this.down.set(midi, port);
    this.callbacks?.noteOn(midi, this.velocityFor(rawVelocity));
  }

  private stop(midi: number): void {
    if (!this.down.delete(midi)) return;
    this.callbacks?.noteOff(midi);
  }

  private pedal(down: boolean, port: EventTarget): void {
    // Refcounted per port and edge-only on the total, mirroring how the
    // engine refcounts sustain per source. Some pedals stream CC64
    // continuously, and every setSustain reaches the recorder, so a
    // chattering pedal would write a run of meaningless events into the take.
    if (down === this.sustainPorts.has(port)) return;
    if (down && this.suppressed()) return;
    const was = this.sustainPorts.size > 0;
    if (down) this.sustainPorts.add(port);
    else this.sustainPorts.delete(port);
    const now = this.sustainPorts.size > 0;
    if (now !== was) this.callbacks?.setSustain(now);
  }

  private bend(normalized: number): void {
    const magnitude = Math.abs(normalized);
    if (this.bendLatched) {
      if (magnitude < BEND_RELEASE_AT) this.bendLatched = false;
      return;
    }
    if (magnitude < BEND_SHIFT_AT) return;
    this.bendLatched = true;
    if (this.suppressed()) return;
    this.callbacks?.shiftRange(normalized > 0 ? 1 : -1);
  }

  /** Dialogs render beside the piano, and a hidden tab should stay silent. */
  private suppressed(): boolean {
    return document.hidden || isModalOpen();
  }

  private velocityFor(rawVelocity: number): number {
    return this.velocityMode === 'fixed' ? this.velocity : rawVelocity / 127;
  }
}
