/**
 * Long work written once and run two ways: straight through where nothing is
 * waiting on the thread, as in a worker, or a slice at a time on the main
 * thread, where running it straight through would freeze the page and keep a
 * click on Cancel waiting until it was done.
 *
 * The work is a generator that pauses (`yield`) every so often and keeps
 * everything it is in the middle of in its own variables, so it can stop
 * between any two steps and carry on as if it never had.
 */

/** Work that pauses every so often and finishes with a `T`. */
export type Steps<T> = Generator<void, T, void>;

/** Run the work straight through, as a plain function would. */
export function runToEnd<T>(steps: Steps<T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

export interface SliceOptions {
  /** Stops the work at its next turn, with the signal's reason. */
  signal?: AbortSignal;
  /** How the page is given its turn: a task of its own, by default. */
  pause?: () => Promise<void>;
  /** The most work to do before giving the page a turn. */
  sliceMs?: number;
}

/**
 * Half the 50 ms a browser counts as a long task: the page paints about every
 * other frame, and a click waits no longer than about this.
 */
const SLICE_MS = 25;

/** A task of the page's own, the turn the MP3 encoder gives it between chunks. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run the work on the main thread in slices of about `sliceMs`, giving the
 * page a turn between them to paint and to take clicks. A cancelled `signal`
 * stops it at the next turn with the signal's reason, the same error
 * `signal.throwIfAborted()` throws everywhere else.
 */
export async function runInSlices<T>(steps: Steps<T>, options: SliceOptions = {}): Promise<T> {
  const { signal, pause = nextTask, sliceMs = SLICE_MS } = options;
  signal?.throwIfAborted();
  let sliceStart = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - sliceStart >= sliceMs) {
      await pause();
      signal?.throwIfAborted();
      sliceStart = performance.now();
    }
  }
}
