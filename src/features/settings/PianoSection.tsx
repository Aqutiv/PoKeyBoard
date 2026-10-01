import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { REVERB_ROOMS, reverbRoomOf, type ReverbRoom } from '@/domain/takeTypes';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { usePianoSwitchState } from '@/app/hooks/useAudioEngine';
import { useTransportState } from '@/app/hooks/useTransport';
import { transportController } from '@/features/transport/transportController';
import { TooltipButton } from '@/ui/TooltipButton';
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

/** The line icons the nav draws with, at the small buttons' size. */
const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function DownloadIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7M10.5 11v5.5M13.5 11v5.5" />
    </svg>
  );
}

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
  // Each radio has two labels, its name's and its description's.
  const idPrefix = useId();

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
      <p className="settings__hint">{m.settings.pianoHint}</p>

      <div className="piano-choice" role="radiogroup" aria-label={m.settings.piano}>
        {PIANO_INSTRUMENTS.map((piano) => {
          const pack = packs[piano.id] ?? { kind: 'checking' as const };
          const active = settings.pianoInstrument === piano.id;
          const radioId = `${idPrefix}-${piano.id}`;
          return (
            // A button cannot sit inside the label that wraps the radio, so the
            // offline controls are siblings within the card: the steady ones on
            // the name's line, a download's progress or failure on a line below.
            <div
              key={piano.id}
              className={`setting-row piano-card${active ? ' piano-card--active' : ''}${
                switchState.pending === piano.id ? ' piano-card--loading' : ''
              }`}
            >
              <label className="piano-card__choice">
                <input
                  id={radioId}
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
                <strong className="piano-card__name">{piano.name}</strong>
              </label>

              <span className="piano-card__offline">
                {pack.kind === 'checking' ? (
                  <span className="settings__hint">{m.settings.checking}</span>
                ) : null}
                {pack.kind === 'not-downloaded' ? (
                  <TooltipButton
                    type="button"
                    className="btn btn--small piano-card__download"
                    aria-label={m.settings.downloadPiano({
                      piano: piano.name,
                      size: formatMB(pack.totalBytes),
                    })}
                    onClick={() => downloadPack(piano.id)}
                  >
                    <DownloadIcon />
                    {formatMB(pack.totalBytes)}
                  </TooltipButton>
                ) : null}
                {pack.kind === 'offline-ready' ? (
                  <>
                    <span className="settings__ok">{m.settings.offlineReady}</span>
                    <TooltipButton
                      type="button"
                      className="btn btn--small btn--danger piano-card__icon-button"
                      aria-label={m.settings.deletePiano({ piano: piano.name })}
                      onClick={() => confirmDelete(piano.id)}
                    >
                      <TrashIcon />
                    </TooltipButton>
                  </>
                ) : null}
              </span>

              {/* A second label for the same radio: the description names the
                  choice too, and a tap on it chooses the piano. */}
              <label className="piano-card__desc" htmlFor={radioId}>
                {m.settings[PIANO_DESCRIPTION_KEYS[piano.id]]}
              </label>

              {pack.kind === 'downloading' ? (
                <span className="piano-card__more piano-card__progress" aria-live="polite">
                  {m.settings.downloading({
                    loaded: formatMB(pack.loadedBytes),
                    total: formatMB(pack.totalBytes),
                  })}
                  <progress value={pack.loadedBytes} max={pack.totalBytes} />
                </span>
              ) : null}
              {pack.kind === 'error' ? (
                <span className="piano-card__more">
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
                </span>
              ) : null}

              <PianoSwitchRing state={switchState} piano={piano.id} />
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
