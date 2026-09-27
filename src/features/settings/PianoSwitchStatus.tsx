import type { InstrumentSwitchState } from '@/audio/AudioEngine';
import { pianoInstrument } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';

/**
 * What a change of piano is doing, in words, beside either picker. Loading is
 * shown on the control itself (`PianoSwitchRing`), so its words are for screen
 * readers only; a piano that could not be loaded is said for everyone. The
 * status region stays mounted, so a reader announces what appears in it.
 */
export function PianoSwitchStatus({ state }: { state: InstrumentSwitchState }) {
  const m = useMessages();
  return (
    <>
      <span role="status" className="visually-hidden">
        {state.pending ? m.settings.pianoSwitching : ''}
      </span>
      {state.failed ? (
        <span role="alert" className="piano-switch-status--failed">
          {m.settings.pianoSwitchFailed({
            piano: pianoInstrument(state.failed).name,
            current: pianoInstrument(state.sounding).name,
          })}
        </span>
      ) : null}
    </>
  );
}
