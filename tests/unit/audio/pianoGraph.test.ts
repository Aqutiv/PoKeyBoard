import { describe, expect, it } from 'vitest';
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
  setTargetAtTime(value: number, when: number, tc: number): void;
}

function param(initial = 0): StubParam {
  return {
    value: initial,
    targets: [],
    setTargetAtTime(value) {
      this.targets.push(value);
      this.value = value;
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

function createStubContext() {
  const created: StubNode[] = [];
  const track = <T extends StubNode>(n: T): T => {
    created.push(n);
    return n;
  };
  const destination = node('destination', {});
  const context = {
    currentTime: 0,
    sampleRate: 48000,
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

  it('configures the limiter with limiting rather than compression settings', () => {
    const { context, created } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor') as unknown as Record<string, StubParam>;
    expect(limiter.threshold?.value).toBe(-6);
    expect(limiter.knee?.value).toBe(3);
    expect(limiter.ratio?.value).toBe(20);
    expect(limiter.attack?.value).toBe(0.001);
    expect(limiter.release?.value).toBe(0.18);
  });

  it('ends in an oversampled soft clipper feeding the destination', () => {
    const { context, created, destination } = createStubContext();
    createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const limiter = findNode(created, 'compressor');
    const softClip = findNode(created, 'waveshaper') as unknown as StubNode & {
      curve: Float32Array | null;
      oversample: string;
    };
    // The pre-gain that maps the curve's domain onto the real signal range.
    const preGain = limiter.outputs[0] as unknown as StubNode & { gain: StubParam };
    expect(preGain.gain.value).toBeCloseTo(1 / SOFT_CLIP_INPUT_RANGE, 10);
    expect(preGain.outputs).toContain(softClip);
    expect(softClip.outputs).toContain(destination);
    expect(softClip.oversample).toBe('4x');
    expect(softClip.curve?.length).toBeGreaterThan(0);
    // Nothing else reaches the device directly.
    const directToDestination = created.filter((n) => n.outputs.includes(destination));
    expect(directToDestination).toEqual([softClip]);
  });

  it('exposes an output stage that bypasses master volume but not the limiter', () => {
    const { context, created } = createStubContext();
    const graph = createPianoGraph(context, { masterVolume: 0.85, reverbMix: 0.18 });
    const outputStage = graph.outputDestination as unknown as StubNode;
    const limiter = findNode(created, 'compressor');
    expect(outputStage.outputs).toContain(limiter);
    // master feeds the stage; the stage is not the master itself.
    const master = created.find(
      (n) => n.kind === 'gain' && n.outputs.includes(outputStage),
    ) as unknown as { gain: StubParam } | undefined;
    expect(master?.gain.value).toBe(0.85);
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
