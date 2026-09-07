import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { MenuButton, type MenuButtonGroup } from '@/ui/MenuButton';
import type { PlaybackMode, RecordMode } from './modes';
import { transportController } from './transportController';

interface ModeMenuProps {
  /** Recording is under way, so neither mode may change under it. */
  disabled: boolean;
  desktop?: boolean;
}

/**
 * Desktop exposes practice choices alongside a recording menu. Compact views
 * keep the two groups together so the transport still fits on a phone.
 */
export function ModeMenu({ disabled, desktop = false }: ModeMenuProps) {
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
    <>
      {desktop && (
        <div className="practice-options" role="group" aria-label={m.transport.playbackMode}>
          {(
            [
              ['simple', m.workflow.listen],
              ['training-left', m.workflow.practiceLeft],
              ['training-right', m.workflow.practiceRight],
              ['training-both', m.workflow.practiceBoth],
            ] as const
          ).map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              aria-pressed={playbackMode === mode}
              disabled={disabled}
              onClick={() => playbackChoice(mode, label).onSelect()}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <MenuButton
        label={
          desktop
            ? `${m.workflow.recording}: ${recordMode === 'overdub' ? m.transport.overdub : m.transport.replace}`
            : m.transport.modes
        }
        menuLabel={desktop ? m.transport.recordingMode : m.transport.modesMenu}
        groups={desktop ? groups.slice(0, 1) : groups}
        disabled={disabled}
        triggerClassName="transport__mode"
        align="right"
      />
    </>
  );
}
