import type { ReverbRoom } from '@/domain/takeTypes';

/**
 * The reverb's rooms, as impulses made here rather than recorded — no licensed
 * impulse to ship, and every room is the same few lines of arithmetic.
 *
 * A room answers a note the way real ones do. First comes a moment of silence
 * while the sound crosses to the nearest surface: the pre-delay. Then a
 * handful of distinct early reflections off the surfaces around it, which the
 * ear fuses with the note itself and hears as the size of the space. Then the
 * tail, too dense to hear as echoes, dying away exponentially — sooner in the
 * treble than in the bass, since air and soft surfaces soak high frequencies
 * up first. Each side of the stereo image gets its own reflections and its own
 * tail, so the room is as wide as the speakers.
 *
 * The impulse is normalised here, the way a ConvolverNode would do it itself,
 * and then trimmed per room (`trimDb`), so the graph turns the browser's own
 * normalisation off.
 */
export interface ReverbRoomPreset {
  /** Silence before the room first answers, in seconds: its first reflection. */
  preDelayS: number;
  /** Seconds for the tail's low band to fall 60 dB: the room's reverberation time. */
  rt60S: number;
  /** The same for the high band, above `REVERB_CROSSOVER_HZ`: always sooner. */
  rt60HighS: number;
  /** How many early reflections there are. */
  earlyReflections: number;
  /** When the last of them has arrived, on both sides. */
  earlyEndS: number;
  /** The share of the impulse's energy they carry. */
  earlyShare: number;
  /** How long the tail takes to build up to full density after the pre-delay. */
  buildUpS: number;
  /** Corner of the gentle low-pass that stands for air absorption. */
  airHz: number;
  /** Level on top of the spec's normalisation, in dB. See REVERB_ROOM_PRESETS. */
  trimDb: number;
}

/**
 * The rooms, smallest first. Bigger rooms answer later, gather their tails more
 * slowly, and absorb more of the treble on the way.
 *
 * The spec's normalisation leaves an impulse's RMS the same whatever its
 * length, so on its own a longer room would carry more energy and a darker one
 * more of it where a piano plays; the trims set each room's level instead.
 *
 * Room's gives it the energy of the impulse the app played through before
 * there were rooms — 2.2 s of noise under a power-law envelope, normalised by
 * the browser — so a take keeps the amount of reverb it was made with: 0.38 dB
 * makes up for its being shorter, and 0.06 dB for browsers calibrating to
 * −58 dB where the spec says 0.00125 (see `specNormalizationScale`).
 *
 * The others are set for the same wetness at the same mix, which is not quite
 * the same thing as the same energy. What arrives within 80 ms of the note the
 * ear fuses with the note and hears as its body; what comes later it hears as
 * reverb. Equal energy would leave the Studio, which has less of its energy
 * late, audibly drier than Room, and equal late energy would make it loud and
 * boxy. So each is trimmed halfway between, in dB: the mean of a piano's whole
 * wet energy and of its part after 80 ms is the same in every room. Each is
 * then within 1.5 dB of Room on both counts — the Studio a little more body
 * and a little less tail, the Cathedral the other way round, on top of lasting
 * longer. A piano's wet energy here is measured over the first 30 s of every
 * track in the library; see AUDIO_EXPORT.md for the figures.
 */
export const REVERB_ROOM_PRESETS: Readonly<Record<ReverbRoom, ReverbRoomPreset>> = {
  studio: {
    preDelayS: 0.01,
    rt60S: 0.8,
    rt60HighS: 0.5,
    earlyReflections: 6,
    earlyEndS: 0.03,
    earlyShare: 0.3,
    buildUpS: 0.01,
    airHz: 6000,
    trimDb: 6.94,
  },
  room: {
    preDelayS: 0.015,
    rt60S: 2,
    rt60HighS: 1.2,
    earlyReflections: 8,
    earlyEndS: 0.045,
    earlyShare: 0.2,
    buildUpS: 0.02,
    airHz: 4000,
    trimDb: 0.44,
  },
  hall: {
    preDelayS: 0.02,
    rt60S: 2.8,
    rt60HighS: 1.6,
    earlyReflections: 8,
    earlyEndS: 0.06,
    earlyShare: 0.15,
    buildUpS: 0.03,
    airHz: 3500,
    trimDb: -2.32,
  },
  cathedral: {
    preDelayS: 0.025,
    rt60S: 4.5,
    rt60HighS: 2.2,
    earlyReflections: 10,
    earlyEndS: 0.075,
    earlyShare: 0.1,
    buildUpS: 0.04,
    airHz: 3000,
    trimDb: -5.55,
  },
};

