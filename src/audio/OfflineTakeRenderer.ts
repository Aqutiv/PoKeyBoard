import { isSilentNote, sortStrikes } from '@/domain/noteEvents';
import {
  DEFAULT_MASTER_VOLUME,
  reverbRoomOf,
  type NoteEvent,
  type ReverbRoom,
  type Take,
} from '@/domain/takeTypes';
import {
  applySustainToNotes,
  effectivePlaybackDurationMs,
} from '@/features/transport/sustainPedal';
import { ExportError } from '@/utils/errors';
import { audioEngine } from './AudioEngine';
import type { ClickTrack } from './loudness';
import { CLICK_LENGTH_S, clickBeatsForRange, scheduleClick } from './MetronomeEngine';
import type { SampleSelection } from './audioTypes';
import { createPianoGraph } from './PianoGraphFactory';
import { REVERB_ROOM_PRESETS } from './reverbImpulse';
import {
  dampSampleVoice,
  releaseSampleVoice,
  startSampleVoice,
  stillSoundingAt,
  UNDAMPED_FROM_MIDI,
  type SampleVoice,
} from './sampleVoice';

const RENDER_SAMPLE_RATE = 48_000;
/** The least ring-out after the last note: release plus the reverb tail. */
const MIN_TAIL_S = 3.0;
/** How long past its RT60 a room's tail is given, for the last of it to go. */
const TAIL_PAST_RT60_S = 0.5;
/**
 * How far ahead of an export's render its voices are made, in seconds. An
 * offline context works through every voice it holds on every render quantum,
 * whether it has started yet or not, so making a whole take's voices before the
 * render made a long take cost minutes: 22 of them in desktop Chrome for the
 * 11-minute Chopin Ballade, whose 5,162 notes seldom sound more than a dozen at
 * once. Instead the render pauses this often to make the next stretch's voices,
 * and holds only a few seconds of notes at any time.
 */
const SCHEDULE_AHEAD_S = 2;
/** Hard cap so an OfflineAudioContext cannot exhaust memory. */
export const MAX_RENDER_MINUTES = 20;
/** Above this length the export dialog shows a memory warning. */
export const RENDER_WARN_MINUTES = 8;

export interface OfflineRenderOptions {
  includeMetronome: boolean;
  metronomeVolume: number;
}

/**
 * A take rendered for export, not yet at its final level: that is set from the
 * whole of it once it exists (`masterExport`).
 */
export interface RenderedTake {
  /** The piano and its reverb, stereo, at the app's default volume. */
  piano: AudioBuffer;
  /**
   * The metronome, when asked for. Kept apart so its clicks never count
   * toward how loud the piano is; see `ClickTrack`.
   */
  clicks: ClickTrack | null;
}

/**
 * Schedule a take's notes (sorted, sustain already applied, each with its
 * sample) as voices, the way the live engine sounds them: a key struck while
 * its string still rings damps the old sound from the new note's start
 * (`VoiceManager`'s `restrike`), so a pedalled repeated note is one string, not
 * a pile of them, and the key stays down until both notes have let go
 * (`scheduleNote`). A note with no sample is left out.
 *
 * Returns a function that makes the voices of the notes starting before
 * `untilS`, carrying on from where its last call stopped: a take made a stretch
 * at a time gets the same voices as one made all at once.
 */
export function scheduleTakeVoices(
  context: BaseAudioContext,
  destination: AudioNode,
  notes: readonly { midi: number; startMs: number; durationMs: number }[],
  samples: readonly (SampleSelection | null)[],
): (untilS: number) => void {
  const sounding = new Map<number, { voice: SampleVoice; keyUp: number }>();
  let next = 0;
  return (untilS) => {
    for (; next < notes.length; next += 1) {
      const note = notes[next]!;
      const when = note.startMs / 1000;
      if (when >= untilS) return;
      const sample = samples[next];
      if (!sample) continue;
      let keyUp = when + note.durationMs / 1000;
      const previous = sounding.get(note.midi);
      // Still sounding when the key comes down again, held, dying away under its
      // damper, or never damped up where there are none: that sound gives way to
      // this one.
      if (previous && stillSoundingAt(previous.voice, when)) {
        dampSampleVoice(previous.voice, when);
        keyUp = Math.max(keyUp, previous.keyUp);
      }
      const voice = startSampleVoice(context, destination, sample, when);
      releaseSampleVoice(voice, keyUp);
      sounding.set(note.midi, { voice, keyUp });
    }
  };
}

