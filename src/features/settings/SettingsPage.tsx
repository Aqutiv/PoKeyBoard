import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { audioEngine } from '@/audio/AudioEngine';
import { detectCapabilities, type AppCapabilities } from '@/audio/audioCapabilities';
import { installService } from '@/pwa/install';
import { updateManager } from '@/pwa/updateManager';
import { isBusyState } from '@/features/transport/transportMachine';
import { useSettingsStore } from '@/state/useSettingsStore';
import './settings.css';

const CAPABILITY_LABELS: Record<keyof AppCapabilities, string> = {
  standaloneDisplayMode: 'Running as installed app',
  beforeInstallPrompt: 'Native install prompt',
  share: 'System sharing',
  shareFiles: 'File sharing',
  storagePersist: 'Persistent storage API',
  storageEstimate: 'Storage estimate API',
  fileSystemAccess: 'File System Access',
  wakeLock: 'Screen wake lock',
  audioWorklet: 'AudioWorklet',
  webCodecsAudioEncoder: 'WebCodecs audio encoder',
  pointerEvents: 'Pointer events',
  touch: 'Touch input',
};

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

export function SettingsPage() {
  const settings = useSettingsStore();
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
      setPack({ kind: 'error', message: 'Could not check the sample pack.', totalBytes: 0 });
    }
  }, []);

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
          message: error instanceof Error ? error.message : 'Download failed.',
          totalBytes: 0,
        });
      });
  }, [refreshPackState]);

  const deletePack = useCallback(() => {
    if (!window.confirm('Delete downloaded piano samples? Your takes are not affected.')) return;
    void audioEngine.deleteDownloadedSamples().then(() => void refreshPackState());
  }, [refreshPackState]);

  return (
    <section className="page settings" aria-label="Settings">
      <header className="page__header">
        <h1 className="page__title">Settings</h1>
      </header>

      <div className="settings__scroll">
        <h2 className="settings__section">Sound</h2>
        <label className="setting-row">
          <span>Piano volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.masterVolume}
            onChange={(e) => settings.setMasterVolume(Number(e.target.value))}
          />
        </label>
        <label className="setting-row">
          <span>Reverb</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.reverbMix}
            onChange={(e) => settings.setReverbMix(Number(e.target.value))}
          />
        </label>

        <h2 className="settings__section">Playing</h2>
        <div className="setting-row setting-row--stack" role="radiogroup" aria-label="Velocity">
          <span>Velocity</span>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'touch'}
              onChange={() => settings.setVelocityMode('touch')}
            />
            From touch position on the key
          </label>
          <label>
            <input
              type="radio"
              name="velocity-mode"
              checked={settings.velocityMode === 'fixed'}
              onChange={() => settings.setVelocityMode('fixed')}
            />
            Fixed
          </label>
        </div>
        {settings.velocityMode === 'fixed' ? (
          <label className="setting-row">
            <span>Fixed velocity</span>
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
          <span>Note labels on keys</span>
          <input
            type="checkbox"
            checked={settings.showNoteLabels}
            onChange={(e) => settings.setShowNoteLabels(e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>Sound while scrubbing the score</span>
          <input
            type="checkbox"
            checked={settings.scrubAudition}
            onChange={(e) => settings.setScrubAudition(e.target.checked)}
          />
        </label>

        <h2 className="settings__section">Offline piano</h2>
        {pack.kind === 'checking' ? <p className="settings__hint">Checking…</p> : null}
        {pack.kind === 'not-downloaded' ? (
          <div className="setting-row setting-row--stack">
            <span>
              Download the full piano ({formatMB(pack.totalBytes)}) to keep every key playable
              offline.
            </span>
            <button type="button" className="btn" onClick={downloadPack}>
              Download piano for offline use
            </button>
          </div>
        ) : null}
        {pack.kind === 'downloading' ? (
          <div className="setting-row setting-row--stack" aria-live="polite">
            <span>
              Downloading… {formatMB(pack.loadedBytes)} / {formatMB(pack.totalBytes)}
            </span>
            <progress value={pack.loadedBytes} max={pack.totalBytes} />
          </div>
        ) : null}
        {pack.kind === 'offline-ready' ? (
          <div className="setting-row setting-row--stack">
            <span className="settings__ok">
              ✓ Full piano available offline ({formatMB(pack.totalBytes)})
            </span>
            <button type="button" className="btn" onClick={deletePack}>
              Delete downloaded samples
            </button>
          </div>
        ) : null}
        {pack.kind === 'error' ? (
          <div className="setting-row setting-row--stack">
            <span role="alert" className="settings__error">
              {pack.message}
            </span>
            <button type="button" className="btn" onClick={downloadPack}>
              Try again
            </button>
          </div>
        ) : null}

        <h2 className="settings__section">Storage</h2>
        <p className="settings__hint">
          {storageInfo.persisted === true
            ? 'Persistent storage granted — the browser will avoid evicting your takes.'
            : storageInfo.persisted === false
              ? 'Persistent storage not granted; the browser may clear data under pressure.'
              : 'Persistent storage status unknown in this browser.'}
          {storageInfo.usage !== null && storageInfo.quota !== null
            ? ` Using ${formatMB(storageInfo.usage)} of ${formatMB(storageInfo.quota)}.`
            : ''}
        </p>
        <p className="settings__hint">
          Takes live in this browser only — regular JSON backups (Takes → Backup all) are
          recommended.
        </p>

        <h2 className="settings__section">Install</h2>
        {installService.isStandalone ? (
          <p className="settings__hint settings__ok">✓ Running as an installed app.</p>
        ) : installService.canPromptInstall ? (
          <button
            type="button"
            className="btn"
            onClick={() => void installService.promptInstall().then(() => setInstallTick((n) => n + 1))}
          >
            Install PoKeyBoard
          </button>
        ) : (
          <p className="settings__hint">
            To install on iPhone or iPad: open the Share menu in Safari and choose{' '}
            <strong>Add to Home Screen</strong>. On other browsers, look for an Install or Add to
            Home Screen entry in the browser menu. Open the installed icon before creating
            important takes — the installed app can use separate storage.
          </p>
        )}

        <h2 className="settings__section">Updates</h2>
        {updateAvailable ? (
          <div className="setting-row setting-row--stack">
            <span>An update is ready.</span>
            <button
              type="button"
              className="btn btn--primary"
              disabled={isBusyState(transportState)}
              onClick={() => updateManager.applyUpdate()}
            >
              {isBusyState(transportState) ? 'Finish playing first…' : 'Apply update and reload'}
            </button>
          </div>
        ) : (
          <p className="settings__hint">Up to date — version {__APP_VERSION__}.</p>
        )}

        <h2 className="settings__section">Diagnostics</h2>
        <ul className="caps-list">
          {(Object.keys(CAPABILITY_LABELS) as Array<keyof AppCapabilities>).map((key) => (
            <li key={key} className="caps-list__item">
              <span aria-hidden="true">{caps[key] ? '✓' : '—'}</span>
              <span>{CAPABILITY_LABELS[key]}</span>
            </li>
          ))}
          <li className="caps-list__item">
            <span aria-hidden="true">·</span>
            <span>Estimated output latency: {audioEngine.getOutputLatencyMs()} ms</span>
          </li>
        </ul>
        <p className="settings__hint">
          No sound on iPhone? Check the ring/silent switch and volume — iPhones mute web audio
          while the switch is on silent.
        </p>

        <h2 className="settings__section">Reset</h2>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (window.confirm('Reset all settings to defaults? Takes are not affected.')) {
              settings.resetSettings();
            }
          }}
        >
          Reset settings
        </button>
      </div>
    </section>
  );
}
