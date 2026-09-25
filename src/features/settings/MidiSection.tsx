import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ensureAccess,
  getSnapshot,
  subscribe,
  type MidiAccessSnapshot,
} from '@/features/keyboard/midiAccess';
import { registerRawVelocityListener } from '@/features/keyboard/midiInput';
import { MIDI_VELOCITY_CURVES, type MidiVelocityCurve } from '@/features/keyboard/velocityResponse';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import {
  CALIBRATION_IDLE,
  calibrationReducer,
  type CalibrationAction,
  type CalibrationState,
} from './midiCalibration';

const CURVE_LABELS: Record<
  MidiVelocityCurve,
  'midiCurveLight' | 'midiCurveNormal' | 'midiCurveHeavy'
> = {
  light: 'midiCurveLight',
  normal: 'midiCurveNormal',
  heavy: 'midiCurveHeavy',
};

/**
 * The MIDI toggle and its device list. Listing the connected ports is what
 * stands in for a device picker: every input plays, so the only thing the
 * player needs is confirmation that their keyboard was seen.
 *
 * Turning the toggle on is also what raises the browser's permission prompt —
 * deliberately, so it happens on a click rather than on page load, and so the
 * same click unlocks the audio context.
 */
export function MidiSection() {
  const m = useMessages();
  const enabled = useSettingsStore((s) => s.midiInput);
  const setMidiInput = useSettingsStore((s) => s.setMidiInput);
  // A fixed velocity replaces the device's own, so the curve and calibration
  // would have nothing to shape.
  const deviceVelocity = useSettingsStore((s) => s.velocityMode === 'touch');
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  if (snapshot.kind === 'unsupported') {
    return (
      <>
        <label className="setting-row">
          <span>{m.settings.midi}</span>
          <input type="checkbox" checked={false} disabled readOnly />
        </label>
        <p className="settings__hint">{m.settings.midiUnsupported}</p>
      </>
    );
  }

  return (
    <>
      <label className="setting-row">
        <span>{m.settings.midi}</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setMidiInput(e.target.checked);
            if (e.target.checked) void ensureAccess();
          }}
        />
      </label>
      <p className="settings__hint">{m.settings.midiHint}</p>
      {enabled ? <MidiStatus snapshot={snapshot} /> : null}
      {enabled && deviceVelocity ? (
        <MidiVelocity connected={snapshot.kind === 'ready' && snapshot.inputs.length > 0} />
      ) : null}
    </>
  );
}

function MidiStatus({ snapshot }: { snapshot: MidiAccessSnapshot }) {
  const m = useMessages();

  switch (snapshot.kind) {
    case 'requesting':
      return <p className="settings__hint">{m.settings.midiConnecting}</p>;
    case 'idle':
      // Enabled, but this browser has not granted MIDI yet — the piano never
      // prompts on its own, so the ask has to happen here.
      return (
        <button type="button" className="btn btn--small" onClick={() => void ensureAccess()}>
          {m.settings.midiConnect}
        </button>
      );
    case 'denied':
      return (
        <>
          <p role="alert" className="settings__error">
            {m.settings.midiDenied}
          </p>
          <button type="button" className="btn btn--small" onClick={() => void ensureAccess()}>
            {m.settings.midiConnect}
          </button>
        </>
      );
    case 'error':
      return (
        <p role="alert" className="settings__error">
          {m.settings.midiError}
        </p>
      );
    case 'ready':
      return snapshot.inputs.length > 0 ? (
        <p className="settings__hint settings__ok">
          {m.settings.midiDevices({ names: snapshot.inputs.map((port) => port.name).join(', ') })}
        </p>
      ) : (
        <p className="settings__hint">{m.settings.midiNoDevices}</p>
      );
    default:
      // 'idle' and 'unsupported' — the toggle above owns both.
      return null;
  }
}

/**
 * How the keyboard's own velocity is read: a curve for its feel, and a range
 * calibrated to the player's touch. The calibration runs inline rather than in
 * a dialog because an open dialog silences MIDI input, and the notes it asks
 * for would never arrive.
 */
function MidiVelocity({ connected }: { connected: boolean }) {
  const m = useMessages();
  const curve = useSettingsStore((s) => s.midiVelocityCurve);
  const setCurve = useSettingsStore((s) => s.setMidiVelocityCurve);
  const range = useSettingsStore((s) => s.midiVelocityRange);
  const setRange = useSettingsStore((s) => s.setMidiVelocityRange);

  const [calibration, setCalibration] = useState<CalibrationState>(CALIBRATION_IDLE);
  // Each MIDI message is its own task and can land before React renders the
  // last one, so steps are taken against this rather than a rendered value.
  const calibrationRef = useRef(calibration);

  const dispatch = useCallback(
    (action: CalibrationAction) => {
      const next = calibrationReducer(calibrationRef.current, action);
      if (next === calibrationRef.current) return;
      calibrationRef.current = next;
      setCalibration(next);
      if (next.step === 'idle' && next.outcome?.kind === 'saved') setRange(next.outcome.range);
    },
    [setRange],
  );

  const listening = calibration.step !== 'idle';
  useEffect(() => {
    if (!listening) return;
    return registerRawVelocityListener((raw) =>
      dispatch({ type: 'note', raw, atMs: performance.now() }),
    );
  }, [listening, dispatch]);

  let status: string;
  if (calibration.step === 'softest') status = m.settings.midiCalibrateSoftest;
  else if (calibration.step === 'loudest') {
    status = m.settings.midiCalibrateLoudest({ softest: calibration.softest });
  } else if (range) status = m.settings.midiRangeSet(range);
  else status = m.settings.midiRangeNone;

  return (
    <>
      <div
        className="setting-row setting-row--stack"
        role="radiogroup"
        aria-label={m.settings.midiVelocityCurve}
      >
        <span>{m.settings.midiVelocityCurve}</span>
        {MIDI_VELOCITY_CURVES.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="midi-velocity-curve"
              checked={curve === option}
              onChange={() => setCurve(option)}
            />
            {m.settings[CURVE_LABELS[option]]}
          </label>
        ))}
      </div>
      <p className="settings__hint">{m.settings.midiCurveHint}</p>

      <div className="setting-row">
        <span>{m.settings.midiVelocityRange}</span>
        <span className="setting-row__actions">
          {listening ? (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => dispatch({ type: 'cancel' })}
            >
              {m.settings.midiCalibrateCancel}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn--small"
                disabled={!connected}
                onClick={() => dispatch({ type: 'start' })}
              >
                {m.settings.midiCalibrate}
              </button>
              {range ? (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setRange(null);
                    dispatch({ type: 'cancel' });
                  }}
                >
                  {m.settings.midiCalibrateReset}
                </button>
              ) : null}
            </>
          )}
        </span>
      </div>
      <p className={`settings__hint${listening ? ' settings__prompt' : ''}`} role="status">
        {status}
      </p>
      {calibration.step === 'idle' && calibration.outcome?.kind === 'rejected' ? (
        <p role="alert" className="settings__error">
          {m.settings.midiCalibrateRejected}
        </p>
      ) : null}
    </>
  );
}
