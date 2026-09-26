import { describe, expect, it } from 'vitest';
import {
  compressorMakeupDb,
  LIMITER_LOOKAHEAD_S,
  LIMITER_MAKEUP_DB,
  LIMITER_THRESHOLD_DB,
  LIMITER_WARMUP_FADE_S,
  LIMITER_WARMUP_S,
  LIVE_OUTPUT_GAIN_DB,
} from '@/audio/gainStaging';
import {
  createPianoGraph,
  createSoftClipCurve,
  SOFT_CLIP_CEILING,
  SOFT_CLIP_INPUT_RANGE,
  SOFT_CLIP_KNEE,
  VOICE_BUS_HEADROOM,
} from '@/audio/PianoGraphFactory';

/**
 * jsdom has no Web Audio, so the context is hand-stubbed the way
 * sampleBank.test.ts stubs `decodeAudioData`. Nodes record their outgoing
 * connections so the test can walk the chain.
 */
interface StubNode {
  kind: string;
  outputs: StubNode[];
  disconnected: boolean;
  connect(target: StubNode): void;
  disconnect(): void;
}

interface StubParam {
  value: number;
  targets: number[];
  /** Automation scheduled for later, in order; `value` is left as it was. */
  events: Array<{ type: string; value: number; time: number }>;
  setTargetAtTime(value: number, when: number, tc: number): void;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
}

function param(initial = 0): StubParam {
  return {
    value: initial,
    targets: [],
    events: [],
    setTargetAtTime(value) {
      this.targets.push(value);
      this.value = value;
    },
    setValueAtTime(value, time) {
      this.events.push({ type: 'setValueAtTime', value, time });
    },
    linearRampToValueAtTime(value, time) {
      this.events.push({ type: 'linearRampToValueAtTime', value, time });
    },
  };
}

function node<T extends object>(kind: string, extra: T): StubNode & T {
  return {
    kind,
    outputs: [],
    disconnected: false,
    connect(target: StubNode) {
      this.outputs.push(target);
    },
    disconnect() {
      this.disconnected = true;
    },
    ...extra,
  } as StubNode & T;
}

