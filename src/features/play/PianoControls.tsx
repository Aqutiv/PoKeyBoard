import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { usePianoSwitching, useTransportState } from '@/app/hooks/useTransport';
import { transportController } from '@/features/transport/transportController';

/** Desktop shortcuts to the same controls available in Settings. */
export function PianoControls() {
  const m = useMessages();
  const piano = useSettingsStore((s) => s.pianoInstrument);
  const volume = useSettingsStore((s) => s.masterVolume);
  const switching = usePianoSwitching();
  const state = useTransportState();
  const setVolume = useSettingsStore((s) => s.setMasterVolume);
  return (
    <div className="play-piano-controls">
      <label>
        <span>{m.settings.piano}</span>
        <select
          value={piano}
          disabled={switching || (state !== 'idle' && state !== 'paused' && state !== 'playing')}
          onChange={(e) =>
            void transportController.selectPiano(e.target.value as PianoInstrumentId)
          }
        >
          {PIANO_INSTRUMENTS.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.name}
            </option>
          ))}
        </select>
      </label>
      {switching ? <span role="status">{m.settings.pianoSwitching}</span> : null}
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
