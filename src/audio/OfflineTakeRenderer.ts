import { sortNotes } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';
import {
  applySustainToNotes,
  effectivePlaybackDurationMs,
} from '@/features/transport/sustainPedal';
import { ExportError } from '@/utils/errors';
import { audioEngine } from './AudioEngine';
import { scheduleClicksForRange } from './MetronomeEngine';
import type { SampleSelection } from './audioTypes';
import { createPianoGraph } from './PianoGraphFactory';
import {
  dampSampleVoice,
  releaseSampleVoice,
  startSampleVoice,
  stillSoundingAt,
  UNDAMPED_FROM_MIDI,
  type SampleVoice,
} from './sampleVoice';

const RENDER_SAMPLE_RATE = 48_000;
/** Ring-out after the last note: release plus the reverb tail. */
const TAIL_S = 3.0;
/** Hard cap so an OfflineAudioContext cannot exhaust memory. */
export const MAX_RENDER_MINUTES = 20;
/** Above this length the export dialog shows a memory warning. */
export const RENDER_WARN_MINUTES = 8;

export interface OfflineRenderOptions {
  includeMetronome: boolean;
  metronomeVolume: number;
}

/**
 * Schedule a whole take's notes (sorted, sustain already applied) as voices,
 * the way the live engine sounds them: a key struck while its string still
 * rings damps the old sound from the new note's start (`VoiceManager`'s
 * `restrike`), so a pedalled repeated note is one string, not a pile of them,
 * and the key stays down until both notes have let go (`scheduleNote`).
 * Returns how many notes had no decoded sample.
 */
export function scheduleTakeVoices(
  context: BaseAudioContext,
  destination: AudioNode,
  notes: readonly { midi: number; velocity: number; startMs: number; durationMs: number }[],
  sampleFor: (midi: number, velocity: number) => SampleSelection | null,
): number {
  let missing = 0;
  const sounding = new Map<number, { voice: SampleVoice; keyUp: number }>();
  for (const note of notes) {
    const sample = sampleFor(note.midi, note.velocity);
    if (!sample) {
      missing += 1;
      continue;
    }
    const when = note.startMs / 1000;
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
  return missing;
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
 * How long an export renders, in seconds: past the take's last key-up by the
 * tail, or until its top strings fall quiet if they ring on longer. Reads the
 * samples decoded so far.
 */
export function estimateRenderSeconds(take: Take): number {
  const sampleFor = (midi: number, velocity: number) => audioEngine.bank.getSample(midi, velocity);
  return renderSeconds(take, undampedRingOutSeconds(take.notes, sampleFor));
}

function renderSeconds(take: Take, ringOutS: number): number {
  return Math.max(effectivePlaybackDurationMs(take) / 1000, ringOutS) + TAIL_S;
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
 * constants as live playback, into a stereo AudioBuffer. Normalizes only
 * when the peak would clip; musical dynamics are never flattened.
 */
export async function renderTakeToBuffer(
  take: Take,
  options: OfflineRenderOptions,
): Promise<AudioBuffer> {
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

  // Make sure every root the take needs is decoded (range shifts etc.).
  let minMidi = 127;
  let maxMidi = 0;
  for (const note of take.notes) {
    if (note.midi < minMidi) minMidi = note.midi;
    if (note.midi > maxMidi) maxMidi = note.midi;
  }
  await audioEngine.ensurePlayableRange(minMidi, maxMidi, { remember: false });

  const effectiveNotes = sortNotes(applySustainToNotes(take.notes, take.pedalEvents));
  const sampleFor = (midi: number, velocity: number) => audioEngine.bank.getSample(midi, velocity);
  const ringOut = undampedRingOutSeconds(effectiveNotes, sampleFor);
  const length = Math.ceil(cappedRenderSeconds(take, ringOut) * RENDER_SAMPLE_RATE);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length,
    sampleRate: RENDER_SAMPLE_RATE,
  });

  const graph = createPianoGraph(context, {
    masterVolume: take.instrument.masterVolume,
    reverbMix: take.instrument.reverbMix,
  });

  const missingSamples = scheduleTakeVoices(
    context,
    graph.voiceDestination,
    effectiveNotes,
    sampleFor,
  );
  if (missingSamples > 0) {
    throw new ExportError(
      `${missingSamples} notes had no decoded sample`,
      'The piano is still loading — try the export again in a moment.',
      'exportPianoLoading',
    );
  }

  if (options.includeMetronome) {
    scheduleClicksForRange(
      context,
      graph.outputDestination,
      take.tempo,
      options.metronomeVolume,
      0,
      effectivePlaybackDurationMs(take),
    );
  }

  const buffer = await context.startRendering();

  // Peak check: rescale only to prevent clipping.
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const magnitude = Math.abs(data[i] as number);
      if (magnitude > peak) peak = magnitude;
    }
  }
  if (peak > 0.985) {
    const scale = 0.97 / peak;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (data[i] as number) * scale;
      }
    }
  }
  return buffer;
}
