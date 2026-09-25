import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { MenuButton } from '@/ui/MenuButton';
import { PLAYBACK_SPEEDS } from './modes';
import { transportController } from './transportController';

function percent(speed: number): number {
  return Math.round(speed * 100);
}

/** How fast playback runs, as a menu of speeds; the trigger shows the one in use. */
export function SpeedMenu({ disabled }: { disabled: boolean }) {
  const m = useMessages();
  const speed = useTakeStore((s) => s.take.display.speed ?? 1);
  return (
    <MenuButton
      label={m.transport.speedChoice({ percent: percent(speed) })}
      ariaLabel={m.transport.speedLabel({ percent: percent(speed) })}
      menuLabel={m.transport.speed}
      groups={[
        {
          label: m.transport.speed,
          choices: PLAYBACK_SPEEDS.map((choice) => ({
            label: m.transport.speedChoice({ percent: percent(choice) }),
            checked: percent(choice) === percent(speed),
            onSelect: () => transportController.setSpeed(choice),
          })),
        },
      ]}
      disabled={disabled}
      triggerClassName={`transport__mode transport__speed${speed === 1 ? '' : ' is-changed'}`}
      align="right"
    />
  );
}
