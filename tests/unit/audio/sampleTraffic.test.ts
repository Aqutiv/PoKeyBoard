import { describe, expect, it } from 'vitest';
import { BACKGROUND_CONCURRENCY, SampleTraffic } from '@/audio/sampleTraffic';

/** Ask for `count` background turns, noting each as it is given. */
function askForTurns(traffic: SampleTraffic, count: number) {
  const given: Array<() => void> = [];
  for (let i = 0; i < count; i += 1) void traffic.backgroundTurn().then((end) => given.push(end));
  return given;
}

/** Let every promise already settled run its callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('SampleTraffic', () => {
  it('gives the background two turns at once, and the next as one is given back', async () => {
    expect(BACKGROUND_CONCURRENCY).toBe(2);
    const traffic = new SampleTraffic();
    const given = askForTurns(traffic, 4);
    await settle();
    expect(given).toHaveLength(2);

    given[0]!();
    await settle();
    expect(given).toHaveLength(3);
  });

  it('gives no turn while a load someone waits for is under way, nor until the last one ends', async () => {
    const traffic = new SampleTraffic();
    const first = traffic.foreground();
    const second = traffic.foreground();
    const given = askForTurns(traffic, 3);
    await settle();
    expect(given).toHaveLength(0);

    first();
    await settle();
    expect(given).toHaveLength(0);
    second();
    await settle();
    expect(given).toHaveLength(2);
  });

  it('leaves the turns already given alone when the foreground starts, giving no more', async () => {
    const traffic = new SampleTraffic();
    const given = askForTurns(traffic, 3);
    await settle();
    expect(given).toHaveLength(2);

    // A file already under way may be what the foreground is waiting for.
    const end = traffic.foreground();
    given[0]!();
    given[1]!();
    await settle();
    expect(given).toHaveLength(2);
    end();
    await settle();
    expect(given).toHaveLength(3);
  });

  it('counts a turn, or a hold, once however often it is given back', async () => {
    const traffic = new SampleTraffic();
    const end = traffic.foreground();
    end();
    end();
    const given = askForTurns(traffic, 4);
    await settle();
    expect(given).toHaveLength(2);

    given[0]!();
    given[0]!();
    given[0]!();
    await settle();
    // One turn given back, so one more given out: not three.
    expect(given).toHaveLength(3);
    // A hold ended twice must not let the background run past a second one.
    const held = traffic.foreground();
    given[1]!();
    await settle();
    expect(given).toHaveLength(3);
    held();
    await settle();
    expect(given).toHaveLength(4);
  });
});
