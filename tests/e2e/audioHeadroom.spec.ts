import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { expect, test } from './fixtures';
import type { SamplePackManifest } from '../../src/audio/audioTypes';
import { pianoInstrument } from '../../src/audio/instruments';
import { velocityGain, velocityToLayer } from '../../src/audio/SampleBank';

/**
 * The only spec that measures actual audio. Node has no Web Audio and the
 * preview build exports nothing to `window`, so the real PianoGraphFactory
 * module is bundled here and injected into the page, where it is driven by an
 * OfflineAudioContext. That way the assertion is about the shipped graph, not
 * about a reimplementation of it.
 */

const LOUD_VELOCITY = 1;
/** A pedalled fortissimo chord — two hands plus sustained overtones. */
const VOICE_COUNT = 12;
/** MetronomeEngine's accent click peak × the default metronome volume. */
const METRONOME_PEAK = 0.6;

/**
 * The worst-case per-voice gain the app can produce: SampleBank multiplies
 * velocityGain by the pack's levelMatch *outside* velocityGain's own clamp, and
 * headroom-grand's levelMatch is the largest of any pack.
 */
function worstCaseVoiceGain(): number {
  const packDir = pianoInstrument('headroom-grand').path.replace(/\/$/, '');
  const manifest = JSON.parse(
    readFileSync(path.resolve('public', packDir, 'manifest.json'), 'utf8'),
  ) as SamplePackManifest & { levelMatch?: number[] };
  const layer = velocityToLayer(LOUD_VELOCITY);
  const levelMatch = manifest.levelMatch?.[layer] ?? 1;
  return velocityGain(LOUD_VELOCITY, layer) * levelMatch;
}

/** IIFE bundle of the real graph module, exposed as `window.PianoGraph`. */
async function bundleGraphModule(): Promise<string> {
  const result = (await build({
    logLevel: 'silent',
    configFile: false,
    resolve: { alias: { '@': path.resolve('src') } },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve('src/audio/PianoGraphFactory.ts'),
        formats: ['iife'],
        name: 'PianoGraph',
        fileName: () => 'pianoGraph.js',
      },
    },
  })) as unknown as Array<{ output: Array<{ code?: string }> }>;
  const code = result[0]?.output[0]?.code;
  if (!code) throw new Error('could not bundle PianoGraphFactory');
  return code;
}

interface RenderInput {
  voiceGain: number;
  voiceCount: number;
  metronomePeak: number;
  masterVolume: number;
  reverbMix: number;
}

/**
 * Renders the worst case through the real graph and returns the output peak.
 * Voices are full-scale sines at slightly detuned frequencies so their peaks
 * drift in and out of phase — the same transient pile-up a dense chord makes,
 * without needing the sample pack decoded.
 */
async function renderPeak(
  page: import('@playwright/test').Page,
  bundle: string,
  input: RenderInput,
): Promise<number> {
  await page.addScriptTag({ content: bundle });
  return page.evaluate(async (options: RenderInput) => {
    const factory = (window as unknown as { PianoGraph: typeof import('../../src/audio/PianoGraphFactory') })
      .PianoGraph;
    const sampleRate = 48000;
    const seconds = 2;
    const context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: sampleRate * seconds,
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
      source.start(0.25);
    }

    // The metronome accent lands on the same instant as the chord.
    const click = context.createBufferSource();
    click.buffer = makeTone(1760);
    const clickGain = context.createGain();
    clickGain.gain.value = options.metronomePeak;
    click.connect(clickGain);
    clickGain.connect(graph.outputDestination);
    click.start(0.25);

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
  let bundle: string;

  test.beforeAll(async () => {
    bundle = await bundleGraphModule();
  });

  test('a dense fortissimo chord plus a metronome accent stays below full scale', async ({
    page,
  }) => {
    await page.goto('/');
    const peak = await renderPeak(page, bundle, {
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
    await page.goto('/');
    const peak = await renderPeak(page, bundle, {
      voiceGain: worstCaseVoiceGain(),
      voiceCount: VOICE_COUNT,
      metronomePeak: METRONOME_PEAK,
      masterVolume: 1,
      reverbMix: 1,
    });
    expect(peak).toBeLessThanOrEqual(1);
  });

  test('stays linear for quiet material — no squashing below the threshold', async ({ page }) => {
    await page.goto('/');
    const quiet = { voiceCount: 1, metronomePeak: 0, masterVolume: 0.85, reverbMix: 0 };
    const loud = await renderPeak(page, bundle, { ...quiet, voiceGain: 0.3 });
    const half = await renderPeak(page, bundle, { ...quiet, voiceGain: 0.15 });
    // Both sit below the limiter threshold and the soft clipper's knee, so
    // halving the input must halve the output exactly. (Absolute levels are not
    // asserted: Chrome's DynamicsCompressorNode applies its own makeup gain,
    // which is an implementation detail we do not want to pin.)
    expect(loud / half).toBeCloseTo(2, 1);
  });
});
