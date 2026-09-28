import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/audio/AudioEngine';
import { pianoInstrument, type PianoInstrumentId } from '@/audio/instruments';

/** The packs of the two pianos switched between, as the registry names them. */
const SALAMANDER = pianoInstrument('salamander-grand').packVersion;
const HEADROOM = pianoInstrument('headroom-grand').packVersion;

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
 * A pack named in `pianissimo` also has a pianissimo C4 and C2 under them.
 */
const packs = vi.hoisted(() => ({
  holds: new Map<string, Gate>(),
  failures: new Set<string>(),
  decoded: [] as string[],
  sources: new WeakMap<ArrayBuffer, string>(),
  pianissimo: new Set<string>(),
}));

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function hold(key: string): Gate {
  const held = gate();
  packs.holds.set(key, held);
  return held;
}

function manifest(url: string) {
  const pianissimo = [...packs.pianissimo].some((pack) => url.includes(`/${pack}/`));
  const medium = pianissimo ? 1 : 0;
  const files = [
    { file: 'c4.sample', midi: 60, layer: medium, pack: 'core', bytes: 1 },
    { file: 'c2.sample', midi: 36, layer: medium, pack: 'full', bytes: 1 },
    { file: 'c7.sample', midi: 96, layer: medium, pack: 'full', bytes: 1 },
    ...(pianissimo
      ? [
          { file: 'c4pp.sample', midi: 60, layer: 0, pack: 'core', bytes: 1 },
          { file: 'c2pp.sample', midi: 36, layer: 0, pack: 'full', bytes: 1 },
        ]
      : []),
  ];
  return {
    version: `stub:${url}`,
    source: 'test',
    license: 'test',
    sourceUrl: 'test',
    format: 'test',
    velocityLayers: [
      ...(pianissimo ? [{ index: 0, sourceLayer: 2, label: 'pianissimo' }] : []),
      { index: medium, sourceLayer: 10, label: 'medium' },
    ],
    coreBytes: 1,
    totalBytes: files.length,
    files,
  };
}

/** Whether any decode so far came from a URL containing `path`. */
function decodedFrom(path: string): boolean {
  return packs.decoded.some((url) => url.includes(path));
}

/** Whether anything so far fetched a URL containing `path`. */
function fetchedFrom(path: string): boolean {
  return vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes(path));
}

/** Let every load that can move, move. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Cache Storage, as far as a download for offline use goes. A put waits on any
 * gate in `storing` whose key its URL contains, as one still committing a file
 * it has read would, whatever calls the download off meanwhile.
 */
function stubSampleCache(storing: ReadonlyMap<string, Gate> = new Map()): Map<string, unknown> {
  const stored = new Map<string, unknown>();
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (url: string) => stored.get(url),
      put: async (url: string, response: unknown) => {
        for (const [key, held] of storing) if (url.includes(key)) await held.promise;
        stored.set(url, response);
      },
    }),
  });
  return stored;
}

/**
 * Hold each fetch of a Headroom recording until it is answered, and reject it
 * the moment its signal calls it off.
 */
