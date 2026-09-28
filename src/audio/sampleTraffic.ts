/**
 * How many files the background loads fetch at once, all of them together. A
 * load someone waits for fetches four (`FETCH_CONCURRENCY`), and a browser
 * opens six connections to a host over HTTP/1.1, so none of its files ever
 * queues for a connection behind one nobody is waiting for.
 */
export const BACKGROUND_CONCURRENCY = 2;

/**
 * Which of the pianos' sample loads goes first. The loads someone is waiting
 * for — a piano becoming ready, keys it is asked to play, an export, a
 * download for offline use — go ahead of the background loads nobody is waiting
 * for, the deferred layers (`SampleBank.loadDeferred`). An engine's banks share
 * one, because a switch loads one piano while the other plays on and fetches
 * its own.
 *
 * A background load takes a turn for each file it starts. No turn is given
 * while a foreground load is under way, and no more than
 * BACKGROUND_CONCURRENCY are out at once. A file already started is left to
 * finish, because something in the foreground may be waiting on it (an export
 * that wants the very file a background load is fetching). So the background
 * only ever waits between files, never with one in hand.
 */
export class SampleTraffic {
  private foregroundLoads = 0;
  private backgroundFiles = 0;
  private readonly waiting: Array<() => void> = [];

  /**
   * Hold the background back while a load someone waits for runs. Call the
   * returned function once it is over; only the first call counts.
   */
  foreground(): () => void {
    this.foregroundLoads += 1;
    return this.once(() => {
      this.foregroundLoads -= 1;
    });
  }

  /**
   * Wait for a background load's turn to start its next file. Call the
   * returned function once that file is decoded, or has failed, to give the
   * turn back; only the first call counts.
   */
  backgroundTurn(): Promise<() => void> {
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.backgroundFiles += 1;
        resolve(
          this.once(() => {
            this.backgroundFiles -= 1;
          }),
        );
      });
      this.admit();
    });
  }

  /** `end`, then any turns it frees, the first time the result is called. */
  private once(end: () => void): () => void {
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      end();
      this.admit();
    };
  }

  /** Give out as many waiting turns as the foreground, and the limit, allow. */
  private admit(): void {
    while (
      this.foregroundLoads === 0 &&
      this.backgroundFiles < BACKGROUND_CONCURRENCY &&
      this.waiting.length > 0
    ) {
      this.waiting.shift()!();
    }
  }
}
