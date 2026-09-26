import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { expect, test } from './fixtures';
import type { SamplePackManifest } from '../../src/audio/audioTypes';
import { pianoInstrument } from '../../src/audio/instruments';
import { velocityGain, velocityToLayer } from '../../src/audio/SampleBank';

/**
 * The only spec that measures actual audio. Node has no Web Audio and the
 * preview build exports nothing to `window`, so the real modules — the graph,
 * the export's loudness constants and the metronome's click — are bundled here
 * and injected into the page, where they are driven by an OfflineAudioContext.
 * That way the assertions are about the shipped code, not about a
 * reimplementation of it.
 */

const LOUD_VELOCITY = 1;
/** A pedalled fortissimo chord — two hands plus sustained overtones. */
const VOICE_COUNT = 12;
/** MetronomeEngine's accent click peak × the default metronome volume. */
const METRONOME_PEAK = 0.6;
/** The default metronome volume (MetronomeEngine's own default config). */
const METRONOME_VOLUME = 0.6;

/**
 * The worst-case per-voice gain the app can produce: SampleBank multiplies
 * velocityGain by the layer's levelMatch *outside* velocityGain's own clamp, and
 * headroom-grand's loud layer carries the largest of any pack, about 2 in all.
 * The match is read per layer, where the manifest keeps it and where SampleBank
 * reads it (`levelMatchFor`).
 */
function worstCaseVoiceGain(): number {
  const packDir = pianoInstrument('headroom-grand').path.replace(/\/$/, '');
  const manifest = JSON.parse(
    readFileSync(path.resolve('public', packDir, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest;
  const layer = velocityToLayer(LOUD_VELOCITY);
  const levelMatch = manifest.velocityLayers.find((entry) => entry.index === layer)?.levelMatch;
  if (levelMatch === undefined) throw new Error('headroom-grand has lost its loud levelMatch');
  return velocityGain(LOUD_VELOCITY, layer) * levelMatch;
}

/** The bundled modules, as the page sees them. */
interface Modules {
  PianoGraph: typeof import('../../src/audio/PianoGraphFactory');
  Loudness: typeof import('../../src/audio/loudness');
  Metronome: typeof import('../../src/audio/MetronomeEngine');
}

/** IIFE bundle of one real module, exposed as `window[name]`. */
async function bundleModule(entry: string, name: keyof Modules): Promise<string> {
  const result = (await build({
    logLevel: 'silent',
    configFile: false,
    resolve: { alias: { '@': path.resolve('src') } },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve(entry),
        formats: ['iife'],
        name,
        fileName: () => `${name}.js`,
      },
    },
  })) as unknown as Array<{ output: Array<{ code?: string }> }>;
  const code = result[0]?.output[0]?.code;
  if (!code) throw new Error(`could not bundle ${entry}`);
  return code;
}

interface RenderInput {
  voiceGain: number;
  voiceCount: number;
  metronomePeak: number;
  masterVolume: number;
  reverbMix: number;
  /** When the chord and the click land, in seconds; 0.25 unless said otherwise. */
  onsetS?: number;
}

/**
 * Renders the worst case through the real graph and returns the output peak.
 * Voices are full-scale sines at slightly detuned frequencies so their peaks
 * drift in and out of phase — the same transient pile-up a dense chord makes,
 * without needing the sample pack decoded.
 */
async function renderPeak(
  page: import('@playwright/test').Page,
  input: RenderInput,
): Promise<number> {
  return page.evaluate(async (options: RenderInput) => {
    const factory = (window as unknown as Modules).PianoGraph;
    const sampleRate = 48000;
    const onset = options.onsetS ?? 0.25;
    const context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: Math.round(sampleRate * (onset + 1.75)),
      sampleRate,
    });
    const graph = factory.createPianoGraph(context, {
      masterVolume: options.masterVolume,
      reverbMix: options.reverbMix,
    });

    const makeTone = (frequency: number) => {
      const buffer = context.createBuffer(2, sampleRate, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) {
          // Decaying tone, like a struck string: full scale at the onset.
          const envelope = Math.exp((-3 * i) / data.length);
          data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * envelope;
        }
      }
      return buffer;
    };

    for (let voice = 0; voice < options.voiceCount; voice += 1) {
      const source = context.createBufferSource();
      source.buffer = makeTone(110 * Math.pow(2, voice / 12));
      const gain = context.createGain();
      gain.gain.value = options.voiceGain;
      source.connect(gain);
      gain.connect(graph.voiceDestination);
      source.start(onset);
    }

    // The metronome accent lands on the same instant as the chord.
    const click = context.createBufferSource();
    click.buffer = makeTone(1760);
    const clickGain = context.createGain();
    clickGain.gain.value = options.metronomePeak;
    click.connect(clickGain);
    clickGain.connect(graph.outputDestination);
    click.start(onset);

    const rendered = await context.startRendering();
    let peak = 0;
    for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
      const data = rendered.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const magnitude = Math.abs(data[i] as number);
        if (magnitude > peak) peak = magnitude;
      }
    }
    return peak;
  }, input);
}

