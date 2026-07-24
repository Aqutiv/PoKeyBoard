import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveActiveNotes } from '@/app/hooks/useAudioEngine';
import { audioEngine } from '@/audio/AudioEngine';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { midiToNoteName } from '@/utils/midi';
import { ComputerKeyboardInput } from './computerKeyboard';
import {
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
import './keyboard.css';

interface PianoKeyboardProps {
  /** Extra keys to light up (playback / scrub animation). */
  extraActiveMidis?: ReadonlySet<number>;
  /** Extra controls rendered between the range shifter and Sustain. */
  controlsExtra?: ReactNode;
}

export function PianoKeyboard({ extraActiveMidis, controlsExtra }: PianoKeyboardProps) {
  const m = useMessages();
  const keysRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const liveActive = useLiveActiveNotes();
  const velocityMode = useSettingsStore((s) => s.velocityMode);
  const fixedVelocity = useSettingsStore((s) => s.fixedVelocity);
  const showNoteLabels = useSettingsStore((s) => s.showNoteLabels);
  const anchorMidi = useSettingsStore((s) => s.keyboardAnchorMidi);
  const setAnchorMidi = useSettingsStore((s) => s.setKeyboardAnchorMidi);
  const [sustainOn, setSustainOn] = useState(false);

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

  // Load any sample roots the visible range needs (range shift beyond core).
  useEffect(() => {
    void audioEngine.ensurePlayableRange(layout.lowMidi, layout.highMidi).catch(() => {
      // The shared load-progress state exposes the retryable error.
    });
  }, [layout.lowMidi, layout.highMidi]);

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
    const input = new ComputerKeyboardInput();
    input.setVelocity(fixedVelocity);
    return input.attach({
      noteOn: (midi, velocity) => audioEngine.noteOn(midi, velocity, 'kbd'),
      noteOff: (midi) => audioEngine.noteOff(midi, 'kbd'),
      setSustain: (down) => audioEngine.setSustain(down, 'kbd-pedal'),
    });
  }, [fixedVelocity]);

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

  const shiftRange = useCallback(
    (direction: 1 | -1) => {
      tracker.releaseAll();
      const next = layout.lowMidi + direction * 12;
      setAnchorMidi(Math.min(maxLowMidiFor(visibleWhites), Math.max(FULL_RANGE_LOW, next)));
    },
    [layout.lowMidi, setAnchorMidi, tracker, visibleWhites],
  );

  const toggleSustain = useCallback(() => {
    setSustainOn((current) => {
      const next = !current;
      audioEngine.setSustain(next, 'ui-pedal');
      return next;
    });
  }, []);

  const isActive = useCallback(
    (midi: number) => liveActive.has(midi) || (extraActiveMidis?.has(midi) ?? false),
    [liveActive, extraActiveMidis],
  );

  const whiteWidthPercent = 100 / layout.whiteCount;

  return (
    <div className="piano">
      <div className="piano__controls">
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(-1)}
          disabled={layout.lowMidi <= FULL_RANGE_LOW}
          aria-label={m.piano.shiftDown}
        >
          ‹
        </button>
        <span className="piano__range" aria-live="polite">
          {midiToNoteName(layout.lowMidi)} – {midiToNoteName(layout.highMidi)}
        </span>
        <button
          type="button"
          className="piano__shift"
          onClick={() => shiftRange(1)}
          disabled={layout.highMidi >= FULL_RANGE_HIGH}
          aria-label={m.piano.shiftUp}
        >
          ›
        </button>
        {controlsExtra}
        <button
          type="button"
          className={`piano__sustain${sustainOn ? ' is-on' : ''}`}
          aria-pressed={sustainOn}
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
              className={`piano-key piano-key--white${isActive(key.midi) ? ' is-active' : ''}`}
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
              className={`piano-key piano-key--black${isActive(key.midi) ? ' is-active' : ''}`}
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