/** Where the tail splits into the two bands that die away at their own rates. */
export const REVERB_CROSSOVER_HZ = 1500;

/**
 * The longest impulse any room makes, in seconds. Convolving costs more the
 * longer the impulse, and a phone has to keep up with it live, so the
 * Cathedral's decay stops here.
 */
export const MAX_REVERB_IMPULSE_S = 4.5;

/** The last moments of an impulse fade out rather than stop. */
const FADE_OUT_S = 0.05;

/** 60 dB, as the natural log of an amplitude ratio. */
const LN_1000 = Math.log(1000);

/** The far side hears a reflection this much later at most. */
const MAX_FAR_DELAY_S = 0.0008;

/** The Web Audio spec's `calculateNormalizationScale` constants. */
const GAIN_CALIBRATION = 0.00125;
const GAIN_CALIBRATION_SAMPLE_RATE = 44100;
const MIN_POWER = 0.000125;

/**
 * What a ConvolverNode with `normalize` on multiplies its impulse by, as the
 * Web Audio spec defines it (`calculateNormalizationScale`): one over the RMS
 * of every sample of every channel — with a floor, so near silence is not
 * blown up — times a calibration meant to leave a typical room about as loud
 * as the sound going into it, and scaled down at higher sample rates. (It also
 * halves a four-channel, true-stereo impulse, which these never are.) Chrome
 * calibrates to −58 dB, 0.0012589, where the spec says 0.00125 — 0.06 dB more,
 * measured — and Firefox and Safari share its code.
 */
export function specNormalizationScale(
  channels: readonly Float32Array[],
  sampleRate: number,
): number {
  let power = 0;
  let frames = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i += 1) power += (data[i] as number) ** 2;
    frames = data.length;
  }
  power = Math.sqrt(power / (channels.length * frames));
  if (!Number.isFinite(power) || power < MIN_POWER) power = MIN_POWER;
  return (GAIN_CALIBRATION / power) * (GAIN_CALIBRATION_SAMPLE_RATE / sampleRate);
}

/** One early reflection, as the room's surfaces send it back. */
export interface EarlyReflection {
  /** When it reaches the near side, in seconds after the note. */
  timeS: number;
  /** The side it comes from: 0 left, 1 right. They take turns. */
  channel: 0 | 1;
  /** Its level, relative to the room's other reflections. */
  gain: number;
  /** How much later the far side hears it, and at what fraction of the level. */
  farDelayS: number;
  farGain: number;
}

/**
 * A room's early reflections, the same at every sample rate. The first of them
 * ends the pre-delay; the rest are spread to the end of the room's window, each
 * nudged off an even spacing so that they never fall into a regular pattern,
 * which would ring at a pitch of its own. They come from alternate sides and
 * reach the other ear a fraction of a millisecond later and fainter, as a
 * reflection off a side wall does, and each is fainter than the last, as the
 * tail is.
 */
export function earlyReflections(room: ReverbRoom): EarlyReflection[] {
  const preset = REVERB_ROOM_PRESETS[room];
  const random = xorshift32(seedFor(`${room}:early`));
  const count = preset.earlyReflections;
  const span = preset.earlyEndS - MAX_FAR_DELAY_S - preset.preDelayS;
  const reflections: EarlyReflection[] = [];
  for (let k = 0; k < count; k += 1) {
    const slot = k === 0 ? 0 : Math.min(1, (k + (random() - 0.5) * 0.8) / (count - 1));
    const timeS = preset.preDelayS + span * slot;
    const decay = Math.exp((-LN_1000 * (timeS - preset.preDelayS)) / preset.rt60S);
    reflections.push({
      timeS,
      channel: k % 2 === 0 ? 0 : 1,
      gain: decay * (0.7 + 0.3 * random()),
      farDelayS: 0.0002 + (MAX_FAR_DELAY_S - 0.0002) * random(),
      farGain: 0.6,
    });
  }
  return reflections;
}

/** The impulse's length in frames: until its tail has fallen 60 dB, within the cap. */
export function reverbImpulseLength(room: ReverbRoom, sampleRate: number): number {
  const { preDelayS, rt60S } = REVERB_ROOM_PRESETS[room];
  return Math.round(Math.min(MAX_REVERB_IMPULSE_S, preDelayS + rt60S) * sampleRate);
}

/**
 * Make a room's stereo impulse at a sample rate. Seeded by both, so it comes
 * out the same every time: an export renders through exactly the reverb the
 * previous one did. Another rate is another impulse, drawn afresh rather than
 * resampled, since each is only ever heard at its own.
 *
 * The tail is seeded noise split by a one-pole crossover into a low band and
 * its complement, each decaying exponentially at its own rate, so the tail
 * darkens as it dies; the two add back to plain noise wherever they are level.
 * It swells in over the room's build-up after the pre-delay. The early
 * reflections are single samples on top, as loud together as the room's share
 * of the energy says, and everything then passes through one gentle low-pass
 * for the air. The longest, the Cathedral at 48 kHz, takes some 15 ms.
 */
