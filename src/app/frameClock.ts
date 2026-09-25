/**
 * One animation-frame loop for everything on screen that moves with the
 * transport: the key lights and pedal cue, the beat dots, the time readout.
 *
 * Each used to poll on a timer of its own — 90, 90, 60 and 100 ms — so a fast
 * run could light a key late or skip it altogether, and every tick rendered
 * React whether anything had changed or not. Now one loop runs at the
 * display's own rate, and only while something is subscribed: nothing moving,
 * no frames. Each subscriber touches the DOM, or React state, only when what it
 * shows has changed.
 *
 * The audio clock still owns time. A frame only reads it.
 */

export type FrameCallback = (now: number) => void;

const callbacks = new Set<FrameCallback>();
let handle: number | null = null;

function tick(now: number): void {
  handle = null;
  // A callback may unsubscribe itself, or another; iterate a snapshot.
  for (const callback of [...callbacks]) {
    if (callbacks.has(callback)) callback(now);
  }
  if (callbacks.size > 0 && handle === null) handle = requestAnimationFrame(tick);
}

/** Run `callback` on every animation frame until the returned function is called. */
export function subscribeFrame(callback: FrameCallback): () => void {
  callbacks.add(callback);
  if (handle === null) handle = requestAnimationFrame(tick);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0 && handle !== null) {
      cancelAnimationFrame(handle);
      handle = null;
    }
  };
}

/** How many callbacks are subscribed; the loop runs only while this is above zero. */
export function frameSubscriberCount(): number {
  return callbacks.size;
}
