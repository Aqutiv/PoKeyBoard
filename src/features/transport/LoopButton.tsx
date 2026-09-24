import { useState } from 'react';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { TooltipButton } from '@/ui/TooltipButton';
import { formatDurationMs } from '@/utils/timing';
import { loopBetween, nearestBeatMs } from './practiceLoop';
import { transportController } from './transportController';

/**
 * A–B looping on one button, the way a practice player does it: tap as the
 * passage starts, tap again as it ends, and playback repeats it until a third
 * tap lets it go. Works as well playing as paused — seek to each end and tap.
 */
export function LoopButton({ disabled }: { disabled: boolean }) {
  const m = useMessages();
  const takeId = useTakeStore((s) => s.take.id);
  const loop = useTakeStore((s) => s.take.display.loop ?? null);
  const [marked, setMarked] = useState<{ takeId: string; startMs: number } | null>(null);
  // A mark belongs to the take it was made on, and is spent once there is a loop.
  const startMs = marked && marked.takeId === takeId && !loop ? marked.startMs : null;

  const onClick = () => {
    if (loop) {
      setMarked(null);
      transportController.setLoop(null);
      return;
    }
    const take = useTakeStore.getState().take;
    const here = nearestBeatMs(take.tempo, transportController.getPlayheadMs());
    if (startMs === null) {
      setMarked({ takeId, startMs: here });
      return;
    }
    setMarked(null);
    transportController.setLoop(loopBetween(take, startMs, here));
  };

  const label = loop
    ? m.transport.loopClear({
        from: formatDurationMs(loop.startMs, true),
        to: formatDurationMs(loop.endMs, true),
      })
    : startMs === null
      ? m.transport.loopStart
      : m.transport.loopEnd({ from: formatDurationMs(startMs, true) });

  return (
    <TooltipButton
      type="button"
      className={`transport__loop${loop ? ' is-active' : ''}${startMs !== null ? ' is-marked' : ''}`}
      aria-label={label}
      aria-pressed={loop !== null}
      disabled={disabled}
      onClick={onClick}
    >
      {startMs === null ? 'A–B' : 'A–…'}
    </TooltipButton>
  );
}
