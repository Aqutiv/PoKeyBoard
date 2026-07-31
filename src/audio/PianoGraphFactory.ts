/**
 * Builds the piano output graph shared by live playback and offline
 * rendering:
 *
 *   voices → voiceBus ─┬→ dry ──────────────────────→ master ┐
 *                      └→ send(gain=mix) → convolver ────────┤
 *                                                            ↓
 *              out ← softClip ← softClipInput ← limiter ← outputStage
 *
 * Non-piano sources (the metronome) join at `outputStage`, so they stay
 * independent of master volume and reverb but are still covered by the
 * clip protection.
 */
export interface PianoGraphOptions {
  masterVolume: number;
  reverbMix: number;
}

export interface PianoGraph {
  context: BaseAudioContext;
  /** Voices connect their output here. */
  voiceDestination: GainNode;
  /** Where non-piano sources join, after master volume but before the limiter. */
  outputDestination: AudioNode;
  setMasterVolume(value: number): void;
  setReverbMix(value: number): void;
  getMasterVolume(): number;
  getReverbMix(): number;
  dispose(): void;
}

/**
 * Procedural room impulse: exponentially decaying noise, lightly low-pass
 * smoothed for warmth, independent per channel. Generated locally — no
 * licensed IR asset required.
 *
 * The per-channel decorrelation used to be the *only* source of stereo width,
 * back when the samples were mono; now that they carry a real recorded image it
 * widens the room rather than manufacturing the instrument's own width.
 */
export function generateReverbImpulse(
  context: BaseAudioContext,
  seconds = 2.2,
  decayPower = 2.8,
): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(seconds * rate));
  const buffer = context.createBuffer(2, length, rate);
  let seed = (0x9e3779b9 ^ rate ^ length) >>> 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smoothed = 0;
    let peak = 0;
    for (let i = 0; i < length; i += 1) {
      const envelope = Math.pow(1 - i / length, decayPower);
      const noise = (random() * 2 - 1) * envelope;
      smoothed += 0.35 * (noise - smoothed);
      data[i] = smoothed;
      const magnitude = Math.abs(smoothed);
      if (magnitude > peak) peak = magnitude;
    }
    if (peak > 0) {
      const scale = 0.5 / peak;
      for (let i = 0; i < length; i += 1) {
        (data as Float32Array)[i] = (data[i] as number) * scale;
      }
    }
  }
  return buffer;
}

const RAMP_TC = 0.03;

/**
 * Fixed trim on the summing bus. Per-voice gain deliberately exceeds 1 — the
 * pack's `levelMatch` is applied outside `velocityGain`'s clamp — and nothing
 * attenuates by polyphony, so a pedalled fortissimo chord arrives well past
 * full scale. The bus is the one place a constant trim buys transient
 * headroom without touching the musical dynamics between notes.
 */
export const VOICE_BUS_HEADROOM = 0.7;

/** Below this input magnitude the soft clipper is exactly unity gain. */
export const SOFT_CLIP_KNEE = 0.7;

/** What the saturation approaches, leaving a little true-peak headroom. */
export const SOFT_CLIP_CEILING = 0.98;

/**
 * Input magnitude the curve's endpoint corresponds to — +12 dBFS.
 *
 * A WaveShaperNode's curve is always addressed over [-1, 1] and it *clamps*
 * anything beyond that to the endpoint value. So a curve defined directly over
 * [-1, 1] would map every overshoot to one constant, flat-topping the waveform
 * — hard clipping moved inside the graph rather than removed. Feeding the
 * shaper through 1/SOFT_CLIP_INPUT_RANGE instead stretches the curve's domain
 * over the whole range a transient can reach, and by its endpoint the transfer
 * function has genuinely saturated, so the clamp is a no-op rather than a
 * corner.
 */
export const SOFT_CLIP_INPUT_RANGE = 4;