function holdHeadroomFetches() {
  const fetches = new Map<string, { answer: (status: number) => void; signal?: AbortSignal }>();
  const serve = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const file = String(url).split('/').pop()!;
    if (!String(url).includes(`/${HEADROOM}/`) || !file.endsWith('.sample')) {
      return serve(url, init);
    }
    const signal = init?.signal ?? undefined;
    const status = await new Promise<number>((resolve, reject) => {
      fetches.set(file, { answer: resolve, signal });
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
    return status === 200 ? serve(url, init) : ({ ok: false, status } as Response);
  });
  return {
    /** The files asked for so far, in the order they were. */
    started: () => [...fetches.keys()],
    answer: (file: string, status = 200) => fetches.get(file)!.answer(status),
    calledOff: (file: string) => fetches.get(file)!.signal?.aborted === true,
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
  packs.pianissimo.clear();
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
    const headroomCore = hold(`/${HEADROOM}/c4.sample`);

    const switching = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 62 } });
    // Chosen at once, so a take is stamped with it; heard once it is ready.
    expect(engine.activeInstrument.id).toBe('headroom-grand');
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(engine.isSwitching()).toBe(true);
    expect(engine.getSwitchState()).toEqual({
      sounding: 'salamander-grand',
      pending: 'headroom-grand',
      failed: null,
      progress: 0,
    });
    expect(packHeard(engine)).toBe(SALAMANDER);
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
    expect(packHeard(engine)).toBe(HEADROOM);
    expect(engine.isSwitching()).toBe(false);
    expect(engine.getLoadProgress().phase).toBe('core-ready');
    // The take's low C was decoded before the new piano took over.
    expect(bank(engine, 'headroom-grand').isFileLoaded('c2.sample')).toBe(true);
    // Nothing sounding was cut; only the old bank's own references are dropped.
    expect(allNotesOff).not.toHaveBeenCalled();
    expect(bank(engine, 'salamander-grand').isCoreReady()).toBe(false);
    await vi.waitFor(() => expect(settled).toBe(true));
  });

  it('reports how far the new piano has decoded, never running back', async () => {
    const engine = await playingEngine();
    const lowC = hold(`/${HEADROOM}/c2.sample`);
    const seen: number[] = [];
    engine.subscribeSwitch(() => seen.push(engine.getSwitchState().progress));

    // The core C4 and the take's C2 are one byte each.
    const switching = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 62 } });
    await vi.waitFor(() => expect(engine.getSwitchState().progress).toBe(0.5));
    // The keyboard reaches up to C7 meanwhile: there is more to do now, but the
    // ring holds where it was rather than running back to a third.
    await engine.ensurePlayableRange(90, 100);
    lowC.open();
    await switching;

    expect(Math.max(...seen)).toBe(1);
    const whileSwitching = seen.slice(0, seen.indexOf(1) + 1);
    expect(whileSwitching).toEqual([...whileSwitching].sort((a, b) => a - b));
    expect(engine.getSwitchState()).toEqual({
      sounding: 'headroom-grand',
      pending: null,
      failed: null,
      progress: 0,
    });
  });

  it('decodes a range the keyboard asks for while it waits, before taking over', async () => {
    const engine = await playingEngine();
    const lowC = hold(`/${HEADROOM}/c2.sample`);
    const switching = engine.setInstrument('headroom-grand', { cover: { low: 36, high: 60 } });
    await vi.waitFor(() => expect(decodesOf(HEADROOM)).toBe(2));

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
    const headroom = hold(`/${HEADROOM}/`);
    const salamanderDecodes = decodesOf(SALAMANDER);

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
    expect(decodesOf(SALAMANDER)).toBe(salamanderDecodes);
  });

  it('lets a newer choice overtake one still decoding, and frees both others after', async () => {
    const engine = await playingEngine();
    const headroom = hold(`/${HEADROOM}/`);

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
    packs.failures.add(`/${HEADROOM}/c4.sample`);
    const onSwitch = vi.fn();
    engine.subscribeSwitch(onSwitch);
    vi.useFakeTimers();

    const switching = engine.setInstrument('headroom-grand');
    // Past the bank's retries.
    await vi.advanceTimersByTimeAsync(2_000);
    await switching;
    expect(engine.soundingInstrument.id).toBe('salamander-grand');
    expect(engine.activeInstrument.id).toBe('salamander-grand');
    expect(engine.getSwitchState()).toEqual({
      sounding: 'salamander-grand',
      pending: null,
      failed: 'headroom-grand',
      progress: 0,
    });
    expect(onSwitch).toHaveBeenCalled();
    expect(engine.bank.isCoreReady()).toBe(true);
    expect(packHeard(engine)).toBe(SALAMANDER);
    // Its partial decode is not kept.
    expect(bank(engine, 'headroom-grand').getProgress().phase).toBe('idle');
  });
});

