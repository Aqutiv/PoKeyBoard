import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compressorMakeupDb,
  LIMITER_LOOKAHEAD_S,
  LIMITER_MAKEUP_DB,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  LIMITER_WARMUP_RELEASE_S,
  LIMITER_WARMUP_S,
  LIVE_OUTPUT_GAIN_DB,
} from '@/audio/gainStaging';
import {
  createPianoGraph,
  createSoftClipCurve,
  REVERB_SWITCH_LOOKAHEAD_S,
  REVERB_SWITCH_S,
  SOFT_CLIP_CEILING,
  SOFT_CLIP_INPUT_RANGE,
  SOFT_CLIP_KNEE,
  VOICE_BUS_HEADROOM,
} from '@/audio/PianoGraphFactory';
import { reverbImpulse } from '@/audio/reverbImpulse';
import type { ReverbRoom } from '@/domain/takeTypes';

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
  /** From one target, or from everything. */
  disconnect(target?: StubNode): void;
}

interface StubParam {
  value: number;
  targets: number[];
  /** Automation scheduled for later, in order; `value` is left as it was. */
  events: Array<{ type: string; value: number; time: number }>;
  setTargetAtTime(value: number, when: number, tc: number): void;
  setValueAtTime(value: number, when: number): void;
  linearRampToValueAtTime(value: number, when: number): void;
  exponentialRampToValueAtTime(value: number, when: number): void;
  cancelScheduledValues(when: number): void;
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
    cancelScheduledValues(time) {
      this.events.push({ type: 'cancelScheduledValues', value: NaN, time });
    },
    setValueAtTime(value, time) {
      this.events.push({ type: 'setValueAtTime', value, time });
    },
    linearRampToValueAtTime(value, time) {
      this.events.push({ type: 'linearRampToValueAtTime', value, time });
    },
    exponentialRampToValueAtTime(value, time) {
      this.events.push({ type: 'exponentialRampToValueAtTime', value, time });
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
    disconnect(target?: StubNode) {
      if (target) {
        this.outputs = this.outputs.filter((output) => output !== target);
        return;
      }
      this.outputs = [];
      this.disconnected = true;
    },
    ...extra,
  } as StubNode & T;
}

/**
 * A convolver that remembers, each time it is handed an impulse, whether it was
 * told to normalise it: the browser applies `normalize` as the buffer is set,
 * so the order the two are set in is what counts.
 */
interface StubConvolver extends StubNode {
  normalize: boolean;
  buffer: StubBuffer | null;
  normalizeAtEachBuffer: boolean[];
}

interface StubBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function convolver(): StubConvolver {
  const stub = node('convolver', { normalize: true, normalizeAtEachBuffer: [] as boolean[] });
  let buffer: StubBuffer | null = null;
  Object.defineProperty(stub, 'buffer', {
    get: () => buffer,
    set(value: StubBuffer | null) {
      buffer = value;
      stub.normalizeAtEachBuffer.push(stub.normalize);
    },
  });
  return stub as StubConvolver;
}

function createStubContext({
  currentTime = 0,
  sampleRate = 48000,
  state = 'running' as AudioContextState,
} = {}) {
  const created: StubNode[] = [];
  const track = <T extends StubNode>(n: T): T => {
    created.push(n);
    return n;
  };
  const destination = node('destination', {});
  const context = {
    currentTime,
    sampleRate,
    state,
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
    createConvolver: () => track(convolver()),
    createBuffer: (channels: number, length: number, rate: number): StubBuffer => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: (channel: number) => data[channel] as Float32Array,
      };
    },
  };
  return { context: context as unknown as BaseAudioContext, created, destination, raw: context };
}

/** Every convolver the graph has built, the first one included. */
function convolvers(created: StubNode[]): StubConvolver[] {
  return created.filter((n) => n.kind === 'convolver') as StubConvolver[];
}

/** The send, which feeds the convolver in place and nothing else. */
function reverbSend(created: StubNode[]): StubNode {
  const send = created.find(
    (n) => n.kind === 'gain' && n.outputs.some((o) => o.kind === 'convolver'),
  );
  if (!send) throw new Error('nothing feeds a convolver');
  return send;
}

/** The convolver the reverb is playing through. */
function activeConvolver(created: StubNode[]): StubConvolver {
  const fed = reverbSend(created).outputs.filter((o) => o.kind === 'convolver');
  expect(fed).toHaveLength(1);
  return fed[0] as StubConvolver;
}

