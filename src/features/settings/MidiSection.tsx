import { useSyncExternalStore } from 'react';
import {
  ensureAccess,
  getSnapshot,
  subscribe,
  type MidiAccessSnapshot,
} from '@/features/keyboard/midiAccess';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';

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
