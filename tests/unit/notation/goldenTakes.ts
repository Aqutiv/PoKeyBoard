import { computeTakeDurationMs, createEmptyTake, sortNotes } from '@/domain/noteEvents';
import type { NoteEvent, PedalEvent, Take } from '@/domain/takeTypes';

/**
 * The synthetic take the sheet goldens engrave: one short piece carrying every
 * feature the printed page can draw that the vendored scores reach only here
 * and there — an 8va line, pedal brackets, a swell written as a hairpin with
 * its dynamics, a twelve-note tuplet, a clef change, a double sharp and a
 * double flat, and a title with a flat sign in it.
 *
 * Deterministic on purpose: fixed ids and a fixed date, so the golden is the
 * same file on every machine.
 */
export const GOLDEN_STUDY_TITLE = 'Golden Study in B♭ — “8va”';

const BPM = 100;
const BEAT_MS = 60_000 / BPM;
const BAR_MS = 4 * BEAT_MS;
const FIXED_DATE = '2026-01-15T12:00:00.000Z';

export function buildGoldenStudyTake(): Take {
  const notes: NoteEvent[] = [];
  const add = (note: Omit<NoteEvent, 'id'>): void => {
    notes.push({ id: `g${notes.length}`, ...note });
  };

  // Bars 1–8: a scale figure over a walking bass, struck harder every beat, so
  // the reading writes a quiet mark, a crescendo wedge and a loud one.
  const figure = [70, 72, 74, 75, 77, 75, 74, 72];
  const bass = [46, 53];
  for (let beat = 0; beat < 32; beat += 1) {
    const velocity = Math.round((0.12 + (0.86 * beat) / 31) * 1000) / 1000;
    const startMs = beat * BEAT_MS;
    add({
      midi: figure[beat % figure.length]!,
      startMs,
      durationMs: BEAT_MS - 20,
      velocity,
      staff: 'treble',
    });
    if (beat % 2 === 0) {
      add({
        midi: bass[(beat / 2) % bass.length]!,
        startMs,
        durationMs: 2 * BEAT_MS - 20,
        velocity: Math.max(0.05, velocity - 0.05),
        staff: 'bass',
      });
    }
  }

  // Bar 9: four chords from D6 up — an 8va passage.
  const high = [
    [86, 89],
    [87, 91],
    [89, 93],
    [91, 94],
  ];
  high.forEach((chord, i) => {
    for (const midi of chord) {
      add({
        midi,
        startMs: 8 * BAR_MS + i * BEAT_MS,
        durationMs: BEAT_MS - 20,
        velocity: 0.7,
        staff: 'treble',
      });
    }
  });
  add({ midi: 46, startMs: 8 * BAR_MS, durationMs: BAR_MS - 20, velocity: 0.6, staff: 'bass' });

  // Bar 10: F double sharp and B double flat, spelled by the score, then the
  // B flat the double flat has to be cancelled back to — over a left hand
  // climbing high enough to be written under a G clef.
  const spelled: [number, NoteEvent['spelling']][] = [
    [67, { step: 'F', alter: 2 }],
    [67, { step: 'G', alter: 0 }],
    [69, { step: 'B', alter: -2 }],
    [70, { step: 'B', alter: -1 }],
  ];
  spelled.forEach(([midi, spelling], i) => {
    add({
      midi,
      startMs: 9 * BAR_MS + i * BEAT_MS,
      durationMs: BEAT_MS - 20,
      velocity: 0.7,
      staff: 'treble',
      ...(spelling ? { spelling } : {}),
    });
  });
  [60, 62, 63, 65].forEach((midi, i) => {
    add({
      midi,
      startMs: 9 * BAR_MS + i * BEAT_MS,
      durationMs: BEAT_MS - 20,
      velocity: 0.6,
      staff: 'bass',
      clef: 'treble',
    });
  });

  // Bar 11: twelve 32nds in the time of eight — one beat — then quarters,
  // with the left hand back under its F clef.
  const run = [70, 72, 74, 75, 77, 79, 81, 79, 77, 75, 74, 72];
  const tupletMs = BEAT_MS / run.length;
  run.forEach((midi, i) => {
    add({
      midi,
      startMs: 10 * BAR_MS + i * tupletMs,
      durationMs: tupletMs,
      velocity: 0.7,
      staff: 'treble',
      tuplet: { actual: 12, normal: 8, unit: 32, group: 0 },
    });
  });
  [70, 74, 77].forEach((midi, i) => {
    add({
      midi,
      startMs: 10 * BAR_MS + (i + 1) * BEAT_MS,
      durationMs: BEAT_MS - 20,
      velocity: 0.7,
      staff: 'treble',
    });
  });
  add({ midi: 53, startMs: 10 * BAR_MS, durationMs: BAR_MS - 20, velocity: 0.6, staff: 'bass' });

  // Bar 12: the closing chord.
  for (const midi of [70, 74]) {
    add({ midi, startMs: 11 * BAR_MS, durationMs: BAR_MS - 20, velocity: 0.5, staff: 'treble' });
  }
  add({ midi: 46, startMs: 11 * BAR_MS, durationMs: BAR_MS - 20, velocity: 0.5, staff: 'bass' });

  // Pedal down for each of the first four bars, lifted just before the next.
  const pedalEvents: PedalEvent[] = [];
  for (let bar = 0; bar < 4; bar += 1) {
    pedalEvents.push({ atMs: bar * BAR_MS + 10, down: true });
    pedalEvents.push({ atMs: (bar + 1) * BAR_MS - 60, down: false });
  }

  const sorted = sortNotes(notes);
  return createEmptyTake({
    id: 'golden-study',
    title: GOLDEN_STUDY_TITLE,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    durationMs: computeTakeDurationMs(sorted),
    tempo: {
      bpm: BPM,
      timeSignature: { numerator: 4, denominator: 4 },
      countInBars: 0,
      keySignature: -2,
    },
    notes: sorted,
    pedalEvents,
    display: { quantization: '1/32', zoom: 1, playheadMs: 0 },
  });
}
