import path from 'node:path';
import { build } from 'vite';
import { expect, test } from './fixtures';

/**
 * Where a voice starts, measured in the browser's own audio: the real
 * `sampleVoice` module is bundled and injected into the page, as the output
 * headroom spec does with the graph, and driven by an OfflineAudioContext.
 */

interface Modules {
  SampleVoice: typeof import('../../src/audio/sampleVoice');
}

async function bundleSampleVoice(): Promise<string> {
  const result = (await build({
    logLevel: 'silent',
    configFile: false,
    resolve: { alias: { '@': path.resolve('src') } },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve('src/audio/sampleVoice.ts'),
        formats: ['iife'],
        name: 'SampleVoice',
        fileName: () => 'SampleVoice.js',
      },
    },
  })) as unknown as Array<{ output: Array<{ code?: string }> }>;
  const code = result[0]?.output[0]?.code;
  if (!code) throw new Error('could not bundle src/audio/sampleVoice.ts');
  return code;
}

interface Measured {
  /** Largest difference from the recording, once the voice's attack is over. */
  voiceError: number;
  /** The same, for a bare buffer source started at the very same time. */
  bareError: number;
}

test.describe('where a voice starts', () => {
  let bundle = '';

  test.beforeAll(async () => {
    bundle = await bundleSampleVoice();
  });

  test('a voice asked to start between two frames plays its recording sample for sample', async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: bundle });
    const measured = await page.evaluate(async (): Promise<Measured> => {
      const { startSampleVoice } = (window as unknown as Modules).SampleVoice;
      const rate = 48_000;
      // A tenth of a second and 0.37 of a frame: between two frames.
      const when = 0.1 + 0.37 / rate;
      const offsetFrames = 64;
      // White noise, the hardest test for a lowpass: every frequency at once.
      let seed = 0x2545f491;
      const recording = new Float32Array(rate / 4);
      for (let i = 0; i < recording.length; i += 1) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        recording[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
      }
      const render = async (start: (context: OfflineAudioContext, buffer: AudioBuffer) => void) => {
        const context = new OfflineAudioContext({
          numberOfChannels: 1,
          length: rate / 2,
          sampleRate: rate,
        });
        const buffer = context.createBuffer(1, recording.length, rate);
        buffer.copyToChannel(recording, 0);
        start(context, buffer);
        return (await context.startRendering()).getChannelData(0);
      };
      // Compared from past the voice's 1.5 ms fade-in, where its gain is 1,
      // against the recording from the frame the output starts on.
      const errorFrom = (output: Float32Array, firstFrame: number, recordingFrom: number) => {
        let worst = 0;
        for (let i = 200; i < 8_000; i += 1) {
          worst = Math.max(
            worst,
            Math.abs((output[firstFrame + i] as number) - (recording[recordingFrom + i] as number)),
          );
        }
        return worst;
      };
      const voiceOutput = await render((context, buffer) => {
        startSampleVoice(
          context,
          context.destination,
          { buffer, playbackRate: 1, gain: 1, offset: offsetFrames / rate },
          when,
        );
      });
      const bareOutput = await render((context, buffer) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(when, offsetFrames / rate);
      });
      const frame = Math.round(when * rate);
      return {
        voiceError: errorFrom(voiceOutput, frame, offsetFrames),
        bareError: errorFrom(bareOutput, Math.ceil(when * rate), offsetFrames),
      };
    });
    // The premise: started between frames, the browser interpolates the
    // recording, so what comes out is not what went in. Should this ever fail,
    // the browser rounds a start to a frame itself, and nearestFrameTime can go.
    expect(measured.bareError).toBeGreaterThan(0.01);
    expect(measured.voiceError).toBe(0);
  });
});
