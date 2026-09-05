import type { SampleSelection } from './audioTypes';

export const ATTACK_S = 0.003;
export const RELEASE_TC = 0.07;
export const RELEASE_STOP_AFTER_S = 0.6;

export interface SampleVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  sample: SampleSelection;
  startTime: number;
  releaseTime?: number;
  releaseLevel?: number;
}

/** The same source, loop coordinates, and envelope for live and offline audio. */
export function startSampleVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  sample: SampleSelection,
  when: number,
): SampleVoice {
  const source = context.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = sample.playbackRate;
  if (sample.loop) {
    source.loop = true;
    source.loopStart = sample.loop.start;
    // decodeAudioData resamples to the context rate; the last source frame can
    // round by half an output frame when a loop ends at the file boundary.
    source.loopEnd = Math.min(sample.loop.end, sample.buffer.duration);
  }
  const gain = context.createGain();
  const attackEnd = when + (sample.envelope?.attack ?? ATTACK_S);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(sample.gain, attackEnd);
  if (sample.envelope) {
    const decayStart = attackEnd + sample.envelope.hold;
    const decayEnd = decayStart + sample.envelope.decay;
    gain.gain.setValueAtTime(sample.gain, decayStart);
    gain.gain.linearRampToValueAtTime(0, decayEnd);
  }
  source.connect(gain);
  gain.connect(destination);
  source.start(when);
  if (sample.envelope) {
    // A loop must eventually retire even while the key or pedal stays down.
    source.stop(attackEnd + sample.envelope.hold + sample.envelope.decay);
  }
  return { source, gain, sample, startTime: when };
}

export function sampleVoiceLevel(voice: SampleVoice, when: number): number {
  const { sample, startTime, releaseTime, releaseLevel } = voice;
  if (releaseTime !== undefined && when >= releaseTime) {
    const elapsed = when - releaseTime;
    return (
      (releaseLevel ?? 0) *
      (sample.envelope
        ? Math.max(0, 1 - elapsed / sample.envelope.release)
        : Math.exp(-elapsed / RELEASE_TC))
    );
  }
  const elapsed = Math.max(0, when - startTime);
  const attack = sample.envelope?.attack ?? ATTACK_S;
  if (elapsed < attack) return (sample.gain * elapsed) / attack;
  if (!sample.envelope) return sample.gain;
  return (
    sample.gain *
    Math.max(0, 1 - Math.max(0, elapsed - attack - sample.envelope.hold) / sample.envelope.decay)
  );
}

/** Reconstruct interrupted ramps, including scheduled releases before playback starts. */
export function holdSampleVoice(voice: SampleVoice, when: number): number {
  const level = sampleVoiceLevel(voice, when);
  voice.gain.gain.cancelScheduledValues(when);
  const elapsed = when - voice.startTime;
  const envelope = voice.sample.envelope;
  const inAttack = elapsed >= 0 && elapsed <= (envelope?.attack ?? ATTACK_S);
  const inDecay =
    envelope &&
    elapsed > envelope.attack + envelope.hold &&
    elapsed <= envelope.attack + envelope.hold + envelope.decay;
  const inRelease = voice.releaseTime !== undefined && when >= voice.releaseTime;
  if (inAttack || inDecay || (inRelease && envelope)) {
    voice.gain.gain.linearRampToValueAtTime(level, when);
  }
  voice.gain.gain.setValueAtTime(level, when);
  return level;
}

export function releaseSampleVoice(voice: SampleVoice, when: number): void {
  const level = holdSampleVoice(voice, when);
  voice.releaseTime = when;
  voice.releaseLevel = level;
  if (voice.sample.envelope) {
    const end = when + voice.sample.envelope.release;
    voice.gain.gain.linearRampToValueAtTime(0, end);
    voice.source.stop(end);
  } else {
    voice.gain.gain.setTargetAtTime(0, when, RELEASE_TC);
    voice.source.stop(when + RELEASE_STOP_AFTER_S);
  }
}
