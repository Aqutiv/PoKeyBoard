import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';

/** Desktop shortcuts to the same controls available in Settings. */
export function PianoControls() {
  const m = useMessages();
  const piano = useSettingsStore((s) => s.pianoInstrument);
  const volume = useSettingsStore((s) => s.masterVolume);
  const setPiano = useSettingsStore((s) => s.setPianoInstrument);
  const setVolume = useSettingsStore((s) => s.setMasterVolume);
  return (
    <div className="play-piano-controls">
      <label>
        <span>{m.settings.piano}</span>
        <select value={piano} onChange={(e) => setPiano(e.target.value as PianoInstrumentId)}>
          {PIANO_INSTRUMENTS.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{m.settings.pianoVolume}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
