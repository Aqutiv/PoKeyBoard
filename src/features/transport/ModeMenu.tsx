import type { TrainingHand } from '@/domain/trainingGate';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { MenuButton, type MenuButtonChoice, type MenuButtonGroup } from '@/ui/MenuButton';
import {
  practiceHandFor,
  practiceMode,
  practiceStyleOf,
  type PlaybackMode,
  type PracticeStyle,
  type RecordMode,
} from './modes';
import { transportController } from './transportController';

interface ModeMenuProps {
  /** Recording is under way, so neither mode may change under it. */
  disabled: boolean;
  desktop?: boolean;
}

/**
 * One row of desktop practice buttons: the menu's own choices, each pressed
 * while it is the one in force.
 */
function PracticeOptions({
  label,
  choices,
  disabled,
}: {
  label: string;
  choices: readonly MenuButtonChoice[];
  disabled: boolean;
}) {
  return (
    <div className="practice-options" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          type="button"
          key={choice.label}
          aria-pressed={choice.checked}
          disabled={disabled}
          onClick={choice.onSelect}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Desktop exposes practice choices alongside a recording menu. Compact views
 * keep every group in one menu so the transport still fits on a phone.
 *
 * A practice mode is a hand and a style, and the style is offered once there
 * is a hand to practise. A hand chosen keeps the style in use or, coming from
 * Listen, takes the one last chosen, so a moment of listening does not undo
 * the player's choice of style.
 */
export function ModeMenu({ disabled, desktop = false }: ModeMenuProps) {
  const m = useMessages();
  const recordMode = useSettingsStore((s) => s.recordMode);
  const playbackMode = useSettingsStore((s) => s.playbackMode);
  const lastStyle = useSettingsStore((s) => s.practiceStyle);
  const setRecordMode = useSettingsStore((s) => s.setRecordMode);
  const setPlaybackMode = useSettingsStore((s) => s.setPlaybackMode);
  const setPracticeStyle = useSettingsStore((s) => s.setPracticeStyle);

  const hand = practiceHandFor(playbackMode);
  const style = practiceStyleOf(playbackMode);

  const choosePlayback = (mode: PlaybackMode) => {
    setPlaybackMode(mode);
    // A switch mid-playback takes effect without stopping.
    transportController.refreshTrainingMode();
  };

  const recordChoice = (mode: RecordMode, label: string): MenuButtonChoice => ({
    label,
    checked: recordMode === mode,
    onSelect: () => setRecordMode(mode),
  });

  /** A hand to practise, or null to listen. */
  const handChoice = (choice: TrainingHand | null, label: string): MenuButtonChoice => ({
    label,
    checked: hand === choice,
    onSelect: () =>
      choosePlayback(choice === null ? 'simple' : practiceMode(style ?? lastStyle, choice)),
  });

  const styleChoice = (choice: PracticeStyle, label: string): MenuButtonChoice => ({
    label,
    checked: style === choice,
    onSelect: () => {
      if (hand === null) return;
      setPracticeStyle(choice);
      choosePlayback(practiceMode(choice, hand));
    },
  });

  const styleChoices = [
    styleChoice('wait', m.workflow.waitForMe),
    styleChoice('playAlong', m.workflow.keepTime),
  ];

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
        handChoice(null, m.transport.simple),
        handChoice('left', m.transport.trainingLeft),
        handChoice('right', m.transport.trainingRight),
        handChoice('both', m.transport.trainingBoth),
      ],
    },
    // Only a hand has a style to be practised in. A menu radio cannot be
    // disabled, so under Simple the group is left out rather than shown dead.
    ...(hand === null ? [] : [{ label: m.transport.practiceStyle, choices: styleChoices }]),
  ];

  return (
    <>
      {desktop && (
        <PracticeOptions
          label={m.transport.playbackMode}
          disabled={disabled}
          choices={[
            handChoice(null, m.workflow.listen),
            handChoice('left', m.workflow.practiceLeft),
            handChoice('right', m.workflow.practiceRight),
            handChoice('both', m.workflow.practiceBoth),
          ]}
        />
      )}
      {desktop && hand !== null && (
        <PracticeOptions
          label={m.transport.practiceStyle}
          disabled={disabled}
          choices={styleChoices}
        />
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
