import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { REVERB_ROOMS, reverbRoomOf, type ReverbRoom } from '@/domain/takeTypes';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { usePianoSwitchState } from '@/app/hooks/useAudioEngine';
import { useTransportState } from '@/app/hooks/useTransport';
import { transportController } from '@/features/transport/transportController';
import { formatMB } from './formatBytes';
import { deletePack, downloadPack, getPacks, refreshPack, subscribePacks } from './packStates';
import { PianoSwitchRing } from './PianoSwitchRing';
import { PianoSwitchStatus } from './PianoSwitchStatus';

/** Descriptions only — the piano's name comes from the registry, untranslated. */
const PIANO_DESCRIPTION_KEYS: Record<
  PianoInstrumentId,
  'pianoSalamanderDesc' | 'pianoHeadroomDesc' | 'pianoBitklavierDesc' | 'pianoWurlitzerDesc'
> = {
  'salamander-grand': 'pianoSalamanderDesc',
  'headroom-grand': 'pianoHeadroomDesc',
  'bitklavier-grand': 'pianoBitklavierDesc',
  'wurlitzer-ep203w': 'pianoWurlitzerDesc',
};

// Standard preview note for instrument selection: middle C, mezzo-forte, long
// enough for the reverb tail to be audible after it releases.
const PREVIEW_MIDI = 60;
const PREVIEW_VELOCITY = 0.7;
const PREVIEW_DURATION_MS = 600;

/**
 * Choosing a piano and downloading it are the same errand, so each piano is one
 * card carrying its own offline state — the piano is named once, by the
 * registry, rather than once per concern.
 */
export function PianoSection() {
  const m = useMessages();
  const settings = useSettingsStore();
  const instrument = useTakeStore((state) => state.take.instrument);

  const packs = useSyncExternalStore(subscribePacks, getPacks);
  const switchState = usePianoSwitchState();
  const transportState = useTransportState();

  // Every time the cards show: the cache can change behind them (another tab,
  // the browser clearing storage), and a running download is left alone.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const piano of PIANO_INSTRUMENTS) void refreshPack(piano.id);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const confirmDelete = useCallback(
    (id: PianoInstrumentId) => {
      if (!window.confirm(m.settings.deleteSamplesConfirm)) return;
      void deletePack(id);
    },
    [m],
  );

  // Audition the selected piano through the current master and reverb settings.
  const previewNote = useCallback(() => {
    void audioEngine.unlockFromUserGesture();
    audioEngine.scheduleNote(
      { midi: PREVIEW_MIDI, velocity: PREVIEW_VELOCITY, durationMs: PREVIEW_DURATION_MS },
      audioEngine.currentTime,
      'settings-preview',
    );
  }, []);

  // The preview waits for the new piano to take over: until it has decoded,
  // the previous one is still the one playing, and would sound the note.
  const selectPiano = useCallback(
    (id: PianoInstrumentId) => {
      const audition = transportController.getState() === 'idle';
      void transportController.selectPiano(id).then((changed) => {
        if (changed && audition && transportController.getState() === 'idle') previewNote();
      });
    },
    [previewNote],
  );

  return (
    <>
      <h2 className="settings__section">{m.settings.piano}</h2>
      <p className="settings__hint">{m.settings.pianoHint}</p>

      <div className="piano-choice" role="radiogroup" aria-label={m.settings.piano}>
        {PIANO_INSTRUMENTS.map((piano) => {
          const pack = packs[piano.id] ?? { kind: 'checking' as const };
          const active = settings.pianoInstrument === piano.id;
          return (
            // A button cannot sit inside the label that wraps the radio, so the
            // offline row is a sibling within the card.
            <div
              key={piano.id}
              className={`setting-row piano-card${active ? ' piano-card--active' : ''}${
                switchState.pending === piano.id ? ' piano-card--loading' : ''
              }`}
            >
              <label className="piano-card__choice">
                <input
                  type="radio"
                  name="piano-instrument"
                  checked={active}
                  // Open while a new piano loads: the one playing plays on meanwhile.
                  disabled={
                    transportState !== 'idle' &&
                    transportState !== 'paused' &&
                    transportState !== 'playing'
                  }
                  onChange={() => selectPiano(piano.id)}
                />
                <span className="piano-card__text">
                  <strong className="piano-card__name">{piano.name}</strong>
                  <span className="piano-card__desc">
                    {m.settings[PIANO_DESCRIPTION_KEYS[piano.id]]}
                  </span>
                </span>
              </label>

              <PianoSwitchRing state={switchState} piano={piano.id} />
              <div className="piano-card__offline">
                {pack.kind === 'checking' ? (
                  <span className="settings__hint">{m.settings.checking}</span>
                ) : null}
                {pack.kind === 'not-downloaded' ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => downloadPack(piano.id)}
                  >
                    {m.settings.downloadPiano({
                      piano: piano.name,
                      size: formatMB(pack.totalBytes),
                    })}
                  </button>
                ) : null}
                {pack.kind === 'downloading' ? (
                  <span className="piano-card__progress" aria-live="polite">
                    {m.settings.downloading({
                      loaded: formatMB(pack.loadedBytes),
                      total: formatMB(pack.totalBytes),
                    })}
                    <progress value={pack.loadedBytes} max={pack.totalBytes} />
                  </span>
                ) : null}
                {pack.kind === 'offline-ready' ? (
                  <>
                    <span className="settings__ok">
                      {m.settings.fullOffline({ size: formatMB(pack.totalBytes) })}
                    </span>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => confirmDelete(piano.id)}
                    >
                      {m.settings.deletePiano({ piano: piano.name })}
                    </button>
                  </>
                ) : null}
                {pack.kind === 'error' ? (
                  <>
                    <span role="alert" className="settings__error">
                      {pack.detail ??
                        (pack.failure === 'check'
                          ? m.settings.couldNotCheck
                          : m.settings.downloadFailed)}
                    </span>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => downloadPack(piano.id)}
                    >
                      {m.settings.retryPiano({ piano: piano.name })}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <PianoSwitchStatus state={switchState} />
      </div>

      <label className="setting-row">
        <span>{m.settings.pianoVolume}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={instrument.masterVolume}
          onChange={(e) => settings.setMasterVolume(Number(e.target.value))}
        />
      </label>
      <label className="setting-row">
        <span>{m.settings.reverb}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={instrument.reverbMix}
          onChange={(e) => settings.setReverbMix(Number(e.target.value))}
        />
      </label>
      <label className="setting-row">
        <span>{m.settings.reverbRoom}</span>
        <select
          value={reverbRoomOf(instrument)}
          onChange={(e) => settings.setReverbRoom(e.target.value as ReverbRoom)}
          aria-label={m.settings.reverbRoom}
        >
          {REVERB_ROOMS.map((room) => (
            <option key={room} value={room}>
              {m.settings.reverbRooms[room]}
            </option>
          ))}
        </select>
      </label>
      <label className="setting-row">
        <span>{m.settings.toneFollowsTouch}</span>
        <input
          type="checkbox"
          checked={settings.toneFollowsTouch}
          onChange={(e) => settings.setToneFollowsTouch(e.target.checked)}
        />
      </label>
      <p className="settings__hint">{m.settings.toneFollowsTouchHint}</p>
    </>
  );
}
