import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveActiveNotes, useSustainDown } from '@/app/hooks/useAudioEngine';
import { audioEngine } from '@/audio/AudioEngine';
import { contributeRange } from '@/audio/playableRange';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { midiToNoteName } from '@/utils/midi';
import { BASE_SPAN_SEMITONES, BaseOctave } from './baseOctave';
import { ComputerKeyboardInput, isModalOpen, isTextInput } from './computerKeyboard';
import { GamepadInput } from './gamepadInput';
import {
  anchorToReveal,
  BLACK_KEY_HEIGHT,
  computeVisibleWhites,
  FULL_RANGE_HIGH,
  FULL_RANGE_LOW,
  hitTestKey,
  isWhiteKey,
  layoutKeyboard,
  maxLowMidiFor,
  snapToWhite,
  stepWhites,
  touchVelocity,
  type KeyboardLayout,
} from './keyboardGeometry';
import { KeyboardPointerTracker } from './pointerTracker';
import { registerMidiKeyboard } from './useMidiInput';
import './keyboard.css';

interface PianoKeyboardProps {
  /** Extra keys to light up (playback / scrub animation). */
  extraActiveMidis?: ReadonlySet<number>;
  /** The take's pedal is down under the playhead (playback / scrub cue). */
  playbackPedalDown?: boolean;
  /** Extra controls rendered between the range shifter and Sustain. */
  controlsExtra?: ReactNode;
  /**
   * Keys the user is being asked to press, styled apart from the ones they are
   * holding: a target is a request, an active key is a fact.
   */
  targetMidis?: ReadonlySet<number>;
  /**
   * Park this keyboard here instead of at the persisted `keyboardAnchorMidi`.
   * Pass `onAnchorChange` alongside it, or the range shifter has nothing to
   * move. Learn uses this so a lesson never relocates the Play keyboard.
   */
  anchorMidi?: number;
  onAnchorChange?: (midi: number) => void;
  /** Reported whenever the visible window changes, including on first layout. */
  onRangeChange?: (range: { lowMidi: number; highMidi: number }) => void;
}

