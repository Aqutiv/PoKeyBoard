import { useCallback, useEffect, useRef } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { contributeRange } from '@/audio/playableRange';
import { useSettingsStore } from '@/state/useSettingsStore';
import { FULL_RANGE_HIGH, FULL_RANGE_LOW } from './keyboardGeometry';
import { MidiInput } from './midiInput';

/**
 * What a mounted key bed lends to MIDI input. Both only mean something while
 * there is a keyboard on screen to move, so MIDI plays with or without them.
 */
export interface MidiKeyboardHandlers {
  /** Bring an off-screen incoming note into the visible window. */
  reveal(midi: number): void;
  /** Walk the visible window, driven by the controller's bend buttons. */
  shiftOctave(direction: 1 | -1): void;
}

let keyboardHandlers: MidiKeyboardHandlers | null = null;

/** Registered by PianoKeyboard for as long as it is mounted. */
export function registerMidiKeyboard(handlers: MidiKeyboardHandlers): () => void {
  keyboardHandlers = handlers;
  return () => {
    if (keyboardHandlers === handlers) keyboardHandlers = null;
  };
}

/** An octave of lookahead, so a run toward either end stays ahead of the edge. */
const LOOKAHEAD_SEMITONES = 12;

/**
 * MIDI input, for the whole app session rather than for the Play page.
 *
 * A MIDI keyboard is a physical instrument sitting in front of the player, so
 * it keeps sounding while they read Settings or browse takes — the same way a
 * recorded take does. That is also what lets the controller's volume knob move
 * the Piano volume slider while the player is watching it. Mounted once, in
 * the shell; the key bed contributes the on-screen half through
 * `registerMidiKeyboard` when it happens to be there.
 */
export function useMidiInput(): void {
  const enabled = useSettingsStore((s) => s.midiInput);
  const velocityMode = useSettingsStore((s) => s.velocityMode);
  const fixedVelocity = useSettingsStore((s) => s.fixedVelocity);
  // Zustand setters are created once, so these stay referentially stable and
  // the attach effect below does not rebind the MIDI ports on every render.
  const setMasterVolume = useSettingsStore((s) => s.setMasterVolume);

  const inputRef = useRef<MidiInput | null>(null);
  const heldRef = useRef(0);
  const spanRef = useRef<{ low: number; high: number } | null>(null);
  const volumeFrameRef = useRef<number | null>(null);
  const pendingVolumeRef = useRef(0);

  /**
   * A MIDI keyboard's own octave buttons transpose on the device, invisibly,
   * so it can send absolute pitches from anywhere on the piano. Roots more
   * than nine semitones away leave getSample empty-handed and the note simply
   * does not sound, so what arrives has to widen the load.
   */
  const widenForMidi = useCallback((midi: number) => {
    const low = Math.max(FULL_RANGE_LOW, midi - LOOKAHEAD_SEMITONES);
    const high = Math.min(FULL_RANGE_HIGH, midi + LOOKAHEAD_SEMITONES);
    const span = spanRef.current;
    if (span && span.low <= low && span.high >= high) return;
    spanRef.current = {
      low: Math.min(span?.low ?? low, low),
      high: Math.max(span?.high ?? high, high),
    };
    contributeRange('midi', spanRef.current.low, spanRef.current.high);
  }, []);

  // A CC7 ramp arrives ~18 times a second and every store write re-renders
  // each volume subscriber, so only the last value in a frame is kept.
  const setVolumeCoalesced = useCallback(
    (value: number) => {
      pendingVolumeRef.current = value;
      if (volumeFrameRef.current !== null) return;
      volumeFrameRef.current = requestAnimationFrame(() => {
        volumeFrameRef.current = null;
        setMasterVolume(pendingVolumeRef.current);
      });
    },
    [setMasterVolume],
  );

  useEffect(
    () => () => {
      if (volumeFrameRef.current !== null) cancelAnimationFrame(volumeFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const input = new MidiInput();
    inputRef.current = input;
    const detach = input.attach({
      noteOn: (midi, velocity) => {
        // Anchor a chord on its first note: re-aiming at every note of a
        // spread wider than the window would leave the view ping-ponging.
        const first = heldRef.current === 0;
        heldRef.current += 1;
        widenForMidi(midi);
        if (first) keyboardHandlers?.reveal(midi);
        audioEngine.noteOn(midi, velocity, 'midi');
      },
      noteOff: (midi) => {
        heldRef.current = Math.max(0, heldRef.current - 1);
        audioEngine.noteOff(midi, 'midi');
      },
      setSustain: (down) => audioEngine.setSustain(down, 'midi-pedal'),
      // The bend buttons on a 32-key controller are far more useful walking
      // the window than bending a sampled piano that has no pitch to bend.
      // Off the Play page there is no window, and they do nothing.
      shiftRange: (direction) => keyboardHandlers?.shiftOctave(direction),
      setVolume: setVolumeCoalesced,
    });
    return () => {
      detach();
      inputRef.current = null;
      heldRef.current = 0;
    };
  }, [enabled, widenForMidi, setVolumeCoalesced]);

  useEffect(() => {
    inputRef.current?.setVelocity(fixedVelocity);
    inputRef.current?.setVelocityMode(velocityMode);
  }, [fixedVelocity, velocityMode, enabled]);
}
