import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { APP_VERSION } from '@/app/version';
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
import { formatMB } from './formatBytes';
import { PianoSection } from './PianoSection';
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
  'gamepad',
];

function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => updateManager.subscribe(onStoreChange),
    () => updateManager.updateAvailable,
  );
}

export function SettingsPage() {
  const m = useMessages();
  const settings = useSettingsStore();
  const transportState = useTransportState();
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
    <section className="page settings" aria-label={m.settings.title}>
      <header className="page__header">
        <h1 className="page__title">{m.settings.title}</h1>
      </header>

      {/* Sections run most-played first, then the app itself. They stay direct
          children of the scroller: `.settings__section:first-child` trims the
          leading margin, and the e2e suite treats the page as one flat list. */}
      <div className="settings__scroll">
        <PianoSection />

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
        <label className="setting-row">
          <span>{m.settings.backgroundPlayback}</span>
          <input
            type="checkbox"
            checked={settings.backgroundPlayback}
            onChange={(e) => settings.setBackgroundPlayback(e.target.checked)}
          />
        </label>
        <p className="settings__hint">{m.settings.backgroundPlaybackHint}</p>
        <label className="setting-row">
          <span>{m.settings.gamepad}</span>
          <input
            type="checkbox"
            checked={settings.gamepadInput}
            onChange={(e) => settings.setGamepadInput(e.target.checked)}
          />
        </label>
        <p className="settings__hint">{m.settings.gamepadHint}</p>

        <h2 className="settings__section">{m.settings.appearance}</h2>
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
        <div
          className="setting-row setting-row--stack"
          role="radiogroup"
          aria-label={m.settings.theme}
        >
          <span>{m.settings.theme}</span>
          <label>
            <input
              type="radio"
              name="theme-preference"
              checked={settings.theme === 'dark'}
              onChange={() => settings.setTheme('dark')}
            />
            {m.settings.themeDark}
          </label>
          <label>
            <input
              type="radio"
              name="theme-preference"
              checked={settings.theme === 'light'}
              onChange={() => settings.setTheme('light')}
            />
            {m.settings.themeLight}
          </label>
          <label>
            <input
              type="radio"
              name="theme-preference"
              checked={settings.theme === 'system'}
              onChange={() => settings.setTheme('system')}
            />
            {m.settings.themeSystem}
          </label>
        </div>

        <h2 className="settings__section">{m.settings.app}</h2>
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
          <p className="settings__hint">{m.settings.upToDate({ version: APP_VERSION })}</p>
        )}

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
