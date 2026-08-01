import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { formatMB } from './formatBytes';

/** Descriptions only — the piano's name comes from the registry, untranslated. */
const PIANO_DESCRIPTION_KEYS: Record<
  PianoInstrumentId,
  'pianoSalamanderDesc' | 'pianoHeadroomDesc'
> = {
  'salamander-grand': 'pianoSalamanderDesc',
  'headroom-grand': 'pianoHeadroomDesc',
};

type PackState =
  | { kind: 'checking' }
  | { kind: 'not-downloaded'; totalBytes: number }
  | { kind: 'downloading'; loadedBytes: number; totalBytes: number }
  | { kind: 'offline-ready'; totalBytes: number }
  | { kind: 'error'; message: string; totalBytes: number };

// Standard preview note for the sound sliders: middle C, mezzo-forte, long
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

  const [packs, setPacks] = useState<Partial<Record<PianoInstrumentId, PackState>>>({});
  const [switching, setSwitching] = useState(false);

  const setPack = useCallback((id: PianoInstrumentId, state: PackState) => {
    setPacks((current) => ({ ...current, [id]: state }));
  }, []);

  const refreshPackState = useCallback(
    async (id: PianoInstrumentId) => {
      try {
        const manifest = await audioEngine.bankFor(id).loadManifest();
        const offline = await audioEngine.isFullPackOffline(id);
        setPack(id, {
          kind: offline ? 'offline-ready' : 'not-downloaded',
          totalBytes: manifest.totalBytes,
        });
      } catch {
        setPack(id, { kind: 'error', message: m.settings.couldNotCheck, totalBytes: 0 });
      }
    },
    [m, setPack],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      for (const piano of PIANO_INSTRUMENTS) void refreshPackState(piano.id);
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshPackState]);

  const downloadPack = useCallback(
    (id: PianoInstrumentId) => {
      setPacks((current) => {
        const state = current[id];
        if (state?.kind !== 'not-downloaded' && state?.kind !== 'error') return current;
        return {
          ...current,
          [id]: { kind: 'downloading', loadedBytes: 0, totalBytes: state.totalBytes },
        };
      });
      audioEngine
        .downloadFullSamplePack(id, (loadedBytes, totalBytes) => {
          setPack(id, { kind: 'downloading', loadedBytes, totalBytes });
        })
        .then(() => void refreshPackState(id))
        .catch((error: unknown) => {
          setPack(id, {
            kind: 'error',
            message: error instanceof Error ? error.message : m.settings.downloadFailed,
            totalBytes: 0,
          });
        });
    },
    [refreshPackState, setPack, m],
  );

  const deletePack = useCallback(
    (id: PianoInstrumentId) => {
      if (!window.confirm(m.settings.deleteSamplesConfirm)) return;
      void audioEngine.deleteDownloadedSamples(id).then(() => void refreshPackState(id));
    },
    [refreshPackState, m],
  );

  // Play a standard mid-note so the volume/reverb sliders preview their effect
  // (routes through the master + reverb graph, so it reflects the live value).
  const previewNote = useCallback(() => {
    void audioEngine.unlockFromUserGesture();
    audioEngine.scheduleNote(
      { midi: PREVIEW_MIDI, velocity: PREVIEW_VELOCITY, durationMs: PREVIEW_DURATION_MS },
      audioEngine.currentTime,
      'settings-preview',
    );
  }, []);

  // The preview has to wait for the new core pack: until it decodes, getSample
  // returns nothing and the note would be silent.
  const selectPiano = useCallback(
    (id: PianoInstrumentId) => {
      if (id === settings.pianoInstrument) return;
      setSwitching(true);
      // Switching the engine and re-stamping the take are the persistence
      // layer's job, on any route to a new piano; this only awaits the switch
      // so the preview note lands on samples that have finished decoding.
      settings.setPianoInstrument(id);
      void audioEngine
        .setInstrument(id)
        .then(previewNote)
        .finally(() => setSwitching(false));
    },
    [settings, previewNote],
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
              className={`setting-row piano-card${active ? ' piano-card--active' : ''}`}
            >
              <label className="piano-card__choice">
                <input
                  type="radio"
                  name="piano-instrument"
                  checked={active}
                  disabled={switching}
                  onChange={() => selectPiano(piano.id)}
                />
                <span className="piano-card__text">
                  <strong className="piano-card__name">{piano.name}</strong>
                  <span className="piano-card__desc">
                    {m.settings[PIANO_DESCRIPTION_KEYS[piano.id]]}
                  </span>
                </span>
              </label>

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
                      onClick={() => deletePack(piano.id)}
                    >
                      {m.settings.deletePiano({ piano: piano.name })}
                    </button>
                  </>
                ) : null}
                {pack.kind === 'error' ? (
                  <>
                    <span role="alert" className="settings__error">
                      {pack.message}
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
        {switching ? <span aria-live="polite">{m.settings.pianoSwitching}</span> : null}
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
          onPointerDown={previewNote}
          onPointerUp={previewNote}
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
          onPointerDown={previewNote}
          onPointerUp={previewNote}
        />
      </label>
    </>
  );
}