/**
 * Make a take's voices as its render comes to them, rather than all before it
 * starts; see `SCHEDULE_AHEAD_S`. The render pauses at the start of every
 * stretch while the next stretch's voices are made, each a stretch or two
 * before it sounds: the same voices, doing the same things at the same times,
 * as all of them made up front. Where an offline context cannot pause (Firefox
 * has no `suspend`), they are all made up front, as they always were.
 *
 * Every pause is also a sure measure of how far the render has got, which it
 * hands `onProgress` as a fraction of the whole once the render is on its way
 * again. A render that cannot pause has nothing to tell it.
 *
 * Resolves once the render is past its last pause, and rejects if a voice could
 * not be made. Either way the render is let go on, so it never waits on a pause
 * that nothing will lift.
 */
export function scheduleVoicesAhead(
  context: OfflineAudioContext,
  scheduleUntil: (untilS: number) => void,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  scheduleUntil(2 * SCHEDULE_AHEAD_S);
  if (typeof context.suspend !== 'function') {
    scheduleUntil(Number.POSITIVE_INFINITY);
    return Promise.resolve();
  }
  const seconds = context.length / context.sampleRate;
  const pauses: Promise<void>[] = [];
  for (let stretch = 1; stretch * SCHEDULE_AHEAD_S < seconds; stretch += 1) {
    const at = stretch * SCHEDULE_AHEAD_S;
    pauses.push(
      context.suspend(at).then(
        () => {
          try {
            scheduleUntil(at + 2 * SCHEDULE_AHEAD_S);
          } finally {
            void context.resume();
          }
          onProgress?.(at / seconds);
        },
        // Refused as it was asked for, long before the render gets there: make
        // every voice still to come now instead.
        () => scheduleUntil(Number.POSITIVE_INFINITY),
      ),
    );
  }
  return Promise.all(pauses).then(() => undefined);
}

/** A take's notes that sound: all but those written and not played (`isSilentNote`). */
function playedNotesOf(take: Pick<Take, 'notes'>): NoteEvent[] {
  return take.notes.filter((note) => !isSilentNote(note));
}

/**
 * A take's notes as an export strikes them. One written but not played is left
 * out (`playedNotesOf`), so it can neither sound nor damp its key nor lengthen
 * the ring-out; the pedal is applied; and they come in strike order, so of two
 * copies of a key struck together the louder is the one heard.
 */
export function notesToRender(take: Pick<Take, 'notes' | 'pedalEvents'>): NoteEvent[] {
  return sortStrikes(applySustainToNotes(playedNotesOf(take), take.pedalEvents));
}

/**
 * When the last string with no damper falls quiet on its own, in seconds. Up
 * there a key rings until its recording ends, however soon it was let go, so a
 * take ending on one sounds for longer than its last key-up says.
 */
export function undampedRingOutSeconds(
  notes: readonly { midi: number; velocity: number; startMs: number }[],
  sampleFor: (midi: number, velocity: number) => SampleSelection | null,
): number {
  let end = 0;
  for (const note of notes) {
    if (note.midi < UNDAMPED_FROM_MIDI) continue;
    const sample = sampleFor(note.midi, note.velocity);
    if (!sample?.undamped) continue;
    const ring = (sample.buffer.duration - (sample.offset ?? 0)) / sample.playbackRate;
    end = Math.max(end, note.startMs / 1000 + ring);
  }
  return end;
}

/**
 * How long an export rings on after its last note, in seconds: three seconds,
 * which covers the release and every room up to Room, or for a longer room its
 * RT60 and half a second more, by when its tail has fallen past 60 dB.
 */
export function renderTailSeconds(room: ReverbRoom): number {
  return Math.max(MIN_TAIL_S, REVERB_ROOM_PRESETS[room].rt60S + TAIL_PAST_RT60_S);
}

/**
 * How long an export renders, in seconds: past the take's last key-up by the
 * room's tail (`renderTailSeconds`), or until its top strings fall quiet if
 * they ring on longer — those it plays, as `notesToRender` has them. Reads the
 * samples decoded so far.
 */
export function estimateRenderSeconds(take: Take): number {
  const sampleFor = (midi: number, velocity: number) => audioEngine.bank.getSample(midi, velocity);
  return renderSeconds(take, undampedRingOutSeconds(playedNotesOf(take), sampleFor));
}

function renderSeconds(take: Take, ringOutS: number): number {
  return (
    Math.max(effectivePlaybackDurationMs(take) / 1000, ringOutS) +
    renderTailSeconds(reverbRoomOf(take.instrument))
  );
}

/**
 * The seconds a render allocates, given how long the take's top strings ring
 * (`undampedRingOutSeconds`): never past the cap, which is what bounds the
 * memory a render takes. A take just inside it can still ring past it.
 */
export function cappedRenderSeconds(take: Take, ringOutS: number): number {
  return Math.min(renderSeconds(take, ringOutS), MAX_RENDER_MINUTES * 60);
}

