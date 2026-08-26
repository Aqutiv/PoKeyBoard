import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { MenuButton, type MenuButtonGroup } from '@/ui/MenuButton';
import type { PlaybackMode, RecordMode } from './modes';
import { transportController } from './transportController';

interface ModeMenuProps {
  /** Recording is under way, so neither mode may change under it. */
  disabled: boolean;
}

/**
 * The transport's one mode control: what a recording pass does to what is
 * already there, and how playback runs. Two settings in one menu because the
 * transport row has no width for two selects on a phone.
 */
export function ModeMenu({ disabled }: ModeMenuProps) {
  const m = useMessages();
  const recordMode = useSettingsStore((s) => s.recordMode);
  const playbackMode = useSettingsStore((s) => s.playbackMode);
  const setRecordMode = useSettingsStore((s) => s.setRecordMode);
  const setPlaybackMode = useSettingsStore((s) => s.setPlaybackMode);

  const recordChoice = (mode: RecordMode, label: string) => ({
    label,
    checked: recordMode === mode,
    onSelect: () => setRecordMode(mode),
  });

  const playbackChoice = (mode: PlaybackMode, label: string) => ({
    label,
    checked: playbackMode === mode,
    onSelect: () => {
      setPlaybackMode(mode);
      // A switch mid-playback takes effect without stopping.
      transportController.refreshTrainingMode();
    },
  });

  const groups: MenuButtonGroup[] = [
    {
      label: m.transport.recordingMode,
      choices: [
        recordChoice('overdub', m.transport.overdub),
        recordChoice('replace', m.transport.replace),
      ],
    },
    {
      label: m.transport.playbackMode,
      choices: [
        playbackChoice('simple', m.transport.simple),
        playbackChoice('training-left', m.transport.trainingLeft),
        playbackChoice('training-right', m.transport.trainingRight),
        playbackChoice('training-both', m.transport.trainingBoth),
      ],
    },
  ];

  return (
    <MenuButton
      label={m.transport.modes}
      menuLabel={m.transport.modesMenu}
      groups={groups}
      disabled={disabled}
      triggerClassName="transport__mode"
      align="right"
    />
  );
}
