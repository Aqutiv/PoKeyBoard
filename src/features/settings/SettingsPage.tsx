import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { audioEngine } from '@/audio/AudioEngine';
import { detectCapabilities, type AppCapabilities } from '@/audio/audioCapabilities';
import { LANGUAGE_OPTIONS } from '@/i18n';
import { useMessages } from '@/i18n/i18nContext';
import { pinLanguage, unpinLanguage } from '@/i18n/languagePreference';
import type { SupportedLanguage } from '@/i18n/types';
import { installService } from '@/pwa/install';
import { updateManager } from '@/pwa/updateManager';
import { isBusyState } from '@/features/transport/transportMachine';
import { useSettingsStore } from '@/state/useSettingsStore';
import { SETTINGS_DEFAULTS } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import './settings.css';

const CAPABILITY_KEYS: ReadonlyArray<keyof AppCapabilities> = [
  'standaloneDisplayMode',
  'beforeInstallPrompt',
  'share',
  'shareFiles',
  'storagePersist',
  'storageEstimate',
  'fileSystemAccess',
  'wakeLock',
  'audioWorklet',
  'webCodecsAudioEncoder',
  'pointerEvents',
  'touch',
];

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

type PackState =
  | { kind: 'checking' }
  | { kind: 'not-downloaded'; totalBytes: number }
  | { kind: 'downloading'; loadedBytes: number; totalBytes: number }
  | { kind: 'offline-ready'; totalBytes: number }
  | { kind: 'error'; message: string; totalBytes: number };

function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => updateManager.subscribe(onStoreChange),
    () => updateManager.updateAvailable,
  );
}

// Standard preview note for the sound sliders: middle C, mezzo-forte, long
// enough for the reverb tail to be audible after it releases.
const PREVIEW_MIDI = 60;
const PREVIEW_VELOCITY = 0.7;
const PREVIEW_DURATION_MS = 600;