/** The gain the reverb comes back through, which a room switch ducks. */
function reverbReturn(created: StubNode[]): StubNode & { gain: StubParam } {
  return activeConvolver(created).outputs[0] as StubNode & { gain: StubParam };
}

/**
 * The value a stub param's automation gives at `timeS`, read the way the Web
 * Audio spec reads its event list: each event goes in after any at the same
 * time, a cancel drops every event at or after its time, a set holds from its
 * time, and a linear ramp runs from the event before it to its own value at
 * its own time. `value` plays no part, as it plays none in what is rendered.
 */
function automatedValue(param: StubParam, timeS: number, intrinsic = 1): number {
  const timeline: StubParam['events'] = [];
  for (const event of param.events) {
    if (event.type === 'cancelScheduledValues') {
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        if ((timeline[i] as { time: number }).time >= event.time) timeline.splice(i, 1);
      }
      continue;
    }
    let at = timeline.length;
    while (at > 0 && (timeline[at - 1] as { time: number }).time > event.time) at -= 1;
    timeline.splice(at, 0, event);
  }
  let value = intrinsic;
  let since = Number.NEGATIVE_INFINITY;
  for (const event of timeline) {
    if (event.time <= timeS) {
      value = event.value;
      since = event.time;
    } else if (event.type === 'linearRampToValueAtTime' && since > Number.NEGATIVE_INFINITY) {
      return value + ((event.value - value) * (timeS - since)) / (event.time - since);
    } else {
      return value;
    }
  }
  return value;
}

/**
 * How steeply a param's automation moves at its steepest over [fromS, toS],
 * sampled every tenth of a millisecond, against a switch's own ramp: full scale
 * over `REVERB_SWITCH_S`. More than 1 is a jump.
 */
function steepest(param: StubParam, fromS: number, toS: number): number {
  const stepS = 0.0001;
  const steps = Math.round((toS - fromS) / stepS);
  let most = 0;
  let previous = automatedValue(param, fromS);
  for (let i = 1; i <= steps; i += 1) {
    const value = automatedValue(param, fromS + i * stepS);
    most = Math.max(most, (Math.abs(value - previous) * REVERB_SWITCH_S) / stepS);
    previous = value;
  }
  return most;
}

