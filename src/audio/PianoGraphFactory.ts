/**
 * Builds the piano output graph shared by live playback and offline
 * rendering:
 *
 *   voices → voiceBus ─┬────────────────────────→ master → limiter → out
 *                      └→ send(gain=mix) → convolver → master
 */
export interface PianoGraphOptions {
  masterVolume: number;
  reverbMix: number;
}

export interface PianoGraph {
  context: BaseAudioContext;
  /** Voices connect their output here. */
  voiceDestination: GainNode;
  setMasterVolume(value: number): void;
  setReverbMix(value: number): void;
  getMasterVolume(): number;
  getReverbMix(): number;
  dispose(): void;
}

/**
 * Procedural room impulse: exponentially decaying noise, lightly low-pass
 * smoothed for warmth, independent per channel for natural stereo width.
 * Generated locally — no licensed IR asset required.
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

export function createPianoGraph(
  context: BaseAudioContext,
  options: PianoGraphOptions,
): PianoGraph {
  const voiceBus = context.createGain();
  voiceBus.gain.value = 1;

  const master = context.createGain();
  master.gain.value = clamp01(options.masterVolume);

  // Safety limiter: inaudible headroom guard, not a loudness effect.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;

  const reverbSend = context.createGain();
  reverbSend.gain.value = clamp01(options.reverbMix);
  const convolver = context.createConvolver();
  convolver.buffer = generateReverbImpulse(context);
  const reverbReturn = context.createGain();
  reverbReturn.gain.value = 1;

  voiceBus.connect(master);
  voiceBus.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);
  master.connect(limiter);
  limiter.connect(context.destination);

  let masterVolume = clamp01(options.masterVolume);
  let reverbMix = clamp01(options.reverbMix);

  return {
    context,
    voiceDestination: voiceBus,
    setMasterVolume(value: number): void {
      masterVolume = clamp01(value);
      master.gain.setTargetAtTime(masterVolume, context.currentTime, RAMP_TC);
    },
    setReverbMix(value: number): void {
      reverbMix = clamp01(value);
      reverbSend.gain.setTargetAtTime(reverbMix, context.currentTime, RAMP_TC);
    },
    getMasterVolume: () => masterVolume,
    getReverbMix: () => reverbMix,
    dispose(): void {
      for (const node of [voiceBus, master, limiter, reverbSend, convolver, reverbReturn]) {
        node.disconnect();
      }
    },
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