describe('changing piano with nothing playable to keep', () => {
  it('switches at once, as on the first load', async () => {
    hold(`/${SALAMANDER}/`);
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
    expect(packHeard(engine)).toBe(HEADROOM);
  });
});

describe('a piano’s pianissimo recordings', () => {
  it('load once the first piano plays, never holding it up', async () => {
    packs.pianissimo.add(SALAMANDER);
    const pianissimo = hold(`/${SALAMANDER}/c4pp.sample`);
    const engine = await playingEngine();
    // Ready with its core, the pianissimo C4 still decoding behind it.
    expect(engine.getLoadProgress().phase).toBe('core-ready');
    await vi.waitFor(() => expect(decodedFrom(`/${SALAMANDER}/c4pp.sample`)).toBe(true));
    expect(engine.bank.getSample(60, 0.2)?.standIn).toBe(true);
    pianissimo.open();
    await vi.waitFor(() => expect(engine.bank.getSample(60, 0.2)?.standIn).toBeUndefined());
  });

  it('are fetched by a new piano only once it takes over, never while it decodes for a switch', async () => {
    packs.pianissimo.add(HEADROOM);
    const engine = await playingEngine();
    const core = hold(`/${HEADROOM}/c4.sample`);

    const switching = engine.setInstrument('headroom-grand');
    await vi.waitFor(() => expect(decodedFrom(`/${HEADROOM}/c4.sample`)).toBe(true));
    // The old piano plays on while the new one decodes: nothing of the
    // new one's that the switch does not need, and it does not need these.
    expect(decodedFrom(`/${HEADROOM}/c4pp.sample`)).toBe(false);

    core.open();
    await switching;
    expect(engine.soundingInstrument.id).toBe('headroom-grand');
    await vi.waitFor(() => expect(decodedFrom(`/${HEADROOM}/c4pp.sample`)).toBe(true));
  });

  it('wait while a switch decodes the next piano, and go on once it is called off', async () => {
    packs.pianissimo.add(SALAMANDER);
    const engine = await playingEngine();
    await vi.waitFor(() => expect(decodedFrom(`/${SALAMANDER}/c4pp.sample`)).toBe(true));
    const headroomCore = hold(`/${HEADROOM}/c4.sample`);
    const abandoned = engine.setInstrument('headroom-grand');
    await vi.waitFor(() => expect(decodedFrom(`/${HEADROOM}/c4.sample`)).toBe(true));

    // The player reaches down to C2 on the piano still playing: its keys load
    // at once, and its pianissimo C2 waits for the piano being decoded.
    await engine.ensurePlayableRange(30, 40);
    expect(bank(engine, 'salamander-grand').isFileLoaded('c2.sample')).toBe(true);
    await settle();
    expect(fetchedFrom(`/${SALAMANDER}/c2pp.sample`)).toBe(false);

    // Called off, the switch holds nothing back.
    await engine.setInstrument('salamander-grand');
    await vi.waitFor(() => expect(decodedFrom(`/${SALAMANDER}/c2pp.sample`)).toBe(true));
    headroomCore.open();
    await abandoned;
  });

  it('wait while a piano downloads for offline use', async () => {
    packs.pianissimo.add(SALAMANDER);
    const stored = stubSampleCache();
    // Headroom's recordings download only once let go.
    let letGo!: () => void;
    const downloadHeld = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const serve = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).includes(`/${HEADROOM}/c`)) await downloadHeld;
      return serve(url, init);
    });

    const core = hold(`/${SALAMANDER}/c4.sample`);
    const engine = new AudioEngine();
    engine.markInstrumentRestored();
    engine.initialize();
    const downloading = engine.downloadFullSamplePack('headroom-grand');
    await vi.waitFor(() => expect(fetchedFrom(`/${HEADROOM}/c4.sample`)).toBe(true));
    core.open();
    await vi.waitFor(() => expect(engine.bank.isCoreReady()).toBe(true));
    await settle();
    // Ready to play, with its pianissimo C4 waiting for the download.
    expect(fetchedFrom(`/${SALAMANDER}/c4pp.sample`)).toBe(false);

    letGo();
    await downloading;
    expect(stored.size).toBe(3);
    await vi.waitFor(() => expect(decodedFrom(`/${SALAMANDER}/c4pp.sample`)).toBe(true));
  });
});

