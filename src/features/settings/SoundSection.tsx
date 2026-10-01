import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { PianoSection } from './PianoSection';
import { SettingsGroup } from './SettingsGroup';

/** Settings → Sound: which piano plays and how it sounds, then when it plays. */
export function SoundSection() {
  const m = useMessages();
  const settings = useSettingsStore();

  return (
    <>
      <SettingsGroup id="piano" heading={m.settings.piano}>
        <PianoSection />
      </SettingsGroup>

      <SettingsGroup id="playback" heading={m.settings.playback}>
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
      </SettingsGroup>
    </>
  );
}
