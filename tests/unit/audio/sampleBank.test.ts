import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SamplePackFileEntry, SamplePackManifest } from '@/audio/audioTypes';
import { onsetOffsetOf, SampleBank } from '@/audio/SampleBank';
import { velocityGain } from '@/audio/velocityLayers';

/** Two channels of silence with a note starting at `onsetS` — enough AudioBuffer for the scan. */
function recording(onsetS: number, rate = 48_000): AudioBuffer {
  const length = rate;
  const channels = [new Float32Array(length), new Float32Array(length)];
  const onset = Math.round(onsetS * rate);
  for (const data of channels) {
    // A little noise floor, 60 dB down, then a decaying strike.
    for (let i = 0; i < onset; i += 1) data[i] = (i % 2 === 0 ? 1 : -1) * 0.0008;
    for (let i = onset; i < length; i += 1) data[i] = 0.8 * Math.exp(-(i - onset) / rate / 0.3);
  }
  return {
    sampleRate: rate,
    length,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel]!,
  } as unknown as AudioBuffer;
}

describe('onsetOffsetOf', () => {
  it('skips the silence before the note, keeping a millisecond of it', () => {
    expect(onsetOffsetOf(recording(0.012))).toBeCloseTo(0.011, 3);
  });

  it('leaves a recording that starts on its note alone', () => {
    expect(onsetOffsetOf(recording(0))).toBe(0);
  });

  it('never trims more than a recording could plausibly need', () => {
    expect(onsetOffsetOf(recording(0.2))).toBe(0.05);
  });

  it('leaves a silent file alone rather than guessing', () => {
    const silent = {
      sampleRate: 48_000,
      length: 480,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(480),
    } as unknown as AudioBuffer;
    expect(onsetOffsetOf(silent)).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * A pack of soft, medium and loud with only its soft recording of middle C,
 * and no calibration (its version has none), so it plays by the fallback.
 */
function stubManifest(levelMatch?: number) {
  const soft = { index: 0, sourceLayer: 5, label: 'soft', ...(levelMatch ? { levelMatch } : {}) };
  return {
    version: 'test',
    source: 'test',
    license: 'test',
    sourceUrl: 'test',
    format: 'test',
    velocityLayers: [
      soft,
      { index: 1, sourceLayer: 10, label: 'medium' },
      { index: 2, sourceLayer: 15, label: 'loud' },
    ],
    coreBytes: 100,
    totalBytes: 100,
    files: [{ file: 'c4.sample', midi: 60, layer: 0, pack: 'core' as const, bytes: 100 }],
  };
}

function stubContext(): BaseAudioContext {
  return {
    decodeAudioData: vi.fn(async () => ({ duration: 1 }) as AudioBuffer),
  } as unknown as BaseAudioContext;
}

async function loadedBank(levelMatch?: number): Promise<SampleBank> {
  const manifest = stubManifest(levelMatch);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
  );
  const bank = new SampleBank('/samples/');
  await bank.loadCorePack(stubContext());
  return bank;
}

// The stub manifest's version has no calibration, so it plays by the fallback.
describe('a pack level match, where there is no calibration', () => {
  it('scales the voice gain past velocityGain’s own ceiling', async () => {
    const plain = await loadedBank();
    const base = plain.getSample(60, 0.9)?.gain;
    expect(base).toBeCloseTo(velocityGain(0.9, 'loud'), 10);

    vi.unstubAllGlobals();
    const lifted = await loadedBank(5.3114);
    // velocityGain clamps at 1.7, so a quietly mastered pack can only be
    // brought up to the reference level outside that clamp.
    expect(lifted.getSample(60, 0.9)?.gain).toBeCloseTo((base as number) * 5.3114, 10);
  });

  it('uses the resolved layer’s correction, not the requested one', async () => {
    // Only the soft layer is loaded, so a loud note falls back to it and must
    // take the soft layer's level match with it.
    const bank = await loadedBank(5.3114);
    expect(bank.getSample(60, 0.9)?.gain).toBeCloseTo(velocityGain(0.9, 'loud') * 5.3114, 10);
  });

  it('defaults to no correction for a manifest that predates the measurement', async () => {
    const bank = await loadedBank();
    expect(bank.getSample(60, 0.5)?.gain).toBeCloseTo(velocityGain(0.5, 'medium'), 10);
  });
});

describe('SampleBank.releaseBuffers', () => {
  it('frees the decoded audio and can reload afterwards', async () => {
    const bank = await loadedBank();
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.isMidiPlayable(60)).toBe(true);
    expect(bank.getProgress().loadedBytes).toBe(100);

    bank.releaseBuffers();
    expect(bank.isCoreReady()).toBe(false);
    expect(bank.isMidiPlayable(60)).toBe(false);
    expect(bank.getSample(60, 0.7)).toBeNull();
    expect(bank.getProgress().phase).toBe('idle');
    expect(bank.getProgress().loadedBytes).toBe(0);

    // The manifest is kept, so recovery re-decodes without refetching it.
    await bank.loadCorePack(stubContext());
    expect(bank.isCoreReady()).toBe(true);
  });

  it('discards a decode that lands after the release', async () => {
    const manifest = stubManifest();
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(1));
    bank.releaseBuffers();
    decodes[0]?.({ duration: 1 } as AudioBuffer);

    // The buffer that arrived is dropped. A load called off like this — a piano
    // switch overtaken by another — is no failure, so it reports none.
    await expect(loading).resolves.toBeUndefined();
    expect(bank.isMidiPlayable(60)).toBe(false);
    expect(bank.isCoreReady()).toBe(false);
    expect(bank.getProgress().phase).toBe('idle');
    expect(bank.getProgress().error).toBeUndefined();
  });

  it('stops a released load before the files still queued, which would keep what they decode', async () => {
    const manifest = {
      ...stubManifest(),
      // More files than the bank fetches at once, so some wait in the queue.
      files: [48, 51, 54, 57, 60, 63, 66, 69].map((midi) => ({
        file: `m${midi}.sample`,
        midi,
        layer: 0,
        pack: 'core' as const,
        bytes: 1,
      })),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    vi.stubGlobal('fetch', fetchMock);
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(4));
    bank.releaseBuffers();
    for (const decode of decodes) decode({ duration: 1 } as AudioBuffer);
    await loading;

    // The manifest and the four under way; the four queued are never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(bank.getProgress().loadedFiles).toBe(0);
    expect(bank.isMidiPlayable(60)).toBe(false);
  });

  it('stops retrying a file once released, where a retry would only be discarded', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => stubManifest() })
      .mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(stubContext());
    // The manifest, then the first try at the one file, which fails.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    bank.releaseBuffers();
    await vi.advanceTimersByTimeAsync(5_000);
    await loading;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bank.getProgress().phase).toBe('idle');
    expect(bank.getProgress().error).toBeUndefined();
  });

  it('does not decode a download that lands after the release', async () => {
    let land!: () => void;
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => stubManifest() })
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => {
          await landed;
          return new ArrayBuffer(16);
        },
      });
    vi.stubGlobal('fetch', fetchMock);
    const context = stubContext();
    const bank = new SampleBank('/samples/');

    const loading = bank.loadCorePack(context);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    bank.releaseBuffers();
    land();
    await loading;
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('decodes afresh for a load that starts after the release, not waiting on the dropped one', async () => {
    const manifest = stubManifest();
    const decodes: Array<(buffer: AudioBuffer) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise<AudioBuffer>((resolve) => {
            decodes.push(resolve);
          }),
      ),
    } as unknown as BaseAudioContext;
    const bank = new SampleBank('/samples/');

    // Chosen, called off, and chosen again before the first decode lands.
    const first = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(1));
    bank.releaseBuffers();
    const second = bank.loadCorePack(context);
    await vi.waitFor(() => expect(decodes).toHaveLength(2));

    decodes[0]?.({ duration: 1 } as AudioBuffer);
    await first;
    expect(bank.isCoreReady()).toBe(false);
    decodes[1]?.({ duration: 1 } as AudioBuffer);
    await second;
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.getProgress().phase).toBe('core-ready');
  });
});