export function PianoKeyboard({
  extraActiveMidis,
  playbackPedalDown = false,
  controlsExtra,
  targetMidis,
  anchorMidi: anchorMidiOverride,
  onAnchorChange,
  onRangeChange,
}: PianoKeyboardProps) {
  const m = useMessages();
  const keysRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const liveActive = useLiveActiveNotes();
  const velocityMode = useSettingsStore((s) => s.velocityMode);
  const fixedVelocity = useSettingsStore((s) => s.fixedVelocity);
  const showNoteLabels = useSettingsStore((s) => s.showNoteLabels);
  const gamepadEnabled = useSettingsStore((s) => s.gamepadInput);
  // Both selectors run unconditionally; the override is chosen afterwards.
  const storeAnchorMidi = useSettingsStore((s) => s.keyboardAnchorMidi);
  const storeSetAnchorMidi = useSettingsStore((s) => s.setKeyboardAnchorMidi);
  const anchorMidi = anchorMidiOverride ?? storeAnchorMidi;
  const setAnchorMidi = onAnchorChange ?? storeSetAnchorMidi;
  // Both pedal sources — the button's own latch and a held Space — live in the
  // engine, so the button shows the damper's real state.
  const pedalDown = useSustainDown();

  useEffect(
    () => () => {
      audioEngine.setSustain(false, 'ui-pedal');
    },
    [],
  );

  useEffect(() => {
    const element = keysRef.current;
    if (!element) return;
    // Measure immediately so the first paint fits, then track resizes.
    setContainerWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = keysRef.current;
    if (!element) return;
    // iPadOS WebKit can still show its loupe over non-selectable content.
    // The key bed already owns this gesture, so cancel touchstart natively.
    const preventLoupe = (event: TouchEvent) => event.preventDefault();
    element.addEventListener('touchstart', preventLoupe, { passive: false });
    return () => element.removeEventListener('touchstart', preventLoupe);
  }, []);

  const visibleWhites = useMemo(() => computeVisibleWhites(containerWidth), [containerWidth]);

  const layout: KeyboardLayout = useMemo(() => {
    const anchor = snapToWhite(Math.max(FULL_RANGE_LOW, Math.min(anchorMidi, FULL_RANGE_HIGH)), 1);
    // Clamp so the whole window fits below C8 — the view never shrinks/stretches.
    const low = Math.min(anchor, maxLowMidiFor(visibleWhites));
    const high = stepWhites(low, visibleWhites, 1);
    return layoutKeyboard(low, high);
  }, [anchorMidi, visibleWhites]);

  // Shared by both input sources so Z/X and the bumpers can never disagree
  // about the octave. Held outside the effects below, which re-run whenever the
  // velocity or the toggle changes and would otherwise reset it to C4.
  const [baseOctave] = useState(() => new BaseOctave());

  // Load any sample roots the playable registers need: the visible range, plus
  // wherever Z/X and the bumpers have moved the base. Those notes are off
  // screen, so nothing else asks for them, and a root more than nine semitones
  // away leaves getSample empty-handed — the note would just not sound. MIDI
  // input contributes its own register alongside this one; the engine is told
  // the union of the two.
  useEffect(() => {
    const load = () => {
      const base = baseOctave.get();
      contributeRange(
        'keyboard',
        Math.min(layout.lowMidi, base),
        Math.max(layout.highMidi, base + BASE_SPAN_SEMITONES),
      );
    };
    load();
    return baseOctave.subscribe(load);
  }, [layout.lowMidi, layout.highMidi, baseOctave]);

  // Learn recomputes which keys to highlight from the window on screen.
  useEffect(() => {
    onRangeChange?.({ lowMidi: layout.lowMidi, highMidi: layout.highMidi });
  }, [layout.lowMidi, layout.highMidi, onRangeChange]);

  const [tracker] = useState(
    () =>
      new KeyboardPointerTracker({
        noteOn: (midi, velocity, pointerId) =>
          audioEngine.noteOn(midi, velocity, `pointer:${pointerId}`),
        noteOff: (midi, pointerId) => audioEngine.noteOff(midi, `pointer:${pointerId}`),
      }),
  );

  // Never leave sounding keys behind when the layout shifts or we unmount.
  useEffect(() => () => tracker.releaseAll(), [tracker, layout.lowMidi, layout.highMidi]);

  // Desktop computer-keyboard input.
  useEffect(() => {
    const input = new ComputerKeyboardInput(baseOctave);
    input.setVelocity(fixedVelocity);
    return input.attach({
      noteOn: (midi, velocity) => audioEngine.noteOn(midi, velocity, 'kbd'),
      noteOff: (midi) => audioEngine.noteOff(midi, 'kbd'),
      setSustain: (down) => audioEngine.setSustain(down, 'kbd-pedal'),
    });
  }, [fixedVelocity, baseOctave]);

  // Game-controller input. Its own source ids keep held notes and the pedal
  // independent of the computer keyboard's.
  useEffect(() => {
    if (!gamepadEnabled) return;
    const input = new GamepadInput(baseOctave);
    input.setVelocity(fixedVelocity);
    return input.attach({
      noteOn: (midi, velocity) => audioEngine.noteOn(midi, velocity, 'gamepad'),
      noteOff: (midi) => audioEngine.noteOff(midi, 'gamepad'),
      setSustain: (down) => audioEngine.setSustain(down, 'gamepad-pedal'),
    });
  }, [fixedVelocity, gamepadEnabled, baseOctave]);

  const locate = useCallback(
    (event: React.PointerEvent): { midi: number | null; velocity: number } => {
      const element = keysRef.current;
      if (!element) return { midi: null, velocity: 0 };
      const rect = element.getBoundingClientRect();
      const xUnits = ((event.clientX - rect.left) / rect.width) * layout.whiteCount;
      const yFraction = (event.clientY - rect.top) / rect.height;
      const midi = hitTestKey(layout, xUnits, yFraction);
      if (midi === null) return { midi: null, velocity: 0 };
      if (velocityMode === 'fixed') return { midi, velocity: fixedVelocity };
      const withinKey = isWhiteKey(midi) ? yFraction : yFraction / BLACK_KEY_HEIGHT;
      return { midi, velocity: touchVelocity(withinKey) };
    },
    [layout, velocityMode, fixedVelocity],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      keysRef.current?.setPointerCapture(event.pointerId);
      const { midi, velocity } = locate(event);
      tracker.down(event.pointerId, midi, velocity);
    },
    [locate, tracker],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const { midi, velocity } = locate(event);
      tracker.move(event.pointerId, midi, velocity);
    },
    [locate, tracker],
  );

  const onPointerEnd = useCallback(
    (event: React.PointerEvent) => {
      tracker.up(event.pointerId);
    },
    [tracker],
  );

  /**
   * A step is one white key, because the bed always starts and ends on a
   * whole one — `stepWhites` counts its white start, so 2 is the next along.
   * Black keys still come into view as the window slides.
   */
  const shiftRange = useCallback(
    (direction: 1 | -1, step: 'key' | 'octave') => {
      tracker.releaseAll();
      const next =
        step === 'octave'
          ? layout.lowMidi + direction * 12
          : stepWhites(layout.lowMidi, 2, direction);
      setAnchorMidi(Math.min(maxLowMidiFor(visibleWhites), Math.max(FULL_RANGE_LOW, next)));
    },
    [layout.lowMidi, setAnchorMidi, tracker, visibleWhites],
  );

  // Arrow and page keys mirror the on-screen shift buttons.
  useEffect(() => {
    const RANGE_KEYS: Record<string, [1 | -1, 'key' | 'octave']> = {
      ArrowLeft: [-1, 'key'],
      ArrowRight: [1, 'key'],
      PageDown: [-1, 'octave'],
      PageUp: [1, 'octave'],
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextInput(event.target)) return;
      // The dialog's own scrollable body wants the page keys.
      if (isModalOpen()) return;
      const shift = RANGE_KEYS[event.key];
      if (!shift) return;
      // Otherwise the browser scrolls the page out from under the keyboard.
      event.preventDefault();
      shiftRange(...shift);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shiftRange]);

  /**
   * The on-screen half of MIDI input. The MIDI device itself is owned by the
   * app shell so it plays on every tab; these two only make sense while a key
   * bed is mounted, so they are lent for as long as this one is.
   */
  useEffect(
    () =>
      registerMidiKeyboard({
        reveal: (midi) => {
          const next = anchorToReveal(midi, layout.lowMidi, visibleWhites);
          if (next === layout.lowMidi) return;
          // The keys are about to move out from under any held pointer,
          // exactly as they do when the shift buttons are used.
          tracker.releaseAll();
          setAnchorMidi(next);
        },
        shiftOctave: (direction) => shiftRange(direction, 'octave'),
      }),
    [layout.lowMidi, visibleWhites, setAnchorMidi, tracker, shiftRange],
  );

  // Toggling against the engine rather than a local latch means a panic reset
  // that dropped the pedal is recovered by the very next click.
  const toggleSustain = useCallback(() => {
    audioEngine.setSustain(!audioEngine.isSustainDown(), 'ui-pedal');
  }, []);

  const isActive = useCallback(
    (midi: number) => liveActive.has(midi) || (extraActiveMidis?.has(midi) ?? false),
    [liveActive, extraActiveMidis],
  );

  const isTarget = useCallback((midi: number) => targetMidis?.has(midi) ?? false, [targetMidis]);

  const whiteWidthPercent = 100 / layout.whiteCount;

  return (
    <div className="piano">
      <div className="piano__controls">
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(-1, 'octave')}
          disabled={layout.lowMidi <= FULL_RANGE_LOW}
          aria-label={m.piano.shiftDown}
        >
          ‹‹
        </button>
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(-1, 'key')}
          disabled={layout.lowMidi <= FULL_RANGE_LOW}
          aria-label={m.piano.shiftDownKey}
        >
          ‹
        </button>
        <span className="piano__range" aria-live="polite">
          {midiToNoteName(layout.lowMidi)} – {midiToNoteName(layout.highMidi)}
        </span>
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(1, 'key')}
          disabled={layout.highMidi >= FULL_RANGE_HIGH}
          aria-label={m.piano.shiftUpKey}
        >
          ›
        </button>
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(1, 'octave')}
          disabled={layout.highMidi >= FULL_RANGE_HIGH}
          aria-label={m.piano.shiftUp}
        >
          ››
        </button>
        {controlsExtra}
        <button
          type="button"
          className={`piano__sustain${playbackPedalDown ? ' is-playback' : ''}${pedalDown ? ' is-on' : ''}`}
          // Playback lights the button as a cue but never presses it, so it is
          // kept out of this. Holding Space is the user working the pedal for
          // real, so it reports as pressed and reverts on release.
          aria-pressed={pedalDown}
          onClick={toggleSustain}
        >
          {m.piano.sustain}
        </button>
      </div>
      <div
        ref={keysRef}
        className="piano__keys"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onContextMenu={(event) => event.preventDefault()}
      >
        {layout.keys
          .filter((key) => !key.isBlack)
          .map((key) => (
            <div
              key={key.midi}
              role="button"
              tabIndex={-1}
              aria-label={m.piano.keyLabel({ note: midiToNoteName(key.midi) })}
              aria-pressed={isActive(key.midi)}
              className={`piano-key piano-key--white${isActive(key.midi) ? ' is-active' : ''}${
                isTarget(key.midi) ? ' is-target' : ''
              }`}
              data-target={isTarget(key.midi) ? 'true' : undefined}
              style={{
                left: `${key.x * whiteWidthPercent}%`,
                width: `${key.width * whiteWidthPercent}%`,
              }}
            >
              {showNoteLabels ? (
                <span className="piano-key__label" aria-hidden="true">
                  {midiToNoteName(key.midi)}
                </span>
              ) : null}
            </div>
          ))}
        {layout.keys
          .filter((key) => key.isBlack)
          .map((key) => (
            <div
              key={key.midi}
              role="button"
              tabIndex={-1}
              aria-label={m.piano.keyLabel({ note: midiToNoteName(key.midi) })}
              aria-pressed={isActive(key.midi)}
              className={`piano-key piano-key--black${isActive(key.midi) ? ' is-active' : ''}${
                isTarget(key.midi) ? ' is-target' : ''
              }`}
              data-target={isTarget(key.midi) ? 'true' : undefined}
              style={{
                left: `${key.x * whiteWidthPercent}%`,
                width: `${key.width * whiteWidthPercent}%`,
              }}
            />
          ))}
      </div>
    </div>
  );
}