/** Whether a stub buffer holds exactly the room's impulse at the context's rate. */
function holdsImpulse(buffer: StubBuffer | null, room: ReverbRoom, sampleRate: number): boolean {
  if (!buffer) return false;
  const impulse = reverbImpulse(room, sampleRate);
  return (
    buffer.numberOfChannels === impulse.length &&
    buffer.sampleRate === sampleRate &&
    impulse.every((data, channel) => {
      const held = buffer.getChannelData(channel);
      return held.length === data.length && held.every((sample, i) => sample === data[i]);
    })
  );
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
    // knee, and it climbs only a twentieth as fast as its input from there:
    // even 30 dB over the threshold — a dense chord at the worst-case gain is
    // some 25 dB — it is still clear of the clipper, steady state.
    const limiterLetsOut = (overDb: number) =>
      10 ** ((LIMITER_THRESHOLD_DB + overDb / 20 + LIMITER_MAKEUP_DB) / 20);
    expect(limiterLetsOut(0)).toBeLessThan(0.75);
    expect(limiterLetsOut(30)).toBeLessThan(SOFT_CLIP_KNEE - 0.05);
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
    expect(limiter.threshold?.value).toBe(-6);
    expect(limiter.knee?.value).toBe(0);
    expect(limiter.ratio?.value).toBe(20);
    expect(limiter.attack?.value).toBe(0.001);
    // The release it settles at, once warmed up.
    expect(LIMITER_RELEASE_S).toBe(0.3);
    expect(limiter.release?.events.at(-1)?.value).toBe(LIMITER_RELEASE_S);
  });

  it('sets the piano to the live output gain, after master and ahead of the limiter', () => {
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor');
    const feeding = created.filter((n) => n.outputs.includes(limiter));
    expect(feeding).toHaveLength(1);
    const outputGain = feeding[0] as StubNode & { gain: StubParam };
    expect(LIVE_OUTPUT_GAIN_DB).toBe(-0.52);
    expect(outputGain.gain.value).toBeCloseTo(10 ** (LIVE_OUTPUT_GAIN_DB / 20), 10);
    const master = created.find((n) => n.outputs.includes(outputGain)) as unknown as {
      gain: StubParam;
    };
    expect(master.gain.value).toBe(0.85);
  });

  it("counts the limiter's own makeup gain: the spec's formula, for a hard knee", () => {
    // Full scale in comes out at the threshold plus a twentieth of the way
    // back up, −5.7 dB; the makeup is that loss to the power 0.6.
    expect(compressorMakeupDb(-6, 20)).toBeCloseTo(3.42, 10);
    expect(compressorMakeupDb(-2, 20)).toBeCloseTo(1.14, 10);
    expect(compressorMakeupDb(0, 20)).toBeCloseTo(0, 10);
    expect(LIMITER_MAKEUP_DB).toBe(compressorMakeupDb(-6, 20));
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
    const limiter = findNode(created, 'compressor') as StubNode & { release: StubParam };
    expect(limiter.outputs).toEqual([]);
    expect(limiter.release.events).toEqual([]);
    expect(findNode(created, 'waveshaper').outputs).toEqual([]);
    // No delay anywhere.
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

  it('has the piano go through the limiter alone, from its first sound on', () => {
    // No way round it and nothing switched in or out while it warms up: a
    // loud chord is limited from the very start like any other.
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor');
    const outputGain = created.find((n) => n.outputs.includes(limiter)) as StubNode;
    expect(outputGain.outputs).toEqual([limiter]);
    const softClip = findNode(created, 'waveshaper');
    const preGain = created.find((n) => n.outputs.includes(softClip)) as StubNode;
    expect(limiter.outputs).toEqual([preGain]);
    // The only delay is the clicks' look-ahead.
    const delays = created.filter((n) => n.kind === 'delay');
    expect(delays).toHaveLength(1);
    expect(reachable(outputGain).has(delays[0] as StubNode)).toBe(false);
  });

  it('eases a newly made limiter from a fast release to its own, on the audio clock', () => {
    // A DynamicsCompressorNode is born ducking and recovers at its release
    // rate, so it is born with a fast one, eased to its own over the warm-up.
    // The clock stands still until the context runs, so the warm-up starts
    // with the audio, whenever the graph was made. The ramp is anchored by an
    // event of its own: a ramp runs from the event before it, and with none,
    // where it starts is up to the browser.
    const { context, created } = createStubContext({ currentTime: 3.5 });
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor') as StubNode & { release: StubParam };
    expect(LIMITER_WARMUP_RELEASE_S).toBe(0.001);
    expect(LIMITER_WARMUP_S).toBe(0.04);
    expect(limiter.release.value).toBe(LIMITER_WARMUP_RELEASE_S);
    expect(limiter.release.events).toEqual([
      { type: 'setValueAtTime', value: LIMITER_WARMUP_RELEASE_S, time: 3.5 },
      {
        type: 'exponentialRampToValueAtTime',
        value: LIMITER_RELEASE_S,
        time: expect.closeTo(3.5 + LIMITER_WARMUP_S, 10),
      },
    ]);
  });

  it('counts the look-ahead in whole frames, as the limiter does', () => {
    // A compressor delays by a whole number of frames — 264 at 44.1 kHz, not
    // 264.6 — and a DelayNode given a fraction interpolates between two,
    // dulling the top octave: the clicks would neither land with the piano
    // nor sound as they should.
    const { context, created } = createStubContext({ sampleRate: 44100 });
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const delays = created.filter((n) => n.kind === 'delay') as unknown as Array<{
      delayTime: StubParam;
    }>;
    expect(delays).toHaveLength(1);
    expect((delays[0] as { delayTime: StubParam }).delayTime.value * 44100).toBeCloseTo(264, 9);
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

describe('reverb rooms', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands the convolver an impulse already normalised, the browser’s normalisation off', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const convolver = activeConvolver(created);
    expect(convolver.normalize).toBe(false);
    // Off before the impulse arrives: the browser normalises as it is set.
    expect(convolver.normalizeAtEachBuffer).toEqual([false]);
    expect(holdsImpulse(convolver.buffer, 'room', 48000)).toBe(true);
    expect(graph.getReverbRoom()).toBe('room');
  });

  it('starts in the room it is given, at the context’s own rate', () => {
    const { context, created } = createStubContext({ sampleRate: 44100 });
    const graph = createPianoGraph(context, {
      masterVolume: 0.85,
      reverbMix: 0.18,
      reverbRoom: 'cathedral',
    });
    expect(holdsImpulse(activeConvolver(created).buffer, 'cathedral', 44100)).toBe(true);
    expect(graph.getReverbRoom()).toBe('cathedral');
  });

  it('switches room by ducking the reverb, swapping the convolver, and bringing it back', () => {
    vi.useFakeTimers();
    const { context, created, raw } = createStubContext({ currentTime: 2 });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const old = activeConvolver(created);
    const back = reverbReturn(created);

    graph.setReverbRoom('hall');
    expect(graph.getReverbRoom()).toBe('hall');
    // The new room's convolver is ready before the duck begins — the costly
    // part, done while the old room still plays — normalisation off first…
    const hall = convolvers(created)[1] as StubConvolver;
    expect(holdsImpulse(hall.buffer, 'hall', 48000)).toBe(true);
    expect(hall.normalizeAtEachBuffer).toEqual([false]);
    expect(hall.outputs).toEqual([]);
    // …then the reverb is taken down to nothing over a switch's length, begun a
    // lookahead after the audio clock, while the old room goes on sounding
    // under it.
    expect(REVERB_SWITCH_S).toBe(0.02);
    expect(REVERB_SWITCH_LOOKAHEAD_S).toBe(0.02);
    expect(automatedValue(back.gain, 2.02)).toBeCloseTo(1, 10);
    expect(automatedValue(back.gain, 2.03)).toBeCloseTo(0.5, 10);
    expect(automatedValue(back.gain, 2.04)).toBeCloseTo(0, 10);
    expect(activeConvolver(created)).toBe(old);

    raw.currentTime = 2.045;
    vi.advanceTimersByTime(100);
    expect(activeConvolver(created)).toBe(hall);
    expect(hall.outputs).toEqual([back]);
    expect(old.disconnected).toBe(true);
    // Back up over a switch's length, begun a lookahead after the swap.
    expect(automatedValue(back.gain, 2.065)).toBeCloseTo(0, 10);
    expect(automatedValue(back.gain, 2.075)).toBeCloseTo(0.5, 10);
    expect(automatedValue(back.gain, 2.085)).toBeCloseTo(1, 10);
    expect(steepest(back.gain, 2, 2.2)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('swaps only once the audio clock is past the duck, however soon the page gets there', () => {
    vi.useFakeTimers();
    const { context, created, raw } = createStubContext({ currentTime: 5 });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    graph.setReverbRoom('studio'); // down by 5.04

    raw.currentTime = 5.03;
    vi.advanceTimersByTime(200);
    expect(holdsImpulse(activeConvolver(created).buffer, 'room', 48000)).toBe(true);

    raw.currentTime = 5.05;
    vi.advanceTimersByTime(200);
    expect(holdsImpulse(activeConvolver(created).buffer, 'studio', 48000)).toBe(true);
  });

  it('settles a quick run of switches on the last room, swapping once', () => {
    vi.useFakeTimers();
    const { context, created, raw } = createStubContext({ currentTime: 1 });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    graph.setReverbRoom('studio');
    graph.setReverbRoom('hall');
    graph.setReverbRoom('cathedral');
    expect(graph.getReverbRoom()).toBe('cathedral');

    raw.currentTime = 1.1;
    vi.advanceTimersByTime(200);
    expect(holdsImpulse(activeConvolver(created).buffer, 'cathedral', 48000)).toBe(true);
    // The rooms passed through on the way were never played through.
    const [, studio, hall] = convolvers(created) as StubConvolver[];
    expect(studio?.outputs).toEqual([]);
    expect(hall?.outputs).toEqual([]);
    for (const convolver of convolvers(created)) {
      expect(convolver.normalizeAtEachBuffer).toEqual([false]);
    }
    expect(reverbReturn(created).gain.events.at(-1)).toMatchObject({ value: 1 });
  });

  it('comes back to the room it was leaving when asked to mid-duck', () => {
    vi.useFakeTimers();
    const { context, created, raw } = createStubContext({ currentTime: 1 });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const room = activeConvolver(created);
    graph.setReverbRoom('hall');
    graph.setReverbRoom('room');
    expect(graph.getReverbRoom()).toBe('room');

    raw.currentTime = 1.1;
    vi.advanceTimersByTime(200);
    expect(activeConvolver(created)).toBe(room);
    expect(reverbReturn(created).gain.events.at(-1)).toMatchObject({
      type: 'linearRampToValueAtTime',
      value: 1,
    });
  });

  it('swaps at once while no audio runs, with nothing to duck', () => {
    vi.useFakeTimers();
    const { context, created } = createStubContext({ state: 'suspended' });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    graph.setReverbRoom('hall');
    expect(holdsImpulse(activeConvolver(created).buffer, 'hall', 48000)).toBe(true);
    expect(reverbReturn(created).gain.events).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the reverb alone when asked for the room it is in', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    graph.setReverbRoom('room');
    expect(reverbReturn(created).gain.events).toEqual([]);
    expect(convolvers(created)).toHaveLength(1);
  });

  it('abandons a pending swap when disposed', () => {
    vi.useFakeTimers();
    const { context, created, raw } = createStubContext({ currentTime: 1 });
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const [room] = convolvers(created) as [StubConvolver];
    graph.setReverbRoom('hall');
    graph.dispose();
    raw.currentTime = 2;
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(room.disconnected).toBe(true);
    expect((convolvers(created)[1] as StubConvolver).outputs).toEqual([]);
  });

  /**
   * Where a switch finds the return, it has to start from, and nothing already
   * under way may be changed before the switch's own ramp begins: whatever
   * renders before then has to go on as it was. An AudioParam's `value` is no
   * guide to where a ramp stands — some browsers give its intrinsic value,
   * others the last render quantum's — so each of these sets the stub's
   * `value` somewhere else, and a duck that read it would start there. Each
   * checks the automation itself, and that it never moves faster than a
   * switch's ramp: a jump anywhere is a click.
   */
  describe('switching again while a switch is under way', () => {
    it('keeps ducking when a switch comes during the duck, and swaps once', () => {
      vi.useFakeTimers();
      const { context, created, raw } = createStubContext({ currentTime: 1 });
      const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      const back = reverbReturn(created);
      graph.setReverbRoom('hall'); // down from 1.02 to 1.04
      const ducking = back.gain.events.length;

      raw.currentTime = 1.03; // halfway down
      back.gain.value = 0.9;
      graph.setReverbRoom('cathedral');
      // The duck under way carries on as it was.
      expect(back.gain.events).toHaveLength(ducking);

      raw.currentTime = 1.045;
      vi.advanceTimersByTime(100);
      expect(holdsImpulse(activeConvolver(created).buffer, 'cathedral', 48000)).toBe(true);
      // The Hall was built but never played through, and the return went down
      // once and came back up once, from 1.065 to 1.085.
      expect((convolvers(created)[1] as StubConvolver).outputs).toEqual([]);
      expect(automatedValue(back.gain, 1.03)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 1.065)).toBeCloseTo(0, 10);
      expect(automatedValue(back.gain, 1.075)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 1.085)).toBeCloseTo(1, 10);
      expect(steepest(back.gain, 1, 1.2)).toBeLessThanOrEqual(1 + 1e-6);
    });

    it('keeps waiting when a switch comes while the swap waits for the audio clock', () => {
      vi.useFakeTimers();
      const { context, created, raw } = createStubContext({ currentTime: 1 });
      const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      const back = reverbReturn(created);
      graph.setReverbRoom('hall'); // down by 1.04
      const ducking = back.gain.events.length;

      // The page's timer comes due while the audio is still ducking.
      raw.currentTime = 1.035;
      vi.advanceTimersByTime(45);
      expect(holdsImpulse(activeConvolver(created).buffer, 'room', 48000)).toBe(true);
      back.gain.value = 0.9;
      graph.setReverbRoom('studio');
      expect(back.gain.events).toHaveLength(ducking);

      raw.currentTime = 1.041;
      vi.advanceTimersByTime(25);
      expect(holdsImpulse(activeConvolver(created).buffer, 'studio', 48000)).toBe(true);
      expect(convolvers(created)).toHaveLength(3);
      expect(automatedValue(back.gain, 1.061)).toBeCloseTo(0, 10);
      expect(automatedValue(back.gain, 1.081)).toBeCloseTo(1, 10);
      expect(steepest(back.gain, 1, 1.2)).toBeLessThanOrEqual(1 + 1e-6);
    });

    it('ducks a switch made during the fade-in from where the fade-in has got to', () => {
      vi.useFakeTimers();
      const { context, created, raw } = createStubContext({ currentTime: 2 });
      const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      const back = reverbReturn(created);
      graph.setReverbRoom('hall');
      raw.currentTime = 2.045;
      vi.advanceTimersByTime(100); // swapped at 2.045, back up from 2.065 to 2.085

      // The next switch's duck begins a lookahead on, at 2.07: a quarter of the
      // way back up.
      raw.currentTime = 2.05;
      back.gain.value = 0.7;
      graph.setReverbRoom('cathedral');
      expect(automatedValue(back.gain, 2.07)).toBeCloseTo(0.25, 10);
      expect(automatedValue(back.gain, 2.08)).toBeCloseTo(0.125, 10);
      expect(automatedValue(back.gain, 2.09)).toBeCloseTo(0, 10);
      // Up to then, the fade-in goes on as it was.
      expect(automatedValue(back.gain, 2.065)).toBeCloseTo(0, 10);
      expect(automatedValue(back.gain, 2.0675)).toBeCloseTo(0.125, 10);
      expect(steepest(back.gain, 2, 2.1)).toBeLessThanOrEqual(1 + 1e-6);

      // Swapped once that duck is over, and brought back up from nothing.
      raw.currentTime = 2.095;
      vi.advanceTimersByTime(100);
      expect(holdsImpulse(activeConvolver(created).buffer, 'cathedral', 48000)).toBe(true);
      expect(automatedValue(back.gain, 2.115)).toBeCloseTo(0, 10);
      expect(automatedValue(back.gain, 2.125)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 2.135)).toBeCloseTo(1, 10);
      expect(steepest(back.gain, 2, 2.2)).toBeLessThanOrEqual(1 + 1e-6);
    });

    it('ducks from full at rest, and from full again once the fade-in is over', () => {
      vi.useFakeTimers();
      const { context, created, raw } = createStubContext({ currentTime: 1 });
      const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      const back = reverbReturn(created);
      back.gain.value = 0.4;
      graph.setReverbRoom('hall');
      expect(automatedValue(back.gain, 1.02)).toBeCloseTo(1, 10);
      expect(automatedValue(back.gain, 1.03)).toBeCloseTo(0.5, 10);

      raw.currentTime = 1.045;
      vi.advanceTimersByTime(100); // back up from 1.065, full at 1.085
      expect(automatedValue(back.gain, 1.085)).toBeCloseTo(1, 10);
      expect(automatedValue(back.gain, 1.3)).toBe(1);

      raw.currentTime = 1.5;
      back.gain.value = 0.2;
      graph.setReverbRoom('studio');
      expect(automatedValue(back.gain, 1.3)).toBe(1);
      expect(automatedValue(back.gain, 1.52)).toBeCloseTo(1, 10);
      expect(automatedValue(back.gain, 1.53)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 1.54)).toBeCloseTo(0, 10);
      expect(steepest(back.gain, 1, 1.6)).toBeLessThanOrEqual(1 + 1e-6);
    });

    it('brings the return back up, never jumping, when a switch finds the audio stopped', () => {
      vi.useFakeTimers();
      const { context, created, raw } = createStubContext({ currentTime: 1 });
      const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
      const back = reverbReturn(created);
      graph.setReverbRoom('hall'); // down from 1.02 to 1.04

      // Halfway down the audio stops — the page is hidden, say — and a switch
      // comes: the new room goes straight in, with nothing sounding to duck.
      raw.currentTime = 1.03;
      raw.state = 'suspended';
      back.gain.value = 0.9;
      graph.setReverbRoom('cathedral');
      expect(holdsImpulse(activeConvolver(created).buffer, 'cathedral', 48000)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      // Once the audio runs again the duck goes on to its end, and the return
      // comes back up from there rather than jumping to full.
      expect(automatedValue(back.gain, 1.03)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 1.05)).toBeCloseTo(0, 10);
      expect(automatedValue(back.gain, 1.06)).toBeCloseTo(0.5, 10);
      expect(automatedValue(back.gain, 1.07)).toBeCloseTo(1, 10);
      expect(steepest(back.gain, 1, 1.1)).toBeLessThanOrEqual(1 + 1e-6);
    });
  });
});
