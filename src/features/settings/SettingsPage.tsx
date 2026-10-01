import { useEffect } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { useMessages } from '@/i18n/i18nContext';
import { updateManager } from '@/pwa/updateManager';
import { useUpdateAvailable } from '@/pwa/useUpdateAvailable';
import { isBusyState } from '@/features/transport/transportMachine';
import { useSettingsStore } from '@/state/useSettingsStore';
import { SegmentedSwitch } from '@/ui/SegmentedSwitch';
import { AppSection } from './AppSection';
import { DisplaySection } from './DisplaySection';
import { PlayingSection } from './PlayingSection';
import { SETTINGS_SECTION_IDS, type SettingsSectionId } from './sections';
import { SoundSection } from './SoundSection';
import './settings.css';

/** Opening Settings is asking "is there an update?", so it checks sooner. */
const SETTINGS_UPDATE_CHECK_INTERVAL_MS = 60_000;

/**
 * Settings, in four sections behind a switch like the library's folders and
 * Learn's levels: Sound, Playing, Display and App. The section last shown is
 * a setting of its own, so Settings opens where the player left it.
 */
export function SettingsPage() {
  const m = useMessages();
  const section = useSettingsStore((s) => s.settingsSection);
  const setSection = useSettingsStore((s) => s.setSettingsSection);

  useEffect(() => updateManager.checkForUpdate(SETTINGS_UPDATE_CHECK_INTERVAL_MS), []);

  return (
    <section className="page settings" aria-label={m.settings.title}>
      <header className="page__header">
        <h1 className="page__title">{m.settings.title}</h1>
      </header>
      <UpdateBanner />
      {/* Four sections at 320px leave ~69px each, ~57px of it for text, so
          the labels shrink as Learn's levels do. */}
      <SegmentedSwitch
        ariaLabel={m.settings.sectionLabel}
        options={SETTINGS_SECTION_IDS.map((id) => ({ value: id, label: m.settings.sections[id] }))}
        value={section}
        onChange={setSection}
        shrink
      />
      {/* Keyed, so each section opens at its top. One scroller over all of a
          section's groups, not one per group, so their headings can stick. */}
      <div className="settings__scroll" key={section}>
        <SectionContent section={section} />
      </div>
    </section>
  );
}

function SectionContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case 'sound':
      return <SoundSection />;
    case 'playing':
      return <PlayingSection />;
    case 'display':
      return <DisplaySection />;
    case 'app':
      return <AppSection />;
    default: {
      // As in App.tsx: a section with no case here fails the build.
      const unhandled: never = section;
      return unhandled;
    }
  }
}

/**
 * An update waiting, above the switch so it shows on every section: the badge
 * on the Settings tab is what led the player here.
 */
function UpdateBanner() {
  const m = useMessages();
  const updateAvailable = useUpdateAvailable();
  const busy = isBusyState(useTransportState());
  if (!updateAvailable) return null;
  return (
    <div className="settings-update">
      <span>{m.settings.updateReady}</span>
      <button
        type="button"
        className="btn btn--primary btn--small"
        disabled={busy}
        onClick={() => updateManager.applyUpdate()}
      >
        {busy ? m.settings.finishPlaying : m.settings.applyUpdate}
      </button>
    </div>
  );
}
