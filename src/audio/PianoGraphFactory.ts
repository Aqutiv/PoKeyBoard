import { DEFAULT_REVERB_ROOM, type ReverbRoom } from '@/domain/takeTypes';
import {
  LIMITER_ATTACK_S,
  LIMITER_KNEE_DB,
  LIMITER_LOOKAHEAD_S,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  LIMITER_WARMUP_RELEASE_S,
  LIMITER_WARMUP_S,
  LIVE_OUTPUT_GAIN_DB,
} from './gainStaging';
import { reverbImpulse } from './reverbImpulse';

/**
 * Builds the piano output graph shared by live playback and offline
 * rendering:
 *
 *   voices → voiceBus ─┬→ dry ─────────────────────────────────→ master ┐
 *                      └→ send(gain=mix) → convolver(room) → return ────┤
 *                                                                       ↓
 *                                              limiter ← outputGain ←───┘
 *                                                 ↓
 *                out ← softClip ← softClipInput ←─┤
 *                                                 ↑
 *                metronome → clickBus → lookAhead ┘
 *
 * The convolver holds the impulse of one room (reverbImpulse.ts); the return
 * is where switching to another ducks it (`REVERB_SWITCH_S`).
 *
 * The piano is set to its live level by the output gain and the limiter's
 * makeup, and held by the limiter; `gainStaging.ts` has the levels, and why.
 * A newly made limiter ducks everything for a moment, so it starts out with
 * a fast release, which gets it over that within a few tens of milliseconds,
 * easing to its own over the first 40 ms (`LIMITER_WARMUP_S`); nothing goes
 * round it meanwhile. Non-piano sources (the metronome) join at `clickBus`,
 * past master volume, reverb and the limiter: a click is independent of the
 * piano's volume, never turns the piano down, and is still covered by the
 * soft clipper.
 */
export interface PianoGraphOptions {
  masterVolume: number;
  reverbMix: number;
  /** The room the reverb models; Room unless said otherwise. */
  reverbRoom?: ReverbRoom;
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
  /** Move the reverb to another room; see `REVERB_SWITCH_S`. */
  setReverbRoom(room: ReverbRoom): void;
  getMasterVolume(): number;
  getReverbMix(): number;
  /** The room asked for last, even while the switch to it is still under way. */
  getReverbRoom(): ReverbRoom;
  dispose(): void;
}

/**
 * A room's impulse as a buffer at the context's own sample rate, which a
 * ConvolverNode insists on. The samples are made once per room and rate
 * (`reverbImpulse`) and copied in; they arrive already normalised, so the
 * convolver they go to must have `normalize` off. The per-channel
 * decorrelation widens the room, not the instrument: the samples carry their
 * own recorded stereo image.
 */
export function generateReverbImpulse(context: BaseAudioContext, room: ReverbRoom): AudioBuffer {
  const channels = reverbImpulse(room, context.sampleRate);
  const buffer = context.createBuffer(
    channels.length,
    (channels[0] as Float32Array).length,
    context.sampleRate,
  );
  channels.forEach((data, channel) => buffer.getChannelData(channel).set(data));
  return buffer;
}

/**
 * A convolver holding a room's impulse. `normalize` goes off before the
 * impulse goes in, since the browser normalises as the buffer is set, and the
 * impulse is normalised already, the spec's way with its room's trim on top
 * (reverbImpulse.ts).
 */
function convolverFor(context: BaseAudioContext, room: ReverbRoom): ConvolverNode {
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = generateReverbImpulse(context, room);
  return convolver;
}

/**
 * How long a room switch takes to duck the reverb out, and then to bring it
 * back in the new room.
 *
 * A switch builds a convolver for the new room first, while the old one plays
 * on: making the impulse and handing it over — the browser works out the
 * convolution's FFTs as it takes it — is up to 40 ms of main-thread work for
 * the Cathedral, and done while the reverb was ducked it would leave a hole
 * that long. Only then is the reverb ducked, the new convolver put in the old
 * one's place, and the reverb brought back. The old room fades rather than
 * stopping dead mid-sound, and the new one builds from what is played next;
 * the dry piano is untouched throughout.
 *
 * This rather than crossfading the two: a crossfade would run both at once for
 * as long as it lasted — and a quick run of switches more than two — and a
 * phone may not keep up with two long convolutions. It would also hear little
 * better: a new convolver has heard none of what came before either way, so
 * the old room's tail goes within the fade whichever way the two are joined.
 */
export const REVERB_SWITCH_S = 0.02;

const RAMP_TC = 0.03;

