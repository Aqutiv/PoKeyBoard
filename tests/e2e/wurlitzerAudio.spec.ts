import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from './fixtures';

// Run the actual shared scheduler and VoiceManager against real browser audio,
// independently of the app's graph limiter/reverb and device output settings.
const compile = (file: string) =>
  ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
const moduleUrl = (code: string) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const voiceModule = moduleUrl(compile('src/audio/sampleVoice.ts'));
const managerModule = moduleUrl(
  compile('src/audio/VoiceManager.ts').replaceAll("'./sampleVoice'", JSON.stringify(voiceModule)),
);

test.use({ samplePack: 'real' });

for (const rate of [44100, 48000]) {
  test(`Wurlitzer loops, envelopes and live/export parity at ${rate} Hz`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(
      async ({ rate, voiceModule, managerModule }) => {
        const { startSampleVoice, releaseSampleVoice } = await import(voiceModule);
        const { VoiceManager } = await import(managerModule);
        const manifest = await (await fetch('/piano/wurlitzer-ep203w-v1/manifest.json')).json();
        const file = manifest.files.find((f: { file: string }) => f.file === 'db4mp.sample');
        const bytes = await (await fetch(`/piano/wurlitzer-ep203w-v1/${file.file}`)).arrayBuffer();
        const context = new OfflineAudioContext(1, rate * 10, rate);
        const buffer = await context.decodeAudioData(bytes);
        const rms = (data: Float32Array, start: number, end: number) => {
          let energy = 0;
          for (let i = Math.floor(start * rate); i < Math.floor(end * rate); i++)
            energy += data[i]! ** 2;
          return Math.sqrt(energy / ((end - start) * rate));
        };
        const results = [];
        for (const pitch of [0.5, 1, 2]) {
          const sample = {
            buffer,
            gain: 0.7,
            playbackRate: pitch,
            loop: file.loop,
            envelope: manifest.envelope,
          };
          const render = async (live: boolean) => {
            const ctx = new OfflineAudioContext(1, rate * 10, rate);
            if (live) {
              const manager = new VoiceManager(ctx, ctx.destination);
              manager.scheduleNote(sample, 61, 'test', 0, 8);
            } else {
              const voice = startSampleVoice(ctx, ctx.destination, sample, 0);
              releaseSampleVoice(voice, 8);
            }
            return (await ctx.startRendering()).getChannelData(0);
          };
          const live = await render(true);
          const exported = await render(false);
          let difference = 0;
          for (let i = 0; i < live.length; i++)
            difference = Math.max(difference, Math.abs(live[i]! - exported[i]!));
          results.push({
            pitch,
            difference,
            heldRms: rms(live, 6, 7),
            afterRelease: rms(live, 8.2, 9),
          });
        }
        const long = new OfflineAudioContext(1, rate * 32, rate);
        startSampleVoice(
          long,
          long.destination,
          { buffer, gain: 1, playbackRate: 1, loop: file.loop, envelope: manifest.envelope },
          0,
        );
        const longData = (await long.startRendering()).getChannelData(0);
        // Sub-millisecond staccato checks cancellation inside the attack ramp.
        const short = new OfflineAudioContext(1, rate, rate);
        const voice = startSampleVoice(
          short,
          short.destination,
          { buffer, gain: 1, playbackRate: 1, loop: file.loop, envelope: manifest.envelope },
          0,
        );
        releaseSampleVoice(voice, 0.0005);
        const shortData = (await short.startRendering()).getChannelData(0);
        return {
          results,
          sourceDuration: buffer.duration,
          longHeld: rms(longData, 4, 5),
          longDecay: rms(longData, 24, 25),
          longEnded: rms(longData, 31, 32),
          staccatoEnded: rms(shortData, 0.2, 0.9),
        };
      },
      { rate, voiceModule, managerModule },
    );
    expect(result.sourceDuration).toBeLessThan(6);
    for (const rendered of result.results) {
      expect(rendered.difference).toBe(0);
      expect(rendered.heldRms).toBeGreaterThan(0.001);
      expect(rendered.afterRelease).toBe(0);
    }
    expect(result.longDecay).toBeLessThan(result.longHeld);
    expect(result.longDecay).toBeGreaterThan(0);
    expect(result.longEnded).toBe(0);
    expect(result.staccatoEnded).toBe(0);
  });
}
