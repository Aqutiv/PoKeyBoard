import {
  LIMITER_ATTACK_S,
  LIMITER_KNEE_DB,
  LIMITER_LOOKAHEAD_S,
  LIMITER_MAKEUP_DB,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  LIMITER_WARMUP_FADE_S,
  LIMITER_WARMUP_S,
  LIVE_OUTPUT_GAIN_DB,
} from './gainStaging';

/**
 * Builds the piano output graph shared by live playback and offline
 * rendering:
 *
 *   voices → voiceBus ─┬→ dry ──────────────────────→ master ┐
 *                      └→ send(gain=mix) → convolver ────────┤
 *                                                            ↓
 *              ┌─ limiterGain ← limiter ←─────────── outputGain
 *              │                                         ↓
 *              ├─ bypassGain ← bypassDelay ←─────────────┘
 *              ↓
 *     out ← softClip ← softClipInput ← lookAhead ← clickBus ← metronome
 *
 * The piano is set to its live level by the output gain and the limiter's
 * makeup, and held by the limiter; `gainStaging.ts` has the levels, and why.
 * For its first moments a newly made limiter ducks everything, so the piano
 * goes round it until it has settled — through `bypassDelay` and `bypassGain`,
 * which match the limiter's delay and makeup — and then crossfades onto it
 * (`LIMITER_WARMUP_S`). Non-piano sources (the metronome) join at `clickBus`,
 * past master volume, reverb and the limiter: a click is independent of the
 * piano's volume, never turns the piano down, and is still covered by the
 * soft clipper.
 */
export interface PianoGraphOptions {
  masterVolume: number;
  reverbMix: number;
  /**
   * Whether the graph guards its own peaks, with the limiter and soft clipper
   * above; on unless said otherwise. Live playback has to, since it cannot see
   * a peak coming. An export turns it off: its level is set once the whole
   * take is rendered, and its peaks are held by a limiter that looks ahead
   * (`loudness.ts`), which a compressor already squeezing them would defeat.
   * Without the guard there is no stage at all: `outputGain` is unity and
   * goes straight out, and so does `clickBus`.
   */
  peakGuard?: boolean;
}

export interface PianoGraph {
  context: BaseAudioContext;
  /** Voices connect their output here. */
  voiceDestination: GainNode;
  /**
   * Where non-piano sources join: after master volume and reverb, and after
   * the limiter, so a click never turns the piano down; before the soft
   * clipper, which still holds the sum under full scale.
   */
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

/**
 * Below this input magnitude the soft clipper is exactly unity gain. Just under
 * the ceiling, and over what the limiter lets out of even the densest chords:
 * what it bends is only what gets past the limiter — a click on a loud chord,
 * or a chord in the moment before the limiter has settled.
 */
export const SOFT_CLIP_KNEE = 0.95;

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
 * Final saturation stage. The limiter ahead of it reacts within a millisecond
 * or so, but not instantly — the first moments of a dense onset can pass
 * ungoverned — and the metronome joins after the limiter, so a click can land
 * on top of a loud chord; this bends those peaks back instead of letting them
 * hard-clip at the device.
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
  const peakGuard = options.peakGuard ?? true;

  const voiceBus = context.createGain();
  voiceBus.gain.value = VOICE_BUS_HEADROOM;

  const master = context.createGain();
  master.gain.value = clamp01(options.masterVolume);

  // The piano's level into the stage, after master volume: the live output
  // gain, or unity for an export, whose level is set once it is all rendered.
  const outputGain = context.createGain();
  outputGain.gain.value = peakGuard ? 10 ** (LIVE_OUTPUT_GAIN_DB / 20) : 1;

  // Where the metronome joins.
  const clickBus = context.createGain();
  clickBus.gain.value = 1;

  // Safety limiter for dense chords, not a loudness effect: most notes on
  // their own stay under it. Its automatic makeup gain still lifts everything
  // it passes, which `LIMITER_MAKEUP_DB` accounts for.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_THRESHOLD_DB;
  limiter.knee.value = LIMITER_KNEE_DB;
  limiter.ratio.value = LIMITER_RATIO;
  limiter.attack.value = LIMITER_ATTACK_S;
  limiter.release.value = LIMITER_RELEASE_S;

  // The limiter delays the piano by its look-ahead, in whole frames; the
  // clicks, which skip it, are held back as long, so a click still lands with
  // the note it is on. (A DelayNode asked for a fraction of a frame would
  // interpolate between two, and dull the top octave.)
  const lookAheadS = Math.floor(LIMITER_LOOKAHEAD_S * context.sampleRate) / context.sampleRate;
  const lookAhead = context.createDelay(LIMITER_LOOKAHEAD_S);
  lookAhead.delayTime.value = lookAheadS;

  // The way round the limiter while it settles (`LIMITER_WARMUP_S`): as late
  // as the limiter makes the piano, and as loud as the settled limiter passes
  // it, so the crossfade from one to the other cannot be heard. Meanwhile only
  // the soft clipper guards the peaks — for well under a second, at the start
  // of a session.
  const limiterGain = context.createGain();
  const bypassDelay = context.createDelay(LIMITER_LOOKAHEAD_S);
  bypassDelay.delayTime.value = lookAheadS;
  const bypassGain = context.createGain();

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
  master.connect(outputGain);
  if (peakGuard) {
    // Round the limiter until it has settled, then across onto it. Counted on
    // the audio clock, which stands still until the context first runs.
    const makeup = 10 ** (LIMITER_MAKEUP_DB / 20);
    const settled = context.currentTime + LIMITER_WARMUP_S;
    const crossed = settled + LIMITER_WARMUP_FADE_S;
    limiterGain.gain.value = 0;
    limiterGain.gain.setValueAtTime(0, settled);
    limiterGain.gain.linearRampToValueAtTime(1, crossed);
    bypassGain.gain.value = makeup;
    bypassGain.gain.setValueAtTime(makeup, settled);
    bypassGain.gain.linearRampToValueAtTime(0, crossed);

    outputGain.connect(limiter);
    limiter.connect(limiterGain);
    limiterGain.connect(softClipInput);
    outputGain.connect(bypassDelay);
    bypassDelay.connect(bypassGain);
    bypassGain.connect(softClipInput);
    clickBus.connect(lookAhead);
    lookAhead.connect(softClipInput);
    softClipInput.connect(softClip);
    softClip.connect(context.destination);
  } else {
    outputGain.connect(context.destination);
    clickBus.connect(context.destination);
  }

  let masterVolume = clamp01(options.masterVolume);
  let reverbMix = clamp01(options.reverbMix);

  return {
    context,
    voiceDestination: voiceBus,
    outputDestination: clickBus,
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
        outputGain,
        clickBus,
        limiter,
        limiterGain,
        bypassDelay,
        bypassGain,
        lookAhead,
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