export function SettingsPage() {
  const m = useMessages();
  const settings = useSettingsStore();
  const instrument = useTakeStore((state) => state.take.instrument);
  const setInstrumentSettings = useTakeStore((state) => state.setInstrumentSettings);
  const transportState = useTransportState();
  const updateAvailable = useUpdateAvailable();

  const [pack, setPack] = useState<PackState>({ kind: 'checking' });
  const [storageInfo, setStorageInfo] = useState<{
    usage: number | null;
    quota: number | null;
    persisted: boolean | null;
  }>({ usage: null, quota: null, persisted: null });
  const [caps] = useState<AppCapabilities>(() => detectCapabilities());
  const [installTick, setInstallTick] = useState(0);

  const refreshPackState = useCallback(async () => {
    try {
      const manifest = await audioEngine.bank.loadManifest();
      const offline = await audioEngine.isFullPackOffline();
      setPack(
        offline
          ? { kind: 'offline-ready', totalBytes: manifest.totalBytes }
          : { kind: 'not-downloaded', totalBytes: manifest.totalBytes },
      );
    } catch {
      setPack({ kind: 'error', message: m.settings.couldNotCheck, totalBytes: 0 });
    }
  }, [m]);

  useEffect(() => {
    const id = setTimeout(() => void refreshPackState(), 0);
    return () => clearTimeout(id);
  }, [refreshPackState]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const nav = navigator as Navigator & { storage?: StorageManager };
      let usage: number | null = null;
      let quota: number | null = null;
      let persisted: boolean | null = null;
      try {
        if (typeof nav.storage?.estimate === 'function') {
          const estimate = await nav.storage.estimate();
          usage = estimate.usage ?? null;
          quota = estimate.quota ?? null;
        }
        if (typeof nav.storage?.persisted === 'function') {
          persisted = await nav.storage.persisted();
        }
      } catch {
        // Diagnostics only.
      }
      if (alive) setStorageInfo({ usage, quota, persisted });
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => installService.subscribe(() => setInstallTick((n) => n + 1)), []);
  void installTick;

  const downloadPack = useCallback(() => {
    setPack((current) =>
      current.kind === 'not-downloaded' || current.kind === 'error'
        ? { kind: 'downloading', loadedBytes: 0, totalBytes: current.totalBytes }
        : current,
    );
    audioEngine
      .downloadFullSamplePack((loadedBytes, totalBytes) => {
        setPack({ kind: 'downloading', loadedBytes, totalBytes });
      })
      .then(() => void refreshPackState())
      .catch((error: unknown) => {
        setPack({
          kind: 'error',
          message: error instanceof Error ? error.message : m.settings.downloadFailed,
          totalBytes: 0,
        });
      });
  }, [refreshPackState, m]);

  const deletePack = useCallback(() => {
    if (!window.confirm(m.settings.deleteSamplesConfirm)) return;
    void audioEngine.deleteDownloadedSamples().then(() => void refreshPackState());
  }, [refreshPackState, m]);

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

  return (
    <section className="page settings" aria-label={m.settings.title}>
      <header className="page__header">
        <h1 className="page__title">{m.settings.title}</h1>
      </header>

      <div className="settings__scroll">
        <h2 className="settings__section">{m.settings.language}</h2>
        <label className="setting-row">
          <span>{m.settings.language}</span>
          <select
            value={settings.language}
            onChange={(e) => {
              settings.setLanguage(e.target.value as SupportedLanguage);
              void pinLanguage();
            }}
            aria-label={m.settings.language}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <h2 className="settings__section">{m.settings.sound}</h2>
        <label className="setting-row">
          <span>{m.settings.pianoVolume}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={instrument.masterVolume}
            onChange={(e) => {
              const masterVolume = Number(e.target.value);
              settings.setMasterVolume(masterVolume);
              setInstrumentSettings({ ...instrument, masterVolume });
            }}
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
            onChange={(e) => {
              const reverbMix = Number(e.target.value);
              settings.setReverbMix(reverbMix);
              setInstrumentSettings({ ...instrument, reverbMix });
            }}
            onPointerDown={previewNote}
            onPointerUp={previewNote}
          />
        </label>

        <h2 className="settings__section">{m.settings.playing}</h2>
        <div
          className="setting-row setting-row--stack"
          role="radiogroup"
          aria-label={m.settings.velocity}
        >
          <span>{m.settings.velocity}</span>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'touch'}
              onChange={() => settings.setVelocityMode('touch')}
            />
            {m.settings.velocityTouch}
          </label>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'fixed'}
              onChange={() => settings.setVelocityMode('fixed')}
            />
            {m.settings.velocityFixed}
          </label>
        </div>
        {settings.velocityMode === 'fixed' ? (
          <label className="setting-row">
            <span>{m.settings.fixedVelocity}</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={settings.fixedVelocity}
              onChange={(e) => settings.setFixedVelocity(Number(e.target.value))}
            />
          </label>
        ) : null}
        <label className="setting-row">
          <span>{m.settings.noteLabels}</span>
          <input
            type="checkbox"
            checked={settings.showNoteLabels}
            onChange={(e) => settings.setShowNoteLabels(e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>{m.settings.scrubAudition}</span>
          <input
            type="checkbox"
            checked={settings.scrubAudition}
            onChange={(e) => settings.setScrubAudition(e.target.checked)}
          />
        </label>

        <h2 className="settings__section">{m.settings.offlinePiano}</h2>
        {pack.kind === 'checking' ? <p className="settings__hint">{m.settings.checking}</p> : null}
        {pack.kind === 'not-downloaded' ? (
          <div className="setting-row setting-row--stack">
            <span>{m.settings.downloadPrompt({ size: formatMB(pack.totalBytes) })}</span>
            <button type="button" className="btn" onClick={downloadPack}>
              {m.settings.downloadButton}
            </button>
          </div>
        ) : null}
        {pack.kind === 'downloading' ? (
          <div className="setting-row setting-row--stack" aria-live="polite">
            <span>
              {m.settings.downloading({
                loaded: formatMB(pack.loadedBytes),
                total: formatMB(pack.totalBytes),
              })}
            </span>
            <progress value={pack.loadedBytes} max={pack.totalBytes} />
          </div>
        ) : null}
        {pack.kind === 'offline-ready' ? (
          <div className="setting-row setting-row--stack">
            <span className="settings__ok">
              {m.settings.fullOffline({ size: formatMB(pack.totalBytes) })}
            </span>
            <button type="button" className="btn" onClick={deletePack}>
              {m.settings.deleteSamples}
            </button>
          </div>
        ) : null}
        {pack.kind === 'error' ? (
          <div className="setting-row setting-row--stack">
            <span role="alert" className="settings__error">
              {pack.message}
            </span>
            <button type="button" className="btn" onClick={downloadPack}>
              {m.settings.tryAgain}
            </button>
          </div>
        ) : null}

        <h2 className="settings__section">{m.settings.storage}</h2>
        <p className="settings__hint">
          {storageInfo.persisted === true
            ? m.settings.persistGranted
            : storageInfo.persisted === false
              ? m.settings.persistNotGranted
              : m.settings.persistUnknown}
          {storageInfo.usage !== null && storageInfo.quota !== null
            ? m.settings.storageUsing({
                usage: formatMB(storageInfo.usage),
                quota: formatMB(storageInfo.quota),
              })
            : ''}
        </p>
        <p className="settings__hint">{m.settings.takesLocalHint}</p>

        <h2 className="settings__section">{m.settings.install}</h2>
        {installService.isStandalone ? (
          <p className="settings__hint settings__ok">{m.settings.runningInstalled}</p>
        ) : installService.canPromptInstall ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              void installService.promptInstall().then(() => setInstallTick((n) => n + 1))
            }
          >
            {m.settings.installApp}
          </button>
        ) : (
          <p className="settings__hint">
            {m.settings.installHintPre}
            <strong>{m.settings.addToHomeScreen}</strong>
            {m.settings.installHintPost}
          </p>
        )}

        <h2 className="settings__section">{m.settings.updates}</h2>
        {updateAvailable ? (
          <div className="setting-row setting-row--stack">
            <span>{m.settings.updateReady}</span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={isBusyState(transportState)}
              onClick={() => updateManager.applyUpdate()}
            >
              {isBusyState(transportState) ? m.settings.finishPlaying : m.settings.applyUpdate}
            </button>
          </div>
        ) : (
          <p className="settings__hint">{m.settings.upToDate({ version: __APP_VERSION__ })}</p>
        )}

        <h2 className="settings__section">{m.settings.diagnostics}</h2>
        <ul className="caps-list">
          {CAPABILITY_KEYS.map((key) => (
            <li key={key} className="caps-list__item">
              <span aria-hidden="true">{caps[key] ? '✓' : '—'}</span>
              <span>{m.settings.capabilities[key]}</span>
            </li>
          ))}
          <li className="caps-list__item">
            <span aria-hidden="true">·</span>
            <span>{m.settings.outputLatency({ ms: audioEngine.getOutputLatencyMs() })}</span>
          </li>
        </ul>
        <p className="settings__hint">{m.settings.iphoneHint}</p>

        <h2 className="settings__section">{m.settings.reset}</h2>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (window.confirm(m.settings.resetConfirm)) {
              settings.resetSettings();
              setInstrumentSettings({
                ...instrument,
                masterVolume: SETTINGS_DEFAULTS.masterVolume,
                reverbMix: SETTINGS_DEFAULTS.reverbMix,
              });
              // Reset returns to default behavior: follow the OS language again.
              void unpinLanguage();
            }
          }}
        >
          {m.settings.resetSettings}
        </button>
      </div>
    </section>
  );
}
