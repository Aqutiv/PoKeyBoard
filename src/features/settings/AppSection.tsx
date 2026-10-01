import { useEffect, useState } from 'react';
import { APP_BUILD_LABEL } from '@/app/version';
import { audioEngine } from '@/audio/AudioEngine';
import { detectCapabilities, type AppCapabilities } from '@/audio/audioCapabilities';
import { useMessages } from '@/i18n/i18nContext';
import { unpinLanguage } from '@/i18n/languagePreference';
import { installService } from '@/pwa/install';
import { useUpdateAvailable } from '@/pwa/useUpdateAvailable';
import { useSettingsStore } from '@/state/useSettingsStore';
import { formatMB } from './formatBytes';
import { SettingsGroup } from './SettingsGroup';

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
  'gamepad',
  'webMidi',
];

/**
 * Settings → App: installing and updating it, where it keeps its data, what
 * this browser offers, and Reset. An update waiting is announced above the
 * section switch rather than here, so it shows whichever section is open.
 */
export function AppSection() {
  const m = useMessages();
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const updateAvailable = useUpdateAvailable();

  const [storageInfo, setStorageInfo] = useState<{
    usage: number | null;
    quota: number | null;
    persisted: boolean | null;
  }>({ usage: null, quota: null, persisted: null });
  const [caps] = useState<AppCapabilities>(() => detectCapabilities());
  const [installTick, setInstallTick] = useState(0);

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

  return (
    <>
      <SettingsGroup id="install" heading={m.settings.installUpdates}>
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
        <p className="settings__hint">
          {updateAvailable
            ? m.about.version({ version: APP_BUILD_LABEL })
            : m.settings.upToDate({ version: APP_BUILD_LABEL })}
        </p>
      </SettingsGroup>

      <SettingsGroup id="storage" heading={m.settings.storage}>
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
      </SettingsGroup>

      <SettingsGroup id="diagnostics" heading={m.settings.diagnostics}>
        {/* Folded: few players need the list, and it was the longest thing on
            the page. The tip that solves the commonest problem stays out. */}
        <details className="settings-details">
          <summary>{m.settings.deviceDetails}</summary>
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
        </details>
        <p className="settings__hint">{m.settings.iphoneHint}</p>
      </SettingsGroup>

      <SettingsGroup id="reset" heading={m.settings.reset}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (window.confirm(m.settings.resetConfirm)) {
              resetSettings();
              // Reset returns to default behavior: follow the OS language again.
              void unpinLanguage();
            }
          }}
        >
          {m.settings.resetSettings}
        </button>
      </SettingsGroup>
    </>
  );
}