describe('downloading a piano for offline use', () => {
  it('fetches four recordings at a time, adding each one’s bytes as it is stored', async () => {
    // Five recordings of a byte each: C4, C2, C7, and a pianissimo C4 and C2.
    packs.pianissimo.add(HEADROOM);
    const stored = stubSampleCache();
    const fetches = holdHeadroomFetches();
    const progress: Array<[number, number]> = [];
    const downloading = new AudioEngine().downloadFullSamplePack(
      'headroom-grand',
      (loaded, total) => progress.push([loaded, total]),
    );

    await vi.waitFor(() => expect(fetches.started()).toHaveLength(4));
    await settle();
    // Four on their way at once, and the fifth waiting for one of them.
    expect(fetches.started()).toEqual(['c4.sample', 'c2.sample', 'c7.sample', 'c4pp.sample']);
    fetches.answer('c7.sample');
    await vi.waitFor(() => expect(fetches.started()).toContain('c2pp.sample'));
    expect(progress).toEqual([[1, 5]]);

    // Each counts as it is stored, in whatever order they come back.
    for (const file of ['c2pp.sample', 'c4.sample', 'c4pp.sample', 'c2.sample']) {
      fetches.answer(file);
    }
    await downloading;
    expect(progress).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(stored.size).toBe(5);
  });

  it('counts the recordings already stored, without fetching them again', async () => {
    const stored = stubSampleCache();
    const engine = new AudioEngine();
    const earlier = engine.bankFor('headroom-grand').urlFor('c4.sample');
    stored.set(earlier, 'stored earlier');
    const progress: number[] = [];

    await engine.downloadFullSamplePack('headroom-grand', (loaded) => progress.push(loaded));
    expect(fetchedFrom(`/${HEADROOM}/c4.sample`)).toBe(false);
    expect(fetchedFrom(`/${HEADROOM}/c2.sample`)).toBe(true);
    expect(stored.get(earlier)).toBe('stored earlier');
    expect(progress).toEqual([1, 2, 3]);
  });

  it('stops at the first recording that fails, once those it calls off have stopped', async () => {
    packs.pianissimo.add(HEADROOM);
    // The C4 comes back first, and is still being stored when the C2 fails.
    const storingC4 = gate();
    const stored = stubSampleCache(new Map([[`/${HEADROOM}/c4.sample`, storingC4]]));
    const fetches = holdHeadroomFetches();
    const engine = new AudioEngine();
    const progress: number[] = [];
    let outcome: unknown;
    void engine
      .downloadFullSamplePack('headroom-grand', (loaded) => progress.push(loaded))
      .then(
        () => (outcome = 'stored'),
        (error: unknown) => (outcome = error),
      );
    await vi.waitFor(() => expect(fetches.started()).toHaveLength(4));
    fetches.answer('c4.sample');
    await settle();

    fetches.answer('c2.sample', 404);
    await settle();
    // Those still on their way are called off, and the fifth never starts.
    expect(['c7.sample', 'c4pp.sample'].map(fetches.calledOff)).toEqual([true, true]);
    expect(fetches.started()).not.toContain('c2pp.sample');
    // The download is not over while the C4 is still being stored.
    expect(outcome).toBeUndefined();

    storingC4.open();
    await vi.waitFor(() => expect(outcome).toBeInstanceOf(Error));
    expect((outcome as Error).message).toBe('Sample download failed (404) for c2.sample');
    // Stored, but after the download failed: nothing counts it, and it stays.
    expect(progress).toEqual([]);
    expect([...stored.keys()]).toEqual([engine.bankFor('headroom-grand').urlFor('c4.sample')]);
  });
});