/**
 * Fixed trim on the summing bus. A voice's gain can exceed 1 — the velocity
 * calibration lifts a quietly recorded sample to its target, and the loudest
 * voice peaks at about 1.5 (`loudestVoicePeak`) — and nothing attenuates by
 * polyphony, so a pedalled fortissimo chord arrives well past full scale. The
 * bus is the one place a constant trim buys transient headroom without
 * touching the musical dynamics between notes.
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

  // The limiter delays the piano by its look-ahead, a whole number of frames;
  // the clicks, which skip it, are held back exactly as long, so a click still
  // lands with the note it is on. (A DelayNode asked for a fraction of a frame
  // would interpolate between two, and dull the top octave.)
  const lookAheadS = Math.floor(LIMITER_LOOKAHEAD_S * context.sampleRate) / context.sampleRate;
  const lookAhead = context.createDelay(LIMITER_LOOKAHEAD_S);
  lookAhead.delayTime.value = lookAheadS;

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
  // The room asked for last, and the room of the convolver in place.
  let reverbRoom = options.reverbRoom ?? DEFAULT_REVERB_ROOM;
  let convolver = convolverFor(context, reverbRoom);
  let convolverRoom = reverbRoom;
  // Where a room switch ducks the reverb; at rest it is unity.
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
    // Warm start: the limiter recovers from its birth at the warm-up release,
    // which eases to its own over the warm-up. The one path stays in place
    // throughout — nothing is switched in or out, and the limiter holds loud
    // chords from the start — only how fast it lets go changes. Counted on the
    // audio clock, which stands still until the context first runs. A ramp
    // runs from the event before it, and with none, where it starts is up to
    // the browser, so its start is set as an event of its own.
    limiter.release.value = LIMITER_WARMUP_RELEASE_S;
    limiter.release.setValueAtTime(LIMITER_WARMUP_RELEASE_S, context.currentTime);
    limiter.release.exponentialRampToValueAtTime(
      LIMITER_RELEASE_S,
      context.currentTime + LIMITER_WARMUP_S,
    );

    outputGain.connect(limiter);
    limiter.connect(softClipInput);
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

  // A room switch in progress: the convolver built for the room asked for last,
  // unless that is the room already in place; the timer that puts it in once
  // the duck is over; and when, on the audio clock, it is over.
  let next: ConvolverNode | null = null;
  let swapTimer: ReturnType<typeof setTimeout> | null = null;
  let swapAtS = 0;

  const putInPlace = (replacement: ConvolverNode) => {
    reverbSend.disconnect(convolver);
    convolver.disconnect();
    reverbSend.connect(replacement);
    replacement.connect(reverbReturn);
    convolver = replacement;
    convolverRoom = reverbRoom;
    next = null;
  };

  // Timers run on the page's clock and the duck on the audio's, which can lag
  // it, so the swap waits for the audio to be past the duck — unless the audio
  // has stopped, when nothing is sounding to be cut off. Only the room asked
  // for last goes in, so a quick run of switches swaps once.
  const swapWhenDucked = () => {
    swapTimer = null;
    if (context.state === 'running' && context.currentTime < swapAtS) {
      swapTimer = setTimeout(swapWhenDucked, Math.max(1, (swapAtS - context.currentTime) * 1000));
      return;
    }
    if (next) putInPlace(next);
    const now = context.currentTime;
    reverbReturn.gain.cancelScheduledValues(now);
    reverbReturn.gain.setValueAtTime(0, now);
    reverbReturn.gain.linearRampToValueAtTime(1, now + REVERB_SWITCH_S);
  };

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
    setReverbRoom(room: ReverbRoom): void {
      if (room === reverbRoom) return;
      reverbRoom = room;
      // The costly part, done while the old room still plays; nothing to build
      // on the way back to the room already in place.
      next = room === convolverRoom ? null : convolverFor(context, room);
      const now = context.currentTime;
      if (context.state !== 'running') {
        // Nothing is sounding, so there is nothing to duck: swap now, and put
        // back a return some earlier switch may have left ducked.
        if (swapTimer !== null) {
          clearTimeout(swapTimer);
          swapTimer = null;
          reverbReturn.gain.cancelScheduledValues(now);
          reverbReturn.gain.setValueAtTime(1, now);
        }
        if (next) putInPlace(next);
        return;
      }
      // Already ducking: the swap to come puts this room in instead.
      if (swapTimer !== null) return;
      // From wherever the return stands, which is short of unity if the last
      // switch is still bringing it back.
      reverbReturn.gain.cancelScheduledValues(now);
      reverbReturn.gain.setValueAtTime(reverbReturn.gain.value, now);
      reverbReturn.gain.linearRampToValueAtTime(0, now + REVERB_SWITCH_S);
      swapAtS = now + REVERB_SWITCH_S;
      swapTimer = setTimeout(swapWhenDucked, REVERB_SWITCH_S * 1000);
    },
    getMasterVolume: () => masterVolume,
    getReverbMix: () => reverbMix,
    getReverbRoom: () => reverbRoom,
    dispose(): void {
      if (swapTimer !== null) clearTimeout(swapTimer);
      swapTimer = null;
      next = null;
      for (const node of [
        voiceBus,
        dryGain,
        master,
        outputGain,
        clickBus,
        limiter,
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
