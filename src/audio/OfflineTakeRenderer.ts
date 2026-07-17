import { sortNotes } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';
import { applySustainToNotes } from '@/features/transport/sustainPedal';
import { ExportError } from '@/utils/errors';
import { audioEngine } from './AudioEngine';
import { scheduleClicksForRange } from './MetronomeEngine';
import { createPianoGraph } from './PianoGraphFactory';
import { ATTACK_S, RELEASE_STOP_AFTER_S, RELEASE_TC } from './VoiceManager';

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

export function estimateRenderSeconds(take: Take): number {
  return take.durationMs / 1000 + TAIL_S;
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
  await audioEngine.ensurePlayableRange(minMidi, maxMidi);

  const length = Math.ceil(seconds * RENDER_SAMPLE_RATE);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length,
    sampleRate: RENDER_SAMPLE_RATE,
  });

  const graph = createPianoGraph(context, {
    masterVolume: take.instrument.masterVolume,
    reverbMix: take.instrument.reverbMix,
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
    const source = context.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = sample.playbackRate;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(sample.gain, when + ATTACK_S);
    gain.gain.setTargetAtTime(0, releaseAt, RELEASE_TC);
    source.connect(gain);
    gain.connect(graph.voiceDestination);
    source.start(when);
    source.stop(releaseAt + RELEASE_STOP_AFTER_S);
  }
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
      context.destination,
      {
        bpm: take.tempo.bpm,
        timeSignature: take.tempo.timeSignature,
        volume: options.metronomeVolume,
      },
      0,
      take.durationMs,
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
