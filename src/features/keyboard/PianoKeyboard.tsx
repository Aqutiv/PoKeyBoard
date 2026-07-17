import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveActiveNotes } from '@/app/hooks/useAudioEngine';
import { audioEngine } from '@/audio/AudioEngine';
import { useSettingsStore } from '@/state/useSettingsStore';
import { midiToNoteName } from '@/utils/midi';
import { ComputerKeyboardInput } from './computerKeyboard';
import {
  BLACK_KEY_HEIGHT,
  FULL_RANGE_HIGH,
  FULL_RANGE_LOW,
  hitTestKey,
  isWhiteKey,
  layoutKeyboard,
  snapToWhite,
  touchVelocity,
  type KeyboardLayout,
} from './keyboardGeometry';
import { KeyboardPointerTracker } from './pointerTracker';
import './keyboard.css';

const MIN_WHITE_KEY_PX = 38;
const MIN_VISIBLE_WHITES = 7;
const MAX_VISIBLE_WHITES = 21;

interface PianoKeyboardProps {
  /** Extra keys to light up (playback / scrub animation). */
  extraActiveMidis?: ReadonlySet<number>;
}

/** Walk `count` white keys upward from a white-key midi (inclusive start). */
function midiAfterWhites(startMidi: number, count: number): number {
  let midi = startMidi;
  let seen = 0;
  while (seen < count && midi <= FULL_RANGE_HIGH) {
    if (isWhiteKey(midi)) seen += 1;
    if (seen === count) break;
    midi += 1;
  }
  return Math.min(midi, FULL_RANGE_HIGH);
}

export function PianoKeyboard({ extraActiveMidis }: PianoKeyboardProps) {
  const keysRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const liveActive = useLiveActiveNotes();
  const velocityMode = useSettingsStore((s) => s.velocityMode);
  const fixedVelocity = useSettingsStore((s) => s.fixedVelocity);
  const showNoteLabels = useSettingsStore((s) => s.showNoteLabels);
  const anchorMidi = useSettingsStore((s) => s.keyboardAnchorMidi);
  const setAnchorMidi = useSettingsStore((s) => s.setKeyboardAnchorMidi);
  const [sustainOn, setSustainOn] = useState(false);

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

  const visibleWhites = useMemo(() => {
    if (containerWidth <= 0) return 14;
    return Math.min(
      MAX_VISIBLE_WHITES,
      Math.max(MIN_VISIBLE_WHITES, Math.floor(containerWidth / MIN_WHITE_KEY_PX)),
    );
  }, [containerWidth]);

  const layout: KeyboardLayout = useMemo(() => {
    const low = snapToWhite(Math.max(FULL_RANGE_LOW, Math.min(anchorMidi, FULL_RANGE_HIGH)), 1);
    const high = midiAfterWhites(low, visibleWhites);
    return layoutKeyboard(low, high);
  }, [anchorMidi, visibleWhites]);

  // Load any sample roots the visible range needs (range shift beyond core).
  useEffect(() => {
    void audioEngine.ensurePlayableRange(layout.lowMidi, layout.highMidi);
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
      const highestAnchor = snapToWhite(FULL_RANGE_HIGH - 12, -1);
      setAnchorMidi(Math.min(highestAnchor, Math.max(FULL_RANGE_LOW, next)));
    },
    [layout.lowMidi, setAnchorMidi, tracker],
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
          aria-label="Shift keyboard range down one octave"
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
          aria-label="Shift keyboard range up one octave"
        >
          ›
        </button>
        <button
          type="button"
          className={`piano__sustain${sustainOn ? ' is-on' : ''}`}
          aria-pressed={sustainOn}
          onClick={toggleSustain}
        >
          Sustain
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
              aria-label={`${midiToNoteName(key.midi)} key`}
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
              aria-label={`${midiToNoteName(key.midi)} key`}
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
