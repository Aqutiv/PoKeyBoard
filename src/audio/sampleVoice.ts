import type { SampleSelection } from './audioTypes';

/**
 * Fade-in at the very start of a voice. Voices start just ahead of the
 * sample's own onset (see `onsetOffsetOf`), where the recording is still near
 * silence, so this only has to hide the cut — short enough to leave the
 * hammer's first milliseconds alone.
 */
export const ATTACK_S = 0.0015;
/** Damper time constant when a selection names none of its own. */
export const RELEASE_TC = 0.07;
export const RELEASE_STOP_AFTER_S = 0.6;

/**
 * The first key with no damper. On a grand the top strings are short and
 * thin enough to die away on their own, so they have none: letting go of a
 * key up there lets it ring, as if the pedal were down for that note alone.
 */
export const UNDAMPED_FROM_MIDI = 90; // F♯6

/** Damper time constants at the bottom of the keyboard and at the top of its damped range. */
const RELEASE_TC_BASS = 0.12;
const RELEASE_TC_TREBLE = 0.05;

/**
 * How fast a key's damper silences its string. Bass strings are long and
 * heavy and take noticeably longer to stop than treble ones, so the time
 * constant eases from one end of the damped range to the other.
 */
export function releaseTcFor(midi: number): number {
  const t = Math.min(1, Math.max(0, (midi - 21) / (UNDAMPED_FROM_MIDI - 21)));
  return RELEASE_TC_BASS + (RELEASE_TC_TREBLE - RELEASE_TC_BASS) * t;
}

/**
 * How fast a sounding string gives way when its key is struck again. The
 * hammer hits the same string: its new sound replaces the old one rather than
 * joining it, and two copies of one string would build up level and
 * comb-filter against each other.
 */
export const RESTRIKE_TC = 0.03;

export interface SampleVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  sample: SampleSelection;
  startTime: number;
  releaseTime?: number;
  releaseLevel?: number;
  /** The time constant of the fade in progress, where it differs from the damper's. */
  fadeTc?: number;
  /** When the source is due to stop, once a stop is scheduled. */
  stopTime?: number;
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
  source.start(when, sample.offset ?? 0);
  const voice: SampleVoice = { source, gain, sample, startTime: when };
  if (sample.envelope) {
    // A loop must eventually retire even while the key or pedal stays down.
    voice.stopTime = attackEnd + sample.envelope.hold + sample.envelope.decay;
    source.stop(voice.stopTime);
  }
  return voice;
}

function dampingTc(voice: SampleVoice): number {
  return voice.fadeTc ?? voice.sample.releaseTc ?? RELEASE_TC;
}

export function sampleVoiceLevel(voice: SampleVoice, when: number): number {
  const { sample, startTime, releaseTime, releaseLevel } = voice;
  if (releaseTime !== undefined && when >= releaseTime) {
    const elapsed = when - releaseTime;
    return (
      (releaseLevel ?? 0) *
      (sample.envelope && voice.fadeTc === undefined
        ? Math.max(0, 1 - elapsed / sample.envelope.release)
        : Math.exp(-elapsed / dampingTc(voice)))
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
  if (inAttack || inDecay || (inRelease && envelope && voice.fadeTc === undefined)) {
    voice.gain.gain.linearRampToValueAtTime(level, when);
  }
  voice.gain.gain.setValueAtTime(level, when);
  return level;
}

/**
 * Let go of a key. The damper falls — slower on a bass string than a treble
 * one — unless the string has no damper at all, in which case it rings on
 * and the sample's own end retires it.
 */
export function releaseSampleVoice(voice: SampleVoice, when: number): void {
  if (voice.sample.undamped) return;
  // Let go before a strike still to come: the damper falls as it always does,
  // and the strike silences what is left of the string when it comes.
  const struckAt =
    voice.fadeTc !== undefined && voice.releaseTime !== undefined && when < voice.releaseTime
      ? voice.releaseTime
      : undefined;
  if (struckAt !== undefined) voice.fadeTc = undefined;
  const level = holdSampleVoice(voice, when);
  voice.releaseTime = when;
  voice.releaseLevel = level;
  if (voice.sample.envelope) {
    voice.stopTime = when + voice.sample.envelope.release;
    voice.gain.gain.linearRampToValueAtTime(0, voice.stopTime);
  } else {
    const tc = dampingTc(voice);
    voice.gain.gain.setTargetAtTime(0, when, tc);
    // Eight time constants is about 70 dB down, however slow the damper.
    voice.stopTime = when + Math.max(RELEASE_STOP_AFTER_S, tc * 8);
  }
  voice.source.stop(voice.stopTime);
  if (struckAt !== undefined && stillSoundingAt(voice, struckAt)) dampSampleVoice(voice, struckAt);
}

/**
 * Silence a voice from `when` because its key is being struck again; see
 * `RESTRIKE_TC`. Works on any voice, damped or not, released or still held.
 */
export function dampSampleVoice(voice: SampleVoice, when: number): void {
  fadeSampleVoice(voice, when, RESTRIKE_TC);
  voice.stopTime = when + RESTRIKE_TC * 8;
  voice.source.stop(voice.stopTime);
}

/**
 * Fade a voice out from `when` with time constant `tc`, faster than any
 * damper, and remember doing so, so whatever touches it later reads the level
 * it really has. Stopping the source is left to the caller.
 */
export function fadeSampleVoice(voice: SampleVoice, when: number, tc: number): void {
  const level = holdSampleVoice(voice, when);
  voice.releaseTime = when;
  voice.releaseLevel = level;
  voice.fadeTc = tc;
  voice.gain.gain.setTargetAtTime(0, when, tc);
}

/**
 * Whether a key struck at `when` finds this voice's sound still to silence:
 * not stopped by then, nor already fading out under an earlier strike or a
 * stop. A key let go only just before counts: its damper takes a few tenths
 * of a second to quiet the string, too long to lay a second copy over it.
 */
export function stillSoundingAt(voice: SampleVoice, when: number): boolean {
  if (voice.stopTime !== undefined && voice.stopTime <= when) return false;
  return voice.fadeTc === undefined || voice.releaseTime === undefined || voice.releaseTime > when;
}