describe('SampleBank progress', () => {
  it('counts the core pack apart from the extras loaded on demand', async () => {
    const manifest = {
      ...stubManifest(),
      coreBytes: 100,
      totalBytes: 400,
      files: [
        { file: 'c4.sample', midi: 60, layer: 0, pack: 'core' as const, bytes: 100 },
        { file: 'c2.sample', midi: 36, layer: 0, pack: 'full' as const, bytes: 300 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    );
    const bank = new SampleBank('/samples/');
    const context = stubContext();

    await bank.loadCorePack(context);
    // Readiness waits on the core alone, so a loading readout has to count the
    // core alone — counted against the whole pack it stalled at a fraction.
    expect(bank.getProgress()).toMatchObject({
      phase: 'core-ready',
      coreLoadedBytes: 100,
      coreTotalBytes: 100,
      loadedBytes: 100,
      totalBytes: 400,
    });

    await bank.ensureRangeLoaded(context, 36, 36);
    expect(bank.getProgress()).toMatchObject({
      coreLoadedBytes: 100,
      coreTotalBytes: 100,
      loadedBytes: 400,
    });

    bank.releaseBuffers();
    expect(bank.getProgress()).toMatchObject({ coreLoadedBytes: 0, coreTotalBytes: 100 });
  });
});

/**
 * A grand of four layers — pianissimo, soft, medium and loud — at the roots
 * listed, every file core, and no calibration, so it plays by the fallback.
 */
function fourLayerManifest(roots = [60]): SamplePackManifest {
  const labels = ['pianissimo', 'soft', 'medium', 'loud'];
  const files: SamplePackFileEntry[] = roots.flatMap((midi) =>
    labels.map((label, layer) => ({
      file: `${label}-${midi}.sample`,
      midi,
      layer,
      pack: 'core' as const,
      bytes: 10 * (layer + 1),
    })),
  );
  const bytes = files.reduce((total, entry) => total + entry.bytes, 0);
  return {
    version: 'four-layer-test',
    source: 'test',
    license: 'test',
    sourceUrl: 'test',
    format: 'test',
    velocityLayers: labels.map((label, index) => ({ index, sourceLayer: index + 1, label })),
    coreBytes: bytes,
    totalBytes: bytes,
    files,
  };
}

/**
 * Serve a manifest and its files, each decoding to a buffer that names the
 * file it came from; `failing` files answer 503. Returns the files fetched.
 */
function servePack(manifest: SamplePackManifest, failing: readonly string[] = []) {
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
      const file = url.slice(url.lastIndexOf('/') + 1);
      fetched.push(file);
      if (failing.includes(file)) return { ok: false, status: 503 };
      return { ok: true, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { file }) };
    }),
  );
  const context = {
    decodeAudioData: vi.fn(
      async (bytes: ArrayBuffer & { file: string }) =>
        ({ duration: 1, file: bytes.file }) as unknown as AudioBuffer,
    ),
  } as unknown as BaseAudioContext;
  return { fetched, context };
}

