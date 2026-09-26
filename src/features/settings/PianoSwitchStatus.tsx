import { audioEngine, type InstrumentSwitchState } from '@/audio/AudioEngine';
import { pianoInstrument } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';

/**
 * What a change of piano is doing, beside either picker: loading the new one
 * while the previous one plays on, or why it could not be loaded.
 */
export function PianoSwitchStatus({ state }: { state: InstrumentSwitchState }) {
  const m = useMessages();
  if (state.pending) return <span role="status">{m.settings.pianoSwitching}</span>;
  if (!state.failed) return null;
  return (
    <span role="alert" className="piano-switch-status--failed">
      {m.settings.pianoSwitchFailed({
        piano: pianoInstrument(state.failed).name,
        // Nothing else can have played since: any new choice clears `failed`.
        current: audioEngine.soundingInstrument.name,
      })}
    </span>
  );
}
