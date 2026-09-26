import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/audio/AudioEngine';
import type { PianoInstrumentId } from '@/audio/instruments';

vi.mock('@/audio/PianoGraphFactory', () => ({
  createPianoGraph: () => ({
    voiceDestination: {},
    outputDestination: {},
    setMasterVolume: () => undefined,
    setReverbMix: () => undefined,
    setReverbRoom: () => undefined,
    dispose: () => undefined,
  }),
}));

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

/**
 * Real banks over fake bytes: every pack lists a core C4 and two optional
 * roots, C2 and C7, and a decode waits on any gate whose key its URL contains.
 */
const packs = vi.hoisted(() => ({
  holds: new Map<string, Gate>(),
  failures: new Set<string>(),
  decoded: [] as string[],
  sources: new WeakMap<ArrayBuffer, string>(),
}));

function hold(key: string): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  const gate = { promise, open };
  packs.holds.set(key, gate);
  return gate;
}

function manifest(url: string) {
  return {
    version: `stub:${url}`,
    source: 'test',
    license: 'test',
    sourceUrl: 'test',
    format: 'test',
    velocityLayers: [{ index: 0, sourceLayer: 1, label: 'test' }],
    coreBytes: 1,
    totalBytes: 3,
    files: [
      { file: 'c4.sample', midi: 60, layer: 0, pack: 'core', bytes: 1 },
      { file: 'c2.sample', midi: 36, layer: 0, pack: 'full', bytes: 1 },
      { file: 'c7.sample', midi: 96, layer: 0, pack: 'full', bytes: 1 },
    ],
  };
}

class FakeAudioContext {
  readonly state = 'suspended';
  readonly currentTime = 0;
  readonly sampleRate = 48_000;
  addEventListener(): void {}
  async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const url = packs.sources.get(bytes) ?? '';
    packs.decoded.push(url);
    for (const [key, gate] of packs.holds) if (url.includes(key)) await gate.promise;
    for (const key of packs.failures) if (url.includes(key)) throw new Error(`corrupt ${url}`);
    return {
      url,
      duration: 1,
      length: 0,
      sampleRate: 48_000,
      numberOfChannels: 0,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer;
  }
}

/** Which recording a note would sound, by the pack directory it came from. */
function packHeard(engine: AudioEngine): string | undefined {
  const buffer = engine.bank.getSample(60, 0.7)?.buffer as { url?: string } | undefined;
  return /\/([^/]+)\/c4\.sample$/.exec(buffer?.url ?? '')?.[1];
}

function decodesOf(pack: string): number {
  return packs.decoded.filter((url) => url.includes(`/${pack}/`)).length;
}

/** An engine with a context, playing its default piano (Salamander). */
async function playingEngine(): Promise<AudioEngine> {
  const engine = new AudioEngine();
  engine.markInstrumentRestored();
  engine.initialize();
  await vi.waitFor(() => expect(engine.bank.isCoreReady()).toBe(true));
  return engine;
}

function bank(engine: AudioEngine, id: PianoInstrumentId) {
  return engine.bankFor(id);
}