/** The file a selection's recording was decoded from. */
function fileOf(selection: { buffer: AudioBuffer } | null): string | undefined {
  return (selection?.buffer as unknown as { file?: string } | undefined)?.file;
}

describe('a pack with a pianissimo layer', () => {
  it('plays the layer each velocity asks for: pianissimo under 0.30, then soft, medium, loud', async () => {
    const { context } = servePack(fourLayerManifest());
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    await bank.loadDeferred(context);
    expect(fileOf(bank.getSample(60, 0.2))).toBe('pianissimo-60.sample');
    expect(fileOf(bank.getSample(60, 0.3))).toBe('soft-60.sample');
    expect(fileOf(bank.getSample(60, 0.6))).toBe('medium-60.sample');
    expect(fileOf(bank.getSample(60, 0.9))).toBe('loud-60.sample');
    expect(bank.getSample(60, 0.2)?.standIn).toBeUndefined();
  });

  it('is ready without its pianissimo recordings, which only load once asked for', async () => {
    const { context, fetched } = servePack(fourLayerManifest());
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.getProgress().phase).toBe('core-ready');
    expect(fetched).not.toContain('pianissimo-60.sample');
    // Until then the soft recording stands in, and says so.
    const standIn = bank.getSample(60, 0.2);
    expect(fileOf(standIn)).toBe('soft-60.sample');
    expect(standIn?.standIn).toBe(true);

    await bank.loadDeferred(context);
    expect(fetched).toContain('pianissimo-60.sample');
    expect(fileOf(bank.getSample(60, 0.2))).toBe('pianissimo-60.sample');
  });

  it('counts neither toward readiness nor toward a switch’s progress', async () => {
    const { context } = servePack(fourLayerManifest());
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    // Soft 20, medium 30 and loud 40 bytes; the pianissimo file's 10 are no part of it.
    expect(bank.getProgress()).toMatchObject({ coreLoadedBytes: 90, coreTotalBytes: 90 });
    expect(bank.bytesFor(null)).toBe(90);
    await bank.loadDeferred(context);
    expect(bank.getProgress()).toMatchObject({ coreLoadedBytes: 90, loadedBytes: 90 });
    expect(bank.getProgress().loadedFiles).toBe(4);
  });

  it('keeps the piano ready while a range load has only pianissimo recordings left to fetch', async () => {
    const { context, fetched } = servePack(fourLayerManifest([60, 63]));
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    const phases: string[] = [];
    bank.subscribe((progress) => phases.push(progress.phase));
    await bank.ensureRangeLoaded(context, 60, 63);
    expect(phases.every((phase) => phase === 'core-ready')).toBe(true);
    // A piano not yet sounding — decoding for a switch — fetches none.
    expect(fetched.filter((file) => file.startsWith('pianissimo'))).toEqual([]);
  });

  it('fetches a range’s pianissimo recordings behind it, once it is the piano that sounds', async () => {
    const manifest = fourLayerManifest([60, 99]);
    manifest.files = manifest.files.map((entry) =>
      entry.midi === 99 ? { ...entry, pack: 'full' as const } : entry,
    );
    const { context, fetched } = servePack(manifest);
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    await bank.loadDeferred(context);
    await bank.ensureRangeLoaded(context, 99, 99);
    await vi.waitFor(() => expect(fetched).toContain('pianissimo-99.sample'));
    await vi.waitFor(() => expect(fileOf(bank.getSample(99, 0.2))).toBe('pianissimo-99.sample'));
  });

  it('plays a pianissimo recording only on its own root, not one pitched from further off', async () => {
    const { context } = servePack(fourLayerManifest([57, 60]), ['pianissimo-60.sample']);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    await bank.loadDeferred(context);
    expect(fileOf(bank.getSample(57, 0.2))).toBe('pianissimo-57.sample');
    // Middle C's own could not be had: its soft recording plays, at pitch,
    // rather than A3's pianissimo three semitones up.
    const middleC = bank.getSample(60, 0.2);
    expect(fileOf(middleC)).toBe('soft-60.sample');
    expect(middleC?.playbackRate).toBe(1);
    expect(middleC?.standIn).toBe(true);
  });

  it('leaves no error behind when a pianissimo recording cannot be fetched', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { context } = servePack(fourLayerManifest(), ['pianissimo-60.sample']);
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    const deferred = bank.loadDeferred(context);
    await vi.runAllTimersAsync();
    await expect(deferred).resolves.toBeUndefined();
    // Offline with the three layers saved from before, say: no error to show.
    expect(bank.getProgress().phase).toBe('core-ready');
    expect(bank.getProgress().error).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(bank.getSample(60, 0.2)?.standIn).toBe(true);
  });

  it('waits for just the pianissimo recordings an export’s notes ask for', async () => {
    const { context, fetched } = servePack(fourLayerManifest([57, 60, 63]));
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    // A loud note wants no pianissimo; a soft one wants its own root's.
    await bank.loadRecordingsFor(context, [
      { midi: 57, velocity: 0.9 },
      { midi: 61, velocity: 0.15 },
    ]);
    expect(fetched.filter((file) => file.startsWith('pianissimo'))).toEqual([
      'pianissimo-60.sample',
    ]);
    expect(fileOf(bank.getSample(61, 0.15))).toBe('pianissimo-60.sample');
  });

  it('stops fetching pianissimo recordings once released, until it sounds again', async () => {
    const { context, fetched } = servePack(fourLayerManifest([60, 63]));
    const bank = new SampleBank('/samples/');
    await bank.loadCorePack(context);
    await bank.loadDeferred(context);
    bank.releaseBuffers();
    fetched.length = 0;
    await bank.loadCorePack(context);
    await bank.ensureRangeLoaded(context, 60, 63);
    expect(fetched.filter((file) => file.startsWith('pianissimo'))).toEqual([]);
  });
});

