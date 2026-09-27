import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InstrumentSwitchState } from '@/audio/AudioEngine';
import type { PianoInstrumentId } from '@/audio/instruments';

/** How far outside its control the ring is drawn, and how thick, in px. */
const RING_OUTSET = 2;
const RING_WIDTH = 3;
/** How long the glow of a piano taking over, or the flash of a failure, lasts. */
const FINISH_MS = 700;

type RingState = 'loading' | 'done' | 'failed';

/**
 * A change of piano, drawn on the control that made it: a ring that runs round
 * its border as the new piano decodes, glows as that piano takes over, and
 * flashes red if it could not be loaded. The control must be positioned, and
 * the ring follows its size and corner radius. `piano` narrows it to one
 * piano's card; without it, any change of piano is shown.
 */
export function PianoSwitchRing({
  state,
  piano,
}: {
  state: InstrumentSwitchState;
  piano?: PianoInstrumentId;
}) {
  const pending = piano === undefined || state.pending === piano ? state.pending : null;
  const [finish, setFinish] = useState<'done' | 'failed' | null>(null);
  // Adjusted while rendering, as React has it for state that follows a prop:
  // a switch ending here glows if its piano now plays, flashes if it failed,
  // and simply goes if it was called off or overtaken by another.
  const [shown, setShown] = useState(pending);
  if (pending !== shown) {
    setShown(pending);
    if (pending) setFinish(null);
    else if (shown && state.failed === shown) setFinish('failed');
    else if (shown && state.sounding === shown) setFinish('done');
  }
  useEffect(() => {
    if (!finish) return;
    const timer = setTimeout(() => setFinish(null), FINISH_MS);
    return () => clearTimeout(timer);
  }, [finish]);

  // A new piano's ring starts from nothing rather than running back.
  if (pending) return <Ring key={pending} state="loading" progress={state.progress} />;
  if (finish) return <Ring key={finish} state={finish} progress={1} />;
  return null;
}

function Ring({ state, progress }: { state: RingState; progress: number }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number; radius: number } | null>(null);

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = () =>
      setBox({
        width: host.offsetWidth,
        height: host.offsetHeight,
        radius: Number.parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0,
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const width = (box?.width ?? 0) + RING_OUTSET * 2;
  const height = (box?.height ?? 0) + RING_OUTSET * 2;
  // The stroke is centred on this rectangle, so it reaches from the ring's
  // outer edge to just inside the control's border.
  const inset = RING_WIDTH / 2;
  const rect = box
    ? {
        x: inset,
        y: inset,
        width: Math.max(0, width - RING_WIDTH),
        height: Math.max(0, height - RING_WIDTH),
        rx: box.radius + RING_OUTSET - inset,
      }
    : null;
  return (
    <svg
      ref={ref}
      className="switch-ring"
      data-ring-state={state}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {rect ? (
        <>
          <rect className="switch-ring__track" {...rect} />
          {/* pathLength makes the dash a percentage, whatever the control's size;
              a rect's path starts at its top-left and runs clockwise. */}
          <rect
            className="switch-ring__arc"
            {...rect}
            pathLength={100}
            style={{ strokeDashoffset: 100 - Math.min(1, Math.max(0, progress)) * 100 }}
          />
        </>
      ) : null}
    </svg>
  );
}