test.describe('output headroom', () => {
  let bundles: string[];

  test.beforeAll(async () => {
    bundles = [
      await bundleModule('src/audio/PianoGraphFactory.ts', 'PianoGraph'),
      await bundleModule('src/audio/loudness.ts', 'Loudness'),
      await bundleModule('src/audio/MetronomeEngine.ts', 'Metronome'),
    ];
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    for (const content of bundles) await page.addScriptTag({ content });
  });

  test('a dense fortissimo chord plus a metronome accent stays below full scale', async ({
    page,
  }) => {
    const peak = await renderPeak(page, {
      voiceGain: worstCaseVoiceGain(),
      voiceCount: VOICE_COUNT,
      metronomePeak: METRONOME_PEAK,
      masterVolume: 0.85,
      reverbMix: 0.18,
    });
    test.info().annotations.push({ type: 'peak', description: peak.toFixed(4) });
    expect(peak).toBeGreaterThan(0.5); // the test is actually driving the graph
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('stays below full scale at maximum volume and reverb', async ({ page }) => {
    const peak = await renderPeak(page, {
      voiceGain: worstCaseVoiceGain(),
      voiceCount: VOICE_COUNT,
      metronomePeak: METRONOME_PEAK,
      masterVolume: 1,
      reverbMix: 1,
    });
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('keeps the corrected worst case under full scale once the limiter has settled', async ({
    page,
  }) => {
    // The two tests above strike at 0.25 s, while a newly made
    // DynamicsCompressorNode may still be opening up — it starts out ducking
    // hard — so the worst case is struck again a second in, against a limiter
    // that has settled, as the live one always has. The click lands with it.
    const peak = await renderPeak(page, {
      voiceGain: worstCaseVoiceGain(),
      voiceCount: VOICE_COUNT,
      metronomePeak: METRONOME_PEAK,
      masterVolume: 1,
      reverbMix: 1,
      onsetS: 1,
    });
    test.info().annotations.push({ type: 'peak', description: peak.toFixed(4) });
    expect(peak).toBeGreaterThan(0.9); // the stage really is at work up there
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('bends an overshoot into the ceiling rather than flat-topping below it', async ({
    page,
  }) => {
    // The metronome joins right at the soft clipper, past the limiter, so the
    // clipper's own transfer can be read straight off the output: a steady
    // tone in at each level, its peak out. Up to the knee it is untouched;
    // over it, it bends to the ceiling and, however far over, stays there.
    //
    // The shaper's curve is addressed over [-1, 1] and a WaveShaperNode clamps
    // beyond that. Without the 1/SOFT_CLIP_INPUT_RANGE pre-gain the curve would
    // have to end at full scale, and every overshoot would collapse onto its
    // value there, about 0.978, short of the ceiling: hard clipping moved
    // inside the graph rather than removed. Drop the pre-gain but keep the
    // stretched curve instead, and even the quiet tone comes out at the
    // ceiling. Either way this fails.
    const levels = [0.5, 0.9, 1, 1.5, 4, 16];
    const { peaks, ceiling } = await page.evaluate(async (inputs: number[]) => {
      const { PianoGraph } = window as unknown as Modules;
      const sampleRate = 48000;
      const out: number[] = [];
      for (const level of inputs) {
        const context = new OfflineAudioContext({
          numberOfChannels: 2,
          length: sampleRate,
          sampleRate,
        });
        const graph = PianoGraph.createPianoGraph(context, {
          masterVolume: 0.85,
          reverbMix: 0.18,
        });
        const tone = context.createOscillator();
        tone.frequency.value = 110;
        const gain = context.createGain();
        gain.gain.value = level;
        tone.connect(gain);
        gain.connect(graph.outputDestination);
        tone.start(0);
        const rendered = await context.startRendering();
        let peak = 0;
        for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
          const data = rendered.getChannelData(channel);
          for (let i = sampleRate / 2; i < data.length; i += 1) {
            peak = Math.max(peak, Math.abs(data[i] as number));
          }
        }
        out.push(peak);
      }
      return { peaks: out, ceiling: PianoGraph.SOFT_CLIP_CEILING };
    }, levels);
    test.info().annotations.push({
      type: 'peaks',
      description: peaks.map((peak) => peak.toFixed(5)).join(' '),
    });
    const [half, underKnee, fullScale, ...over] = peaks as [number, number, number, ...number[]];
    expect(half).toBeCloseTo(0.5, 3);
    expect(underKnee).toBeCloseTo(0.9, 3);
    expect(fullScale).toBeGreaterThan(underKnee);
    for (const peak of over) {
      expect(peak).toBeGreaterThan(ceiling - 0.001);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  test('stays linear for quiet material — no squashing below the threshold', async ({ page }) => {
    const quiet = { voiceCount: 1, metronomePeak: 0, masterVolume: 0.85, reverbMix: 0 };
    const loud = await renderPeak(page, { ...quiet, voiceGain: 0.3 });
    const half = await renderPeak(page, { ...quiet, voiceGain: 0.15 });
    // Both sit below the limiter threshold and the soft clipper's knee, so
    // halving the input must halve the output exactly. (The absolute level is
    // the business of the test after next.)
    expect(loud / half).toBeCloseTo(2, 1);
  });

  test('an accented click leaves the piano where it was', async ({ page }) => {
    // Clicks join after the limiter, so a click can no longer make it turn the
    // piano down for the moments after it — which an accent at the default
    // volume used to. A held tone on the piano path, well under the limiter's
    // threshold, is rendered with the metronome and without; two low-passes
    // far under the click's pitch take the click itself back out, and what is
    // left of the tone has to be where it was, window by window.
    const result = await page.evaluate(
      async ({ clicksAtS, volume }) => {
        const { PianoGraph, Metronome } = window as unknown as Modules;
        const sampleRate = 48000;
        const seconds = (clicksAtS.at(-1) ?? 0) + 1;
        const render = async (clicks: boolean) => {
          const context = new OfflineAudioContext({
            numberOfChannels: 2,
            length: sampleRate * seconds,
            sampleRate,
          });
          const graph = PianoGraph.createPianoGraph(context, {
            masterVolume: 0.85,
            reverbMix: 0.18,
          });
          const tone = context.createOscillator();
          tone.frequency.value = 110;
          const level = context.createGain();
          level.gain.value = 0.3;
          tone.connect(level);
          level.connect(graph.voiceDestination);
          tone.start(0);
          if (clicks) {
            const metronome = context.createGain();
            metronome.gain.value = volume;
            metronome.connect(graph.outputDestination);
            for (const at of clicksAtS) Metronome.scheduleClick(context, metronome, at, true);
          }
          return context.startRendering();
        };
        const lowPassed = async (buffer: AudioBuffer) => {
          const context = new OfflineAudioContext({
            numberOfChannels: 2,
            length: buffer.length,
            sampleRate,
          });
          const source = context.createBufferSource();
          source.buffer = buffer;
          let node: AudioNode = source;
          for (let stage = 0; stage < 2; stage += 1) {
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 300;
            node.connect(filter);
            node = filter;
          }
          node.connect(context.destination);
          source.start(0);
          return context.startRendering();
        };
        const rms = (buffer: AudioBuffer, fromS: number, toS: number) => {
          let energy = 0;
          let count = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let i = Math.round(fromS * sampleRate); i < Math.round(toS * sampleRate); i += 1) {
              energy += (data[i] as number) ** 2;
              count += 1;
            }
          }
          return Math.sqrt(energy / count);
        };

        const [clicked, plain] = await Promise.all([render(true), render(false)]);
        // The clicks really do sound: the two renders differ by a click's height.
        let clickHeight = 0;
        const a = clicked.getChannelData(0);
        const b = plain.getChannelData(0);
        for (let i = 0; i < a.length; i += 1) {
          clickHeight = Math.max(clickHeight, Math.abs((a[i] as number) - (b[i] as number)));
        }
        const [clickedTone, plainTone] = await Promise.all([lowPassed(clicked), lowPassed(plain)]);
        const windowsDb: number[] = [];
        for (const at of clicksAtS) {
          for (let from = at; from < at + 0.25; from += 0.02) {
            const ratio = rms(clickedTone, from, from + 0.02) / rms(plainTone, from, from + 0.02);
            windowsDb.push(20 * Math.log10(ratio));
          }
        }
        return { clickHeight, windowsDb };
      },
      { clicksAtS: [2, 3, 4, 5], volume: METRONOME_VOLUME },
    );
    test.info().annotations.push({
      type: 'deepest window',
      description: `${Math.min(...result.windowsDb).toFixed(3)} dB`,
    });
    expect(result.clickHeight).toBeGreaterThan(0.3);
    for (const db of result.windowsDb) expect(Math.abs(db)).toBeLessThanOrEqual(0.1);
  });

  test('plays quiet material as loud as an export kept at its played level', async ({ page }) => {
    // Under the limiter's threshold the live stage is pure gain: its output
    // gain and the compressor's own makeup. An export leaves the stage out and
    // "As played" adds LIVE_MAKEUP_DB back instead, so the two have to agree.
    const { liveOverExportDb, liveMakeupDb } = await page.evaluate(async () => {
      const { PianoGraph, Loudness } = window as unknown as Modules;
      const sampleRate = 48000;
      const render = async (peakGuard: boolean) => {
        const context = new OfflineAudioContext({
          numberOfChannels: 2,
          length: sampleRate * 3,
          sampleRate,
        });
        const graph = PianoGraph.createPianoGraph(context, {
          masterVolume: 0.85,
          reverbMix: 0.18,
          peakGuard,
        });
        const tone = context.createOscillator();
        tone.frequency.value = 440;
        const level = context.createGain();
        level.gain.value = 0.05;
        tone.connect(level);
        level.connect(graph.voiceDestination);
        tone.start(0);
        return context.startRendering();
      };
      // Measured a second and a half in: a DynamicsCompressorNode starts out
      // ducking hard and takes a moment to open up.
      const rms = (buffer: AudioBuffer) => {
        let energy = 0;
        let count = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
          const data = buffer.getChannelData(channel);
          for (let i = sampleRate * 1.5; i < sampleRate * 2.5; i += 1) {
            energy += (data[i] as number) ** 2;
            count += 1;
          }
        }
        return Math.sqrt(energy / count);
      };
      const [live, exported] = await Promise.all([render(true), render(false)]);
      return {
        liveOverExportDb: 20 * Math.log10(rms(live) / rms(exported)),
        liveMakeupDb: Loudness.LIVE_MAKEUP_DB,
      };
    });
    test.info().annotations.push({
      type: 'live over export',
      description: `${liveOverExportDb.toFixed(3)} dB against ${liveMakeupDb} dB`,
    });
    expect(Math.abs(liveOverExportDb - liveMakeupDb)).toBeLessThanOrEqual(0.3);
  });

  test('plays the first note of a session as loud as any other', async ({ page }) => {
    // A newly made DynamicsCompressorNode starts out ducking hard, and live
    // the first notes of a session are played the moment the audio starts —
    // the gesture that starts it plays one. A struck tone at a playing level,
    // at the very start of a fresh graph and again a second and a half in, has
    // to sound the same from its onset on.
    const windowsDb = await page.evaluate(async () => {
      const { PianoGraph } = window as unknown as Modules;
      const sampleRate = 48000;
      const windowsS = [0.05, 0.1, 0.25];
      const strike = async (atS: number) => {
        const context = new OfflineAudioContext({
          numberOfChannels: 2,
          length: Math.round(sampleRate * (atS + 0.5)),
          sampleRate,
        });
        const graph = PianoGraph.createPianoGraph(context, {
          masterVolume: 0.85,
          reverbMix: 0.18,
        });
        // Decaying like a struck string, well under the limiter's threshold.
        const note = context.createBuffer(2, sampleRate / 2, sampleRate);
        for (let channel = 0; channel < 2; channel += 1) {
          const data = note.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) {
            data[i] = 0.5 * Math.sin((2 * Math.PI * 262 * i) / sampleRate) * Math.exp(-i / 4000);
          }
        }
        const source = context.createBufferSource();
        source.buffer = note;
        source.connect(graph.voiceDestination);
        source.start(atS);
        const rendered = await context.startRendering();
        // RMS over the first `lengthS` from the onset.
        return windowsS.map((lengthS) => {
          let energy = 0;
          let count = 0;
          for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
            const data = rendered.getChannelData(channel);
            const from = Math.round(atS * sampleRate);
            for (let i = from; i < from + Math.round(lengthS * sampleRate); i += 1) {
              energy += (data[i] as number) ** 2;
              count += 1;
            }
          }
          return Math.sqrt(energy / count);
        });
      };
      const [cold, warm] = await Promise.all([strike(0), strike(1.5)]);
      return cold.map((level, i) => 20 * Math.log10(level / (warm[i] as number)));
    });
    test.info().annotations.push({
      type: 'first note against a later one, over 50 / 100 / 250 ms',
      description: windowsDb.map((db) => `${db.toFixed(3)} dB`).join(' '),
    });
    for (const db of windowsDb) expect(Math.abs(db)).toBeLessThanOrEqual(0.3);
  });

  test('moves onto the limiter once it has settled without a bump', async ({ page }) => {
    // Until the limiter has settled the piano goes round it, delayed as much
    // and made up as much as the limiter will; then it crossfades across. If
    // the two ways differed in level, or in time — a fraction of a frame, at
    // 44.1 kHz, is enough to dull the top octave — a held tone would show it.
    // Windows are whole cycles of each tone, so every one reads the same.
    const cases = await page.evaluate(async () => {
      const { PianoGraph } = window as unknown as Modules;
      const out: Array<{ rate: number; frequency: number; worstDb: number }> = [];
      for (const sampleRate of [44100, 48000]) {
        for (const frequency of [250, 9000]) {
          const context = new OfflineAudioContext({
            numberOfChannels: 2,
            length: Math.round(sampleRate * 1.25),
            sampleRate,
          });
          // Dry, so nothing builds up in the room while the tone holds.
          const graph = PianoGraph.createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0 });
          const tone = context.createOscillator();
          tone.frequency.value = frequency;
          const level = context.createGain();
          level.gain.value = 0.3;
          tone.connect(level);
          level.connect(graph.voiceDestination);
          tone.start(0);
          const rendered = await context.startRendering();
          const rms = (fromS: number, toS: number) => {
            let energy = 0;
            let count = 0;
            for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
              const data = rendered.getChannelData(channel);
              for (
                let i = Math.round(fromS * sampleRate);
                i < Math.round(toS * sampleRate);
                i += 1
              ) {
                energy += (data[i] as number) ** 2;
                count += 1;
              }
            }
            return Math.sqrt(energy / count);
          };
          const settled = rms(1, 1.2);
          let worstDb = 0;
          for (let from = 0.04; from < 0.8; from += 0.02) {
            const db = 20 * Math.log10(rms(from, from + 0.02) / settled);
            if (Math.abs(db) > Math.abs(worstDb)) worstDb = db;
          }
          out.push({ rate: sampleRate, frequency, worstDb });
        }
      }
      return out;
    });
    test.info().annotations.push({
      type: 'worst 20 ms window against settled',
      description: cases
        .map((c) => `${c.frequency} Hz @ ${c.rate}: ${c.worstDb.toFixed(3)} dB`)
        .join('; '),
    });
    for (const { worstDb } of cases) expect(Math.abs(worstDb)).toBeLessThanOrEqual(0.1);
  });
});
