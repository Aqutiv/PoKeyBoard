import { useSyncExternalStore } from 'react';
import { ensureSysexAccess, getSysexState, subscribe } from '@/features/keyboard/midiAccess';
import { useKeyLightsStatus } from '@/features/keyLights/useKeyLights';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';

/**
 * Key lights, shown once a light-up keyboard is there to light: a PartyKeys
 * over Bluetooth, or over USB once the browser lets the app send it SysEx.
 * A USB one waiting on that permission gets the one button that asks for it,
 * so the "reprogram your MIDI devices" prompt only ever follows a click here.
 */
export function KeyLightsRow() {
  const m = useMessages();
  const status = useKeyLightsStatus();
  const sysex = useSyncExternalStore(subscribe, getSysexState);
  const enabled = useSettingsStore((s) => s.keyLights);
  const setEnabled = useSettingsStore((s) => s.setKeyLights);

  if (!status.keyboard && !status.usbAwaitingSysex) return null;

  return (
    <>
      <label className="setting-row">
        <span>{m.settings.keyLights}</span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      </label>
      {status.keyboard ? (
        <p className="settings__hint">{m.settings.keyLightsHint({ name: status.keyboard.name })}</p>
      ) : (
        <>
          <div className="setting-row">
            <span className="settings__hint">{m.settings.keyLightsUsbHint}</span>
            <span className="setting-row__actions">
              <button
                type="button"
                className="btn btn--small"
                disabled={sysex === 'requesting'}
                onClick={() => void ensureSysexAccess()}
              >
                {m.settings.keyLightsAllowUsb}
              </button>
            </span>
          </div>
          {sysex === 'denied' ? (
            <p role="alert" className="settings__error">
              {m.settings.keyLightsUsbDenied}
            </p>
          ) : sysex === 'error' ? (
            <p role="alert" className="settings__error">
              {m.settings.keyLightsUsbError}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