/**
 * Final saturation stage. The compressor ahead of it has no lookahead, so the
 * first millisecond of a dense onset passes ungoverned; this bends those peaks
 * back instead of letting them hard-clip at the device.
 *
 * Identity below the knee — normal-level material is bit-for-bit untouched —
 * then a tanh bend approaching SOFT_CLIP_CEILING. Slope is continuous across
 * the knee, so there is no corner to hear. (A curve normalized to hit ±1 at its
 * endpoints would carry makeup gain below the knee and quietly undo
 * VOICE_BUS_HEADROOM, so this one deliberately does not.)
 *
 * Indices map to input magnitudes up to `inputRange`; the caller is responsible
 * for the matching 1/inputRange pre-gain.
 */
export function createSoftClipCurve(
  samples = 4096,
  knee = SOFT_CLIP_KNEE,
  ceiling = SOFT_CLIP_CEILING,
  inputRange = SOFT_CLIP_INPUT_RANGE,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
  const bend = ceiling - knee;
  for (let i = 0; i < samples; i += 1) {
    const input = ((i / (samples - 1)) * 2 - 1) * inputRange;
    const magnitude = Math.abs(input);
    curve[i] =
      magnitude <= knee
        ? input
        : Math.sign(input) * (knee + bend * Math.tanh((magnitude - knee) / bend));
  }
  return curve;
}

export function createPianoGraph(
  context: BaseAudioContext,
  options: PianoGraphOptions,
): PianoGraph {
  const voiceBus = context.createGain();
  voiceBus.gain.value = VOICE_BUS_HEADROOM;

  const master = context.createGain();
  master.gain.value = clamp01(options.masterVolume);

  const outputStage = context.createGain();
  outputStage.gain.value = 1;

  // Safety limiter: inaudible headroom guard, not a loudness effect.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.18;

  // Scales the shaper's [-1, 1] curve domain up to cover the whole range a
  // transient can reach; the curve bakes the inverse back in, so the pair is
  // unity gain end to end.
  const softClipInput = context.createGain();
  softClipInput.gain.value = 1 / SOFT_CLIP_INPUT_RANGE;
  const softClip = context.createWaveShaper();
  softClip.curve = createSoftClipCurve();
  softClip.oversample = '4x';

  // Dry is pulled back as the send comes up, so more reverb no longer means
  // strictly more level into master.
  const dryGain = context.createGain();
  dryGain.gain.value = dryGainFor(clamp01(options.reverbMix));
  const reverbSend = context.createGain();
  reverbSend.gain.value = clamp01(options.reverbMix);
  const convolver = context.createConvolver();
  convolver.buffer = generateReverbImpulse(context);
  const reverbReturn = context.createGain();
  reverbReturn.gain.value = 1;

  voiceBus.connect(dryGain);
  dryGain.connect(master);
  voiceBus.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);
  master.connect(outputStage);
  outputStage.connect(limiter);
  limiter.connect(softClipInput);
  softClipInput.connect(softClip);
  softClip.connect(context.destination);

  let masterVolume = clamp01(options.masterVolume);
  let reverbMix = clamp01(options.reverbMix);

  return {
    context,
    voiceDestination: voiceBus,
    outputDestination: outputStage,
    setMasterVolume(value: number): void {
      masterVolume = clamp01(value);
      master.gain.setTargetAtTime(masterVolume, context.currentTime, RAMP_TC);
    },
    setReverbMix(value: number): void {
      reverbMix = clamp01(value);
      reverbSend.gain.setTargetAtTime(reverbMix, context.currentTime, RAMP_TC);
      dryGain.gain.setTargetAtTime(dryGainFor(reverbMix), context.currentTime, RAMP_TC);
    },
    getMasterVolume: () => masterVolume,
    getReverbMix: () => reverbMix,
    dispose(): void {
      for (const node of [
        voiceBus,
        dryGain,
        master,
        outputStage,
        limiter,
        softClipInput,
        softClip,
        reverbSend,
        convolver,
        reverbReturn,
      ]) {
        node.disconnect();
      }
    },
  };
}

function dryGainFor(reverbMix: number): number {
  return 1 - 0.5 * clamp01(reverbMix);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
