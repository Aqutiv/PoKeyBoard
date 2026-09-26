import path from 'node:path';
import { build } from 'vite';
import { expect, test } from './fixtures';
import { MAX_ROOT_DISTANCE_SEMITONES } from '../../src/audio/SampleBank';
import { REVERB_ROOMS, type ReverbRoom } from '../../src/domain/takeTypes';
import { VELOCITY_CALIBRATIONS } from '../../src/audio/velocityCalibration';
import { loudestVoicePeak } from '../../src/audio/velocityCalibrationMath';

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
 * The worst-case per-voice gain the app can produce, for the full-scale sines
 * this spec drives the graph with: not the largest gain, which goes to the
 * quietest recordings, but the loudest peak any voice really reaches at full
 * velocity — each recording's sample peak times the gain the velocity
 * calibration gives it, on every key it can sound, stand-ins during a partial
 * load included (`loudestVoicePeak`), on any pack. About 1.5: the Headroom
 * piano's soft A6 standing in for C6. A fully loaded pack peaks at 1.2.
 */
function worstCaseVoiceGain(): number {
  return Math.max(
    ...Object.values(VELOCITY_CALIBRATIONS).map((calibration) =>
      loudestVoicePeak(calibration, LOUD_VELOCITY, MAX_ROOT_DISTANCE_SEMITONES),
    ),
  );
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
  /** The graph's default room unless said otherwise. */
  reverbRoom?: ReverbRoom;
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
      reverbRoom: options.reverbRoom,
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

  test('stays below full scale at maximum volume and reverb, in every room', async ({ page }) => {
    // The rooms differ in how their energy is spread and how hard their early
    // reflections land, and the Studio's is the most concentrated.
    for (const reverbRoom of REVERB_ROOMS) {
      const peak = await renderPeak(page, {
        voiceGain: worstCaseVoiceGain(),
        voiceCount: VOICE_COUNT,
        metronomePeak: METRONOME_PEAK,
        masterVolume: 1,
        reverbMix: 1,
        reverbRoom,
      });
      test.info().annotations.push({ type: `peak in ${reverbRoom}`, description: peak.toFixed(4) });
      expect(peak, reverbRoom).toBeLessThanOrEqual(1);
    }
  });

  test('keeps the corrected worst case under full scale once the limiter has settled', async ({
    page,
  }) => {
    // The two tests above strike at 0.25 s, not long after a newly made
    // limiter has warmed up (see `LIMITER_WARMUP_S`); here the worst case is
    // struck a second in, on a limiter long settled. The click lands with it.
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

  test('holds a dense, sustained, very hot chord under the soft clipper', async ({ page }) => {
    // It is the limiter that holds the piano, not the soft clipper: a 20:1
    // limiter still lets its output climb a twentieth of a dB for every dB
    // over its threshold, so the threshold has to sit low enough that even the
    // densest chord it meets comes out under the clipper's knee, which is left
    // for the rare overshoot. Twelve voices at the worst-case gain, held for
    // two seconds once the limiter has settled, are some 25 dB over it — far
    // past anything played. (Held to the end of the render: stopped dead, as
    // no piano voice ever is, they would leave the limiter letting go while
    // the last of them is still in its look-ahead.)
    const { peak, knee } = await page.evaluate(async (voiceGain: number) => {
      const { PianoGraph } = window as unknown as Modules;
      const sampleRate = 48000;
      const context = new OfflineAudioContext({
        numberOfChannels: 2,
        length: sampleRate * 3,
        sampleRate,
      });
      const graph = PianoGraph.createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      for (let voice = 0; voice < 12; voice += 1) {
        const tone = context.createOscillator();
        tone.frequency.value = 110 * Math.pow(2, voice / 12);
        const gain = context.createGain();
        gain.gain.value = voiceGain;
        tone.connect(gain);
        gain.connect(graph.voiceDestination);
        tone.start(1);
      }
      const rendered = await context.startRendering();
      let loudest = 0;
      for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
        const data = rendered.getChannelData(channel);
        for (let i = sampleRate; i < data.length; i += 1) {
          loudest = Math.max(loudest, Math.abs(data[i] as number));
        }
      }
      return { peak: loudest, knee: PianoGraph.SOFT_CLIP_KNEE };
    }, worstCaseVoiceGain());
    test.info().annotations.push({ type: 'peak', description: peak.toFixed(4) });
    expect(peak).toBeGreaterThan(0.8); // the limiter really is holding it down
    expect(peak).toBeLessThanOrEqual(knee);
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

  test('plays the first note of a session nearly as loud as any other', async ({ page }) => {
    // A newly made DynamicsCompressorNode starts out ducking hard, and live
    // the first notes of a session are played the moment the audio starts —
    // the gesture that starts it plays one. The limiter is born with a fast
    // release to be over that quickly (`LIMITER_WARMUP_RELEASE_S`), but its
    // own detector still takes about 25 ms to come within 1 dB, so a struck
    // tone at a playing level, at the very start of a fresh graph, comes out a
    // little short of the same tone struck a second and a half in: measured
    // 1.75 dB over its first 50 ms and 1.1 dB over 250 ms, a fast-decaying
    // tone being the worst case. A limiter born with its own 0.3 s release
    // would leave it 17 and 10 dB short, and the one before this 14 and 7.
    const cases = await page.evaluate(async () => {
      const { PianoGraph } = window as unknown as Modules;
      const windowsS = [0.05, 0.1, 0.25];
      const out: Array<{ sampleRate: number; windowsDb: number[] }> = [];
      for (const sampleRate of [44100, 48000]) {
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
          const note = context.createBuffer(2, Math.round(sampleRate / 2), sampleRate);
          for (let channel = 0; channel < 2; channel += 1) {
            const data = note.getChannelData(channel);
            for (let i = 0; i < data.length; i += 1) {
              const t = i / sampleRate;
              data[i] = 0.5 * Math.sin(2 * Math.PI * 262 * t) * Math.exp(-t / (4000 / 48000));
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
        out.push({
          sampleRate,
          windowsDb: cold.map((level, i) => 20 * Math.log10(level / (warm[i] as number))),
        });
      }
      return out;
    });
    test.info().annotations.push({
      type: 'first note against a later one, over 50 / 100 / 250 ms',
      description: cases
        .map((c) => `${c.sampleRate}: ${c.windowsDb.map((db) => db.toFixed(3)).join(' / ')} dB`)
        .join('; '),
    });
    for (const { windowsDb } of cases) {
      const [over50, , over250] = windowsDb as [number, number, number];
      expect(Math.abs(over50)).toBeLessThanOrEqual(2);
      expect(Math.abs(over250)).toBeLessThanOrEqual(1.25);
    }
  });

  test('a loud first chord bends at the soft clipper only in its first 30 ms', async ({ page }) => {
    // The gesture that starts the audio can strike a loud chord as well as a
    // quiet note. Nothing goes round the limiter, so it holds the chord from
    // the start; but the fast release it is born with (`LIMITER_WARMUP_S`)
    // lets go between a dense chord's peaks and catches the next a moment
    // late, so a chord like this one, 25 dB over its threshold, bends at the
    // soft clipper for a moment — some 300 samples, measured, all within its
    // first 25 ms; La Campanella's loudest chord, a handful. After that it has
    // to be held exactly as the same chord struck on a limiter long settled:
    // from 100 ms on, window by window.
    const cases = await page.evaluate(async (voiceGain: number) => {
      const { PianoGraph } = window as unknown as Modules;
      const lengthS = 0.6;
      const out: Array<{
        sampleRate: number;
        windowsDb: number[];
        cold: { frames: number; lastS: number };
        settled: { frames: number; lastS: number };
      }> = [];
      for (const sampleRate of [44100, 48000]) {
        const strike = async (atS: number) => {
          const context = new OfflineAudioContext({
            numberOfChannels: 2,
            length: Math.round(sampleRate * (atS + lengthS + 0.05)),
            sampleRate,
          });
          const graph = PianoGraph.createPianoGraph(context, {
            masterVolume: 0.85,
            reverbMix: 0.18,
          });
          for (let voice = 0; voice < 12; voice += 1) {
            const frequency = 110 * Math.pow(2, voice / 12);
            const tone = context.createBuffer(2, sampleRate, sampleRate);
            for (let channel = 0; channel < 2; channel += 1) {
              const data = tone.getChannelData(channel);
              for (let i = 0; i < data.length; i += 1) {
                // Decaying like a struck string: full scale at the onset.
                const envelope = Math.exp((-3 * i) / data.length);
                data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * envelope;
              }
            }
            const source = context.createBufferSource();
            source.buffer = tone;
            const gain = context.createGain();
            gain.gain.value = voiceGain;
            source.connect(gain);
            gain.connect(graph.voiceDestination);
            source.start(atS);
          }
          const rendered = await context.startRendering();
          const from = Math.round(atS * sampleRate);
          const to = from + Math.round(lengthS * sampleRate);
          return [rendered.getChannelData(0), rendered.getChannelData(1)].map((data) =>
            data.subarray(from, to),
          );
        };
        const [cold, settled] = await Promise.all([strike(0), strike(1.5)]);
        const rms = (channels: Float32Array[], from: number, to: number) => {
          let energy = 0;
          let count = 0;
          for (const data of channels) {
            for (let i = from; i < to; i += 1) {
              energy += (data[i] as number) ** 2;
              count += 1;
            }
          }
          return Math.sqrt(energy / count);
        };
        const windowFrames = Math.round(0.02 * sampleRate);
        const windowsDb: number[] = [];
        for (
          let from = Math.round(0.1 * sampleRate);
          from + windowFrames <= cold[0]!.length;
          from += windowFrames
        ) {
          const to = from + windowFrames;
          windowsDb.push(20 * Math.log10(rms(cold, from, to) / rms(settled, from, to)));
        }
        const overKnee = (channels: Float32Array[]) => {
          let frames = 0;
          let last = -1;
          for (let i = 0; i < channels[0]!.length; i += 1) {
            const magnitude = Math.max(...channels.map((data) => Math.abs(data[i] as number)));
            if (magnitude > PianoGraph.SOFT_CLIP_KNEE) {
              frames += 1;
              last = i;
            }
          }
          return { frames, lastS: last / sampleRate };
        };
        out.push({ sampleRate, windowsDb, cold: overKnee(cold), settled: overKnee(settled) });
      }
      return out;
    }, worstCaseVoiceGain());
    test.info().annotations.push({
      type: 'frames over the knee, first chord (last one) / settled; worst window from 100 ms',
      description: cases
        .map(
          (c) =>
            `${c.sampleRate}: ${c.cold.frames} (${(c.cold.lastS * 1000).toFixed(1)} ms) / ` +
            `${c.settled.frames}; ${Math.max(...c.windowsDb.map(Math.abs)).toFixed(3)} dB`,
        )
        .join('; '),
    });
    for (const { windowsDb, cold, settled } of cases) {
      expect(settled.frames).toBe(0);
      expect(cold.lastS).toBeLessThan(0.03);
      for (const db of windowsDb) expect(Math.abs(db)).toBeLessThanOrEqual(0.5);
    }
  });
});