function createStubContext({ currentTime = 0, sampleRate = 48000 } = {}) {
  const created: StubNode[] = [];
  const track = <T extends StubNode>(n: T): T => {
    created.push(n);
    return n;
  };
  const destination = node('destination', {});
  const context = {
    currentTime,
    sampleRate,
    destination,
    createGain: () => track(node('gain', { gain: param(1) })),
    createDynamicsCompressor: () =>
      track(
        node('compressor', {
          threshold: param(),
          knee: param(),
          ratio: param(),
          attack: param(),
          release: param(),
        }),
      ),
    createWaveShaper: () =>
      track(node('waveshaper', { curve: null as Float32Array | null, oversample: 'none' })),
    createDelay: (maxDelayTime: number) =>
      track(node('delay', { delayTime: param(0), maxDelayTime })),
    createConvolver: () => track(node('convolver', { buffer: null as AudioBuffer | null })),
    createBuffer: (channels: number, length: number, rate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return { context: context as unknown as BaseAudioContext, created, destination, raw: context };
}

function findNode(created: StubNode[], kind: string): StubNode {
  const found = created.find((n) => n.kind === kind);
  if (!found) throw new Error(`no ${kind} node created`);
  return found;
}

/** Everything a signal entering `from` passes through, `from` included. */
function reachable(from: StubNode): Set<StubNode> {
  const seen = new Set<StubNode>();
  const visit = (n: StubNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    n.outputs.forEach(visit);
  };
  visit(from);
  return seen;
}

/** Every route from `from` to `to`, each as the nodes along it. */
function routes(from: StubNode, to: StubNode): StubNode[][] {
  if (from === to) return [[to]];
  return from.outputs.flatMap((next) => routes(next, to).map((rest) => [from, ...rest]));
}

/** A route as the kinds of its nodes, each gain with its value. */
function describeRoute(route: StubNode[]): string[] {
  return route.map((n) => {
    const gain = (n as StubNode & { gain?: StubParam }).gain;
    return gain ? `gain ${+gain.value.toFixed(4)}` : n.kind;
  });
}

describe('createSoftClipCurve', () => {
  const curve = createSoftClipCurve();

  /** The input magnitude curve index `i` represents, after the pre-gain. */
  const inputAt = (i: number) => ((i / (curve.length - 1)) * 2 - 1) * SOFT_CLIP_INPUT_RANGE;

  // Non-decreasing rather than strictly increasing: out at the extremes the
  // curve has saturated flat, which is the whole point of it.
  it('is monotonically non-decreasing and bounded within ±1', () => {
    let previous = -Infinity;
    for (const value of curve) {
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(Math.abs(value)).toBeLessThanOrEqual(1 + 1e-9);
      previous = value;
    }
  });

  it('is strictly increasing across the audible range', () => {
    let previous = -Infinity;
    for (let i = 0; i < curve.length; i += 1) {
      if (Math.abs(inputAt(i)) > 1) continue;
      expect(curve[i] as number).toBeGreaterThan(previous);
      previous = curve[i] as number;
    }
  });

  it('is odd-symmetric about zero', () => {
    for (let i = 0; i < curve.length; i += 1) {
      const mirrored = curve[curve.length - 1 - i] as number;
      expect(curve[i] as number).toBeCloseTo(-mirrored, 10);
    }
  });

  it('is exactly unity gain below the knee', () => {
    for (let i = 0; i < curve.length; i += 1) {
      const input = inputAt(i);
      if (Math.abs(input) > SOFT_CLIP_KNEE) continue;
      // Float32 storage, so compare at single precision.
      expect(curve[i] as number).toBeCloseTo(input, 6);
    }
  });

  it('bends only just under the ceiling, over what the limiter lets out', () => {
    expect(SOFT_CLIP_KNEE).toBe(0.95);
    // Where the limiter starts holding, what it lets out is well under the
    // knee: its output climbs a twentieth as fast as its input from there, so
    // 8 dB of limiting passes the clipper untouched.
    const limiterLetsOut = 10 ** ((LIMITER_THRESHOLD_DB + LIMITER_MAKEUP_DB) / 20);
    expect(limiterLetsOut).toBeLessThan(SOFT_CLIP_KNEE);
  });

  it('never reaches full scale, even at the endpoints', () => {
    expect(curve[curve.length - 1] as number).toBeLessThan(1);
    expect(curve[0] as number).toBeGreaterThan(-1);
  });

  /**
   * The reason the curve is gain-staged rather than defined straight over
   * [-1, 1]: a WaveShaperNode clamps out-of-range input to the endpoint, so if
   * the transfer function were still climbing there, every overshoot would
   * collapse onto one value and flat-top the waveform — hard clipping moved
   * inside the graph rather than removed.
   */
  it('has already saturated by its endpoint, so the clamp is not a corner', () => {
    const last = curve[curve.length - 1] as number;
    const nearEnd = curve[curve.length - 2] as number;
    expect(last - nearEnd).toBeLessThan(1e-6);
    expect(last).toBeCloseTo(SOFT_CLIP_CEILING, 4);
  });

  it('covers the whole range a transient can reach', () => {
    // Anything the limiter can pass lands inside the curve's domain, well
    // beyond full scale.
    expect(inputAt(curve.length - 1)).toBeGreaterThanOrEqual(4);
    expect(inputAt(curve.length - 1)).toBe(SOFT_CLIP_INPUT_RANGE);
  });
});

describe('createPianoGraph', () => {
  it('trims the voice bus for transient headroom', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const voiceBus = graph.voiceDestination as unknown as { gain: StubParam };
    expect(voiceBus.gain.value).toBe(VOICE_BUS_HEADROOM);
    expect(created.length).toBeGreaterThan(0);
  });

  it('configures the limiter to catch peaks, not to compress', () => {
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor') as unknown as Record<string, StubParam>;
    expect(limiter.threshold?.value).toBe(-2);
    expect(limiter.knee?.value).toBe(0);
    expect(limiter.ratio?.value).toBe(20);
    expect(limiter.attack?.value).toBe(0.001);
    expect(limiter.release?.value).toBe(0.3);
  });

  it('turns the piano up by the live output gain, after master and ahead of the limiter', () => {
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor');
    const feeding = created.filter((n) => n.outputs.includes(limiter));
    expect(feeding).toHaveLength(1);
    const outputGain = feeding[0] as StubNode & { gain: StubParam };
    expect(LIVE_OUTPUT_GAIN_DB).toBe(1.76);
    expect(outputGain.gain.value).toBeCloseTo(10 ** (LIVE_OUTPUT_GAIN_DB / 20), 10);
    const master = created.find((n) => n.outputs.includes(outputGain)) as unknown as {
      gain: StubParam;
    };
    expect(master.gain.value).toBe(0.85);
  });

  it("counts the limiter's own makeup gain: the spec's formula, for a hard knee", () => {
    // Full scale in comes out at the threshold plus a twentieth of the way
    // back up, −1.9 dB; the makeup is that loss to the power 0.6.
    expect(compressorMakeupDb(-2, 20)).toBeCloseTo(1.14, 10);
    expect(compressorMakeupDb(0, 20)).toBeCloseTo(0, 10);
    expect(LIMITER_MAKEUP_DB).toBe(compressorMakeupDb(-2, 20));
    // With the output gain: the 2.9 dB the app has always played at.
    expect(LIVE_OUTPUT_GAIN_DB + LIMITER_MAKEUP_DB).toBeCloseTo(2.9, 10);
  });

  it('ends in an oversampled soft clipper feeding the destination', () => {
    const { context, created, destination } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor');
    const softClip = findNode(created, 'waveshaper') as unknown as StubNode & {
      curve: Float32Array | null;
      oversample: string;
    };
    // The pre-gain that maps the curve's domain onto the real signal range,
    // which is where the limiter's output goes.
    const preGain = created.find((n) => n.outputs.includes(softClip)) as unknown as StubNode & {
      gain: StubParam;
    };
    expect(preGain.gain.value).toBeCloseTo(1 / SOFT_CLIP_INPUT_RANGE, 10);
    expect(reachable(limiter).has(preGain)).toBe(true);
    expect(softClip.outputs).toContain(destination);
    expect(softClip.oversample).toBe('4x');
    expect(softClip.curve?.length).toBeGreaterThan(0);
    // Nothing else reaches the device directly.
    const directToDestination = created.filter((n) => n.outputs.includes(destination));
    expect(directToDestination).toEqual([softClip]);
  });

  it('takes the mix straight to the destination for an export, as it always has', () => {
    // An export's level is set, and its peaks held, once it is all rendered.
    const { context, created, destination } = createStubContext();
    const graph = createPianoGraph(context, {
      masterVolume: 0.85,
      reverbMix: 0.18,
      peakGuard: false,
    });
    // Dry and reverb, stage by stage: no output gain, limiter or clipper.
    const voiceBus = graph.voiceDestination as unknown as StubNode;
    expect(routes(voiceBus, destination).map(describeRoute)).toEqual([
      ['gain 0.7', 'gain 0.91', 'gain 0.85', 'gain 1', 'destination'],
      ['gain 0.7', 'gain 0.18', 'convolver', 'gain 1', 'gain 0.85', 'gain 1', 'destination'],
    ]);
    expect(findNode(created, 'compressor').outputs).toEqual([]);
    expect(findNode(created, 'waveshaper').outputs).toEqual([]);
    // No way round a limiter that is not there, and no delay anywhere.
    for (const n of created) {
      if (n.kind === 'delay') expect(n.outputs).toEqual([]);
    }
    // Clicks go straight out too; an export mixes its own.
    const clickBus = graph.outputDestination as unknown as StubNode;
    expect(clickBus.outputs).toEqual([destination]);
  });

  it('joins clicks after the limiter but ahead of the soft clipper', () => {
    const { context, created, destination } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const clickPath = reachable(graph.outputDestination as unknown as StubNode);
    // A click can never have the limiter turn the piano down…
    expect(clickPath.has(findNode(created, 'compressor'))).toBe(false);
    // …nor does it pass master volume or the live output gain: the bus itself
    // and the soft clipper's pre-gain are the only gains on its way…
    expect(describeRoute([...clickPath].filter((n) => n.kind === 'gain'))).toEqual([
      'gain 1',
      `gain ${1 / SOFT_CLIP_INPUT_RANGE}`,
    ]);
    // …but the soft clipper still holds the sum under full scale.
    expect(clickPath.has(findNode(created, 'waveshaper'))).toBe(true);
    expect(clickPath.has(destination)).toBe(true);
    // Held back by the limiter's look-ahead, to land with the piano.
    const lookAhead = (graph.outputDestination as unknown as StubNode).outputs[0] as StubNode & {
      delayTime: StubParam;
    };
    expect(lookAhead.kind).toBe('delay');
    expect(LIMITER_LOOKAHEAD_S).toBe(0.006);
    expect(lookAhead.delayTime.value).toBe(LIMITER_LOOKAHEAD_S);
  });

  /** The live graph's two ways from the output gain to the soft clipper. */
  function warmupPaths(created: StubNode[]) {
    const limiter = findNode(created, 'compressor');
    const outputGain = created.find((n) => n.outputs.includes(limiter)) as StubNode;
    const bypassDelay = outputGain.outputs.find((n) => n.kind === 'delay') as StubNode & {
      delayTime: StubParam;
    };
    const bypassGain = bypassDelay?.outputs[0] as StubNode & { gain: StubParam };
    const limiterGain = limiter.outputs[0] as StubNode & { gain: StubParam };
    const softClip = findNode(created, 'waveshaper');
    const preGain = created.find((n) => n.outputs.includes(softClip)) as StubNode;
    return { outputGain, bypassDelay, bypassGain, limiterGain, preGain };
  }

  it('goes round the limiter while it settles, as late and as loud as it passes the piano', () => {
    // A newly made limiter ducks for its first few hundred ms: the piano goes
    // round it meanwhile, through the look-ahead the limiter delays it by and
    // at the makeup gain it gives it, so the two ways match exactly.
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const { outputGain, bypassDelay, bypassGain, limiterGain, preGain } = warmupPaths(created);
    expect(outputGain.outputs).toHaveLength(2);
    expect(bypassDelay?.delayTime.value).toBe(LIMITER_LOOKAHEAD_S);
    expect(bypassGain.gain.value).toBeCloseTo(10 ** (LIMITER_MAKEUP_DB / 20), 10);
    expect(bypassGain.outputs).toEqual([preGain]);
    // The limiter's own way in starts shut, and both meet at the soft clipper.
    expect(limiterGain.kind).toBe('gain');
    expect(limiterGain.gain.value).toBe(0);
    expect(limiterGain.outputs).toEqual([preGain]);
  });

  it('crossfades onto the limiter once it has settled, counted on the audio clock', () => {
    // The clock stands still until the context runs, so the warm-up starts
    // with the audio, whenever the graph was made.
    const { context, created } = createStubContext({ currentTime: 3.5 });
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const { bypassGain, limiterGain } = warmupPaths(created);
    expect(LIMITER_WARMUP_S).toBe(0.35);
    expect(LIMITER_WARMUP_FADE_S).toBe(0.05);
    const settled = 3.5 + LIMITER_WARMUP_S;
    const faded = settled + LIMITER_WARMUP_FADE_S;
    const makeup = 10 ** (LIMITER_MAKEUP_DB / 20);
    expect(limiterGain.gain.events).toEqual([
      { type: 'setValueAtTime', value: 0, time: expect.closeTo(settled, 10) },
      { type: 'linearRampToValueAtTime', value: 1, time: expect.closeTo(faded, 10) },
    ]);
    expect(bypassGain.gain.events).toEqual([
      {
        type: 'setValueAtTime',
        value: expect.closeTo(makeup, 10),
        time: expect.closeTo(settled, 10),
      },
      { type: 'linearRampToValueAtTime', value: 0, time: expect.closeTo(faded, 10) },
    ]);
  });

  it('counts the look-ahead in whole frames, as the limiter does', () => {
    // A compressor delays by a whole number of frames — 264 at 44.1 kHz, not
    // 264.6 — and a DelayNode given a fraction interpolates between two,
    // dulling the top octave; the way round would then neither match the
    // limiter nor line up with it.
    const { context, created } = createStubContext({ sampleRate: 44100 });
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const delays = created.filter((n) => n.kind === 'delay') as unknown as Array<{
      delayTime: StubParam;
    }>;
    expect(delays).toHaveLength(2);
    for (const delay of delays) expect(delay.delayTime.value * 44100).toBeCloseTo(264, 9);
  });

  it('pulls the dry path back as reverb comes up', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 1, reverbMix: 0 });
    const voiceBus = graph.voiceDestination as unknown as StubNode;
    const dry = voiceBus.outputs[0] as unknown as StubNode & { gain: StubParam };
    expect(dry.gain.value).toBe(1);

    graph.setReverbMix(1);
    expect(dry.gain.value).toBeLessThan(1);
    expect(dry.gain.targets.at(-1)).toBeCloseTo(0.5, 10);

    const send = created.find(
      (n) => n.kind === 'gain' && n.outputs.some((o) => o.kind === 'convolver'),
    ) as unknown as { gain: StubParam };
    expect(send.gain.value).toBe(1);
  });

  it('disconnects every node it created on dispose', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    graph.dispose();
    for (const n of created) {
      expect(n.disconnected, `${n.kind} left connected`).toBe(true);
    }
  });
});
