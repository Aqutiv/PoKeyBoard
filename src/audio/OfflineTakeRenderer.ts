import { sortNotes } from '@/domain/noteEvents';
import { DEFAULT_MASTER_VOLUME, type Take } from '@/domain/takeTypes';
import {
  applySustainToNotes,
  effectivePlaybackDurationMs,
} from '@/features/transport/sustainPedal';
import { ExportError } from '@/utils/errors';
import { audioEngine } from './AudioEngine';
import { scheduleClicksForRange } from './MetronomeEngine';
import { createPianoGraph } from './PianoGraphFactory';
import { releaseSampleVoice, startSampleVoice } from './sampleVoice';

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
 * A take rendered for export, not yet at its final level: that is set from the
 * whole of it once it exists (`masterExport`).
 */
export interface RenderedTake {
  /** The piano and its reverb, stereo, at the app's default volume. */
  piano: AudioBuffer;
  /**
   * The metronome, mono and as long as the piano, when asked for. Kept apart
   * so its clicks never count toward how loud the piano is.
   */
  clicks: AudioBuffer | null;
}

export function estimateRenderSeconds(take: Take): number {
  return effectivePlaybackDurationMs(take) / 1000 + TAIL_S;
}

/** Rough working-set estimate (render buffer + PCM copy for encoding). */
export function estimateRenderMemoryMB(take: Take): number {
  const samples = estimateRenderSeconds(take) * RENDER_SAMPLE_RATE * 2;
  return Math.round((samples * 4 * 2) / 1_000_000);
}

/**
 * Render a take through the same sample bank, graph shape, and envelope
 * constants as live playback. Two things differ, both about level: the piano
 * plays at the default volume rather than wherever the volume slider was left
 * — that slider is for the room, not the file — and without the graph's live
 * peak guard, which a limiter that can look ahead replaces afterwards.
 */
export async function renderTakeForExport(
  take: Take,
  options: OfflineRenderOptions,
): Promise<RenderedTake> {
  const seconds = estimateRenderSeconds(take);
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

  const length = Math.ceil(seconds * RENDER_SAMPLE_RATE);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length,
    sampleRate: RENDER_SAMPLE_RATE,
  });

  const graph = createPianoGraph(context, {
    masterVolume: DEFAULT_MASTER_VOLUME,
    reverbMix: take.instrument.reverbMix,
    peakGuard: false,
  });

  const effectiveNotes = sortNotes(applySustainToNotes(take.notes, take.pedalEvents));
  let missingSamples = 0;
  for (const note of effectiveNotes) {
    const sample = audioEngine.bank.getSample(note.midi, note.velocity);
    if (!sample) {
      missingSamples += 1;
      continue;
    }
    const when = note.startMs / 1000;
    const releaseAt = when + note.durationMs / 1000;
    const voice = startSampleVoice(context, graph.voiceDestination, sample, when);
    releaseSampleVoice(voice, releaseAt);
  }
  if (missingSamples > 0) {
    throw new ExportError(
      `${missingSamples} notes had no decoded sample`,
      'The piano is still loading — try the export again in a moment.',
      'exportPianoLoading',
    );
  }

  const [piano, clicks] = await Promise.all([
    context.startRendering(),
    options.includeMetronome ? renderClicks(take, options.metronomeVolume, length) : null,
  ]);
  return { piano, clicks };
}

/** The metronome alone, in a context of its own; see `RenderedTake.clicks`. */
function renderClicks(take: Take, volume: number, length: number): Promise<AudioBuffer> {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length,
    sampleRate: RENDER_SAMPLE_RATE,
  });
  scheduleClicksForRange(
    context,
    context.destination,
    take.tempo,
    volume,
    0,
    effectivePlaybackDurationMs(take),
  );
  return context.startRendering();
}