beforeEach(() => {
  packs.holds.clear();
  packs.failures.clear();
  packs.decoded = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest(url) };
      const bytes = new ArrayBuffer(8);
      packs.sources.set(bytes, url);
      return { ok: true, arrayBuffer: async () => bytes };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('changing piano while one is playing', () => {
  it('plays the old piano until the new one is decoded, then hands over without a cut', async () => {
    const engine = await playingEngine();
    const allNotesOff = vi.spyOn(engine, 'allNotesOff');
    const headroomCore = hold('/headroom-grand-v2/c4.sample');

    const switching = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 62 } });
    // Chosen at once, so a take is stamped with it; heard once it is ready.
    expect(engine.activeInstrument.id).toBe('headroom-grand');
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(engine.isSwitching()).toBe(true);
    expect(engine.getSwitchState()).toEqual({ pending: 'headroom-grand', failed: null });
    expect(packHeard(engine)).toBe('salamander-grand-v3');
    // What the page reports is the piano playing, which is ready.
    expect(engine.getLoadProgress().phase).toBe('core-ready');

    let settled = false;
    void engine.whenSwitchSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    headroomCore.open();
    await switching;
    expect(engine.soundingInstrument.id).toBe('headroom-grand');
    expect(packHeard(engine)).toBe('headroom-grand-v2');
    expect(engine.isSwitching()).toBe(false);
    expect(engine.getLoadProgress().phase).toBe('core-ready');
    // The take's low C was decoded before the new piano took over.
    expect(bank(engine, 'headroom-grand').isFileLoaded('c2.sample')).toBe(true);
    // Nothing sounding was cut; only the old bank's own references are dropped.
    expect(allNotesOff).not.toHaveBeenCalled();
    expect(bank(engine, 'salamander-grand').isCoreReady()).toBe(false);
    await vi.waitFor(() => expect(settled).toBe(true));
  });

  it('decodes a range the keyboard asks for while it waits, before taking over', async () => {
    const engine = await playingEngine();
    const lowC = hold('/headroom-grand-v2/c2.sample');
    const switching = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 60 } });
    await vi.waitFor(() => expect(decodesOf('headroom-grand-v2')).toBe(2));

    // The keyboard slides up while the take's low C is still decoding.
    await engine.ensurePlayableRange(90, 100);
    expect(bank(engine, 'salamander-grand').isFileLoaded('c7.sample')).toBe(true);
    expect(engine.soundingInstrument.id).toBe('salamander-grand');

    lowC.open();
    await switching;
    expect(engine.soundingInstrument.id).toBe('headroom-grand');
    expect(bank(engine, 'headroom-grand').isFileLoaded('c7.sample')).toBe(true);
  });

  it('widens the switch under way when another caller names the same piano', async () => {
    const engine = await playingEngine();
    // Persistence asks first, knowing nothing of the take; the transport adds it.
    const first = engine.setInstrument('headroom-grand');
    const second = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 40 } });
    expect(second).toBe(first);
    await first;
    expect(bank(engine, 'headroom-grand').isFileLoaded('c2.sample')).toBe(true);
  });

  it('calls off a switch when the playing piano is chosen again, decoding nothing twice', async () => {
    const engine = await playingEngine();
    const headroom = hold('/headroom-grand-v2/');
    const salamanderDecodes = decodesOf('salamander-grand-v3');

    const abandoned = engine.setInstrument('headroom-grand');
    await engine.setInstrument('salamander-grand');
    expect(engine.isSwitching()).toBe(false);
    expect(engine.activeInstrument.id).toBe('salamander-grand');
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(engine.bank.isCoreReady()).toBe(true);

    headroom.open();
    await abandoned;
    // The switch called off never takes over, and leaves nothing decoded.
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(bank(engine, 'headroom-grand').isCoreReady()).toBe(false);
    expect(bank(engine, 'headroom-grand').getProgress().error).toBeUndefined();
    expect(decodesOf('salamander-grand-v3')).toBe(salamanderDecodes);
  });

  it('lets a newer choice overtake one still decoding, and frees both others after', async () => {
    const engine = await playingEngine();
    const headroom = hold('/headroom-grand-v2/');

    const overtaken = engine.setInstrument('headroom-grand');
    await engine.setInstrument('bitklavier-grand');
    expect(engine.soundingInstrument.id).toBe('bitklavier-grand');
    expect(bank(engine, 'salamander-grand').isCoreReady()).toBe(false);

    headroom.open();
    await overtaken;
    expect(engine.soundingInstrument.id).toBe('bitklavier-grand');
    expect(bank(engine, 'headroom-grand').isCoreReady()).toBe(false);
  });

  it('plays on with the old piano, and chooses it again, when the new one cannot load', async () => {
    const engine = await playingEngine();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    packs.failures.add('/headroom-grand-v2/c4.sample');
    const onSwitch = vi.fn();
    engine.subscribeSwitch(onSwitch);
    vi.useFakeTimers();

    const switching = engine.setInstrument('headroom-grand');
    // Past the bank's retries.
    await vi.advanceTimersByTimeAsync(2_000);
    await switching;
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(engine.activeInstrument.id).toBe('salamander-grand');
    expect(engine.getSwitchState()).toEqual({ pending: null, failed: 'headroom-grand' });
    expect(onSwitch).toHaveBeenCalled();
    expect(engine.bank.isCoreReady()).toBe(true);
    expect(packHeard(engine)).toBe('salamander-grand-v3');
    // Its partial decode is not kept.
    expect(bank(engine, 'headroom-grand').getProgress().phase).toBe('idle');
  });
});

describe('changing piano with nothing playable to keep', () => {
  it('switches at once, as on the first load', async () => {
    hold('/salamander-grand-v3/');
    const engine = new AudioEngine();
    engine.markInstrumentRestored();
    engine.initialize();
    const allNotesOff = vi.spyOn(engine, 'allNotesOff');

    const switching = engine.setInstrument('headroom-grand');
    expect(engine.soundingInstrument.id).toBe('headroom-grand');
    expect(engine.isSwitching()).toBe(false);
    expect(allNotesOff).toHaveBeenCalled();
    await switching;
    expect(engine.bank.isCoreReady()).toBe(true);
    expect(packHeard(engine)).toBe('headroom-grand-v2');
  });
});