export function renderReverbImpulse(room: ReverbRoom, sampleRate: number): Float32Array[] {
  const preset = REVERB_ROOM_PRESETS[room];
  const length = reverbImpulseLength(room, sampleRate);
  const start = Math.round(preset.preDelayS * sampleRate);
  const channels = [new Float32Array(length), new Float32Array(length)];
  const crossover = onePoleCoefficient(REVERB_CROSSOVER_HZ, sampleRate);
  const air = onePoleCoefficient(preset.airHz, sampleRate);
  const lowStep = Math.exp(-LN_1000 / (preset.rt60S * sampleRate));
  const highStep = Math.exp(-LN_1000 / (preset.rt60HighS * sampleRate));
  const buildUp = Math.max(1, Math.round(preset.buildUpS * sampleRate));

  let tailEnergy = 0;
  channels.forEach((data, channel) => {
    const random = xorshift32(seedFor(`${room}:${sampleRate}:${channel}`));
    let low = 0;
    let lowLevel = 1;
    let highLevel = 1;
    let warm = 0;
    for (let i = start; i < length; i += 1) {
      const noise = random() * 2 - 1;
      low += crossover * (noise - low);
      const age = i - start;
      const onset = age < buildUp ? Math.sin((Math.PI / 2) * (age / buildUp)) ** 2 : 1;
      warm += air * (onset * (low * lowLevel + (noise - low) * highLevel) - warm);
      data[i] = warm;
      tailEnergy += warm * warm;
      lowLevel *= lowStep;
      highLevel *= highStep;
    }
  });

  // A single sample through the air's one-pole rings as a(1 − a)^n, whose
  // energy sums to a / (2 − a); that is what sets the reflections' share.
  const reflections = earlyReflections(room);
  const spikeEnergy = air / (2 - air);
  let reflectionEnergy = 0;
  for (const { gain, farGain } of reflections) {
    reflectionEnergy += gain ** 2 * (1 + farGain ** 2) * spikeEnergy;
  }
  const reflectionScale = Math.sqrt(
    ((preset.earlyShare / (1 - preset.earlyShare)) * tailEnergy) / reflectionEnergy,
  );
  for (const { timeS, channel, gain, farDelayS, farGain } of reflections) {
    const level = gain * reflectionScale;
    addSpike(channels[channel] as Float32Array, Math.round(timeS * sampleRate), level, air);
    addSpike(
      channels[1 - channel] as Float32Array,
      Math.round((timeS + farDelayS) * sampleRate),
      level * farGain,
      air,
    );
  }

  const fade = Math.min(length - start, Math.round(FADE_OUT_S * sampleRate));
  for (const data of channels) {
    for (let i = 1; i <= fade; i += 1) {
      data[length - i] = (data[length - i] as number) * Math.sin((Math.PI / 2) * (i / fade)) ** 2;
    }
  }

  const scale = specNormalizationScale(channels, sampleRate) * 10 ** (preset.trimDb / 20);
  for (const data of channels) {
    for (let i = 0; i < length; i += 1) data[i] = (data[i] as number) * scale;
  }
  return channels;
}

const impulses = new Map<string, readonly Float32Array[]>();

/**
 * A room's impulse at a sample rate, made once and kept: switching back to a
 * room, or exporting in the room being played, costs nothing. Shared, so
 * never written to.
 */
export function reverbImpulse(room: ReverbRoom, sampleRate: number): readonly Float32Array[] {
  const key = `${room}@${sampleRate}`;
  let impulse = impulses.get(key);
  if (!impulse) {
    impulse = renderReverbImpulse(room, sampleRate);
    impulses.set(key, impulse);
  }
  return impulse;
}

/** The coefficient of a one-pole low-pass with its corner at `hz`. */
function onePoleCoefficient(hz: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

/** A single sample of `level` at `index`, as the air's one-pole passes it on. */
function addSpike(data: Float32Array, index: number, level: number, air: number): void {
  let value = level * air;
  for (let i = index; i < data.length && Math.abs(value) > Math.abs(level) * 1e-9; i += 1) {
    data[i] = (data[i] as number) + value;
    value *= 1 - air;
  }
}

/** xorshift32, the generator the reverb has always drawn its noise from. */
function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/** FNV-1a: a seed from a name, the same on every platform and every build. */
function seedFor(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