describe('a manifest the bank cannot play by', () => {
  it('is refused with an error the player sees, never left loading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const manifest = {
      ...stubManifest(),
      velocityLayers: [{ index: 0, sourceLayer: 1, label: 'fortissimo' }],
    };
    servePack(manifest as SamplePackManifest);
    const bank = new SampleBank('/samples/');
    await expect(bank.loadCorePack(stubContext())).rejects.toThrow(/fortissimo/);
    expect(bank.getProgress().phase).toBe('error');
    expect(bank.getProgress().error).toBeDefined();
  });
});

describe('SampleBank.urlFor', () => {
  it('reaches a file another pack published, by a path relative to its own', () => {
    // A pack's manifest can list files of the pack it extends; the browser, its
    // service worker and the Cache API all see the other pack's own URL.
    const url = new SampleBank('/piano/salamander-grand-v4/').urlFor(
      '../salamander-grand-v3/C4v5.sample',
    );
    expect(new URL(url, 'https://example.com').pathname).toBe(
      '/piano/salamander-grand-v3/C4v5.sample',
    );
  });
});

describe('SampleBank retries', () => {
  it('rejects an incomplete core load and can retry while retaining progress', async () => {
    vi.useFakeTimers();
    const manifest = stubManifest();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const context = stubContext();
    const bank = new SampleBank('/samples/');

    const failed = bank.loadCorePack(context);
    const failedAssertion = expect(failed).rejects.toThrow(/could not be loaded/);
    await vi.runAllTimersAsync();
    await failedAssertion;
    expect(bank.getProgress().phase).toBe('error');

    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    await bank.loadCorePack(context);
    expect(bank.isCoreReady()).toBe(true);
    expect(bank.getProgress().phase).toBe('core-ready');
  });
});
