import { LANGUAGE_OPTIONS } from '@/i18n';
import { useMessages } from '@/i18n/i18nContext';
import { pinLanguage } from '@/i18n/languagePreference';
import type { SupportedLanguage } from '@/i18n/types';
import { useSettingsStore } from '@/state/useSettingsStore';
import { SettingsGroup } from './SettingsGroup';

/** Settings → Display: what the keys show, then the app's look and language. */
export function DisplaySection() {
  const m = useMessages();
  const settings = useSettingsStore();

  return (
    <>
      <SettingsGroup id="keys" heading={m.settings.keys}>
        <label className="setting-row">
          <span>{m.settings.noteLabels}</span>
          <input
            type="checkbox"
            checked={settings.showNoteLabels}
            onChange={(e) => settings.setShowNoteLabels(e.target.checked)}
          />
        </label>
        <label className="setting-row">
          <span>{m.settings.velocityShading}</span>
          <input
            type="checkbox"
            checked={settings.velocityShading}
            onChange={(e) => settings.setVelocityShading(e.target.checked)}
          />
        </label>
        <p className="settings__hint">{m.settings.velocityShadingHint}</p>
        <label className="setting-row">
          <span>{m.settings.followPlayback}</span>
          <input
            type="checkbox"
            checked={settings.keyboardFollowsPlayback}
            onChange={(e) => settings.setKeyboardFollowsPlayback(e.target.checked)}
          />
        </label>
      </SettingsGroup>

      <SettingsGroup id="appearance" heading={m.settings.appearance}>
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
      </SettingsGroup>
    </>
  );
}