/** Rough working-set estimate (render buffer + PCM copy for encoding). */
export function estimateRenderMemoryMB(take: Take): number {
  const samples = estimateRenderSeconds(take) * RENDER_SAMPLE_RATE * 2;
  return Math.round((samples * 4 * 2) / 1_000_000);
}

/**
 * Render a take through the same sample bank, graph shape, and envelope
 * constants as live playback, in the take's own reverb room. Two things
 * differ, both about level: the piano plays at the default volume rather than
 * wherever the volume slider was left — that slider is for the listener's
 * room, not the file — and without the graph's live peak guard, which a
 * limiter that can look ahead replaces afterwards.
 *
 * `onProgress` hears how far the render has got, from 0 to 1, each time it
 * pauses; see `scheduleVoicesAhead`.
 */
export async function renderTakeForExport(
  take: Take,
  options: OfflineRenderOptions,
  onProgress?: (fraction: number) => void,
): Promise<RenderedTake> {
  // The take itself has to fit; how long its top strings ring is capped below.
  const seconds = renderSeconds(take, 0);
  if (seconds > MAX_RENDER_MINUTES * 60) {
    throw new ExportError(
      `Take too long to render (${Math.round(seconds / 60)} min)`,
      `This take is longer than ${MAX_RENDER_MINUTES} minutes — export is capped to protect memory.`,
      'exportTooLong',
    );
  }
  if (take.notes.length === 0) {
    throw new ExportError(
      'Cannot export an empty take',
      'Record some notes before exporting.',
      'exportEmpty',
    );
  }

  // A piano chosen a moment ago may still be decoding while the previous one
  // plays on; the take is stamped with the new one, and renders on it.
  await audioEngine.whenSwitchSettled();
  const effectiveNotes = notesToRender(take);
  // Make sure every root the played notes need is decoded (range shifts etc.).
  // A note written but not played needs none, so it cannot widen the range.
  if (effectiveNotes.length > 0) {
    let minMidi = 127;
    let maxMidi = 0;
    for (const note of effectiveNotes) {
      if (note.midi < minMidi) minMidi = note.midi;
      if (note.midi > maxMidi) maxMidi = note.midi;
    }
    await audioEngine.ensurePlayableRange(minMidi, maxMidi, { remember: false });
  }
  const sampleFor = (midi: number, velocity: number) => audioEngine.bank.getSample(midi, velocity);
  // Every sample is chosen before the render starts, though most voices are
  // made during it: the piano a render begins with is the one it ends with.
  const samples = effectiveNotes.map((note) => sampleFor(note.midi, note.velocity));
  const missingSamples = samples.filter((sample) => !sample).length;
  if (missingSamples > 0) {
    throw new ExportError(
      `${missingSamples} notes had no decoded sample`,
      'The piano is still loading — try the export again in a moment.',
      'exportPianoLoading',
    );
  }
  const ringOut = undampedRingOutSeconds(effectiveNotes, sampleFor);
  const length = Math.ceil(cappedRenderSeconds(take, ringOut) * RENDER_SAMPLE_RATE);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length,
    sampleRate: RENDER_SAMPLE_RATE,
  });

  const graph = createPianoGraph(context, {
    masterVolume: DEFAULT_MASTER_VOLUME,
    reverbMix: take.instrument.reverbMix,
    reverbRoom: reverbRoomOf(take.instrument),
    peakGuard: false,
  });
  const scheduling = scheduleVoicesAhead(
    context,
    scheduleTakeVoices(context, graph.voiceDestination, effectiveNotes, samples),
    onProgress,
  );

  const [piano, clicks] = await Promise.all([
    context.startRendering(),
    options.includeMetronome ? renderClickTrack(take, options.metronomeVolume) : null,
    scheduling,
  ]);
  return { piano, clicks };
}

/** The take's clicks, and the two sounds they are made of; see `ClickTrack`. */
async function renderClickTrack(take: Take, volume: number): Promise<ClickTrack> {
  const render = async (accent: boolean): Promise<Float32Array> => {
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: Math.ceil(CLICK_LENGTH_S * RENDER_SAMPLE_RATE),
      sampleRate: RENDER_SAMPLE_RATE,
    });
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    scheduleClick(context, gain, 0, accent);
    return (await context.startRendering()).getChannelData(0);
  };
  const beats = clickBeatsForRange(take.tempo, 0, effectivePlaybackDurationMs(take));
  const [accentSound, beatSound] = await Promise.all([render(true), render(false)]);
  return {
    atS: Float64Array.from(beats, (beat) => beat.atS),
    accent: Uint8Array.from(beats, (beat) => (beat.accent ? 1 : 0)),
    accentSound,
    beatSound,
  };
}
