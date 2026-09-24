import { noteHand, type Hand } from './hands';
import { createTakeTempoMap } from './tempoMap';
import type { Take } from './takeTypes';

/**
 * A take as a Standard MIDI File, for every other program a pianist uses: a
 * notation editor to print or correct it, a DAW to arrange it, a piano app to
 * practise it.
 *
 * Format 1, three tracks: one for the tempo, meter and key, then the right
 * hand and the left, on channels 1 and 2 — the split the notation draws
 * (`noteHand`), so an editor opens it as a grand staff. The sustain pedal goes
 * to both hands, since it holds both. Times are converted through the take's
 * tempo map, so a bar in the file is a bar on the page, and a tempo change is
 * a tempo event where it happens.
 */

/** Ticks per quarter note: half a millisecond at 120 bpm, finer than anyone plays. */
export const MIDI_TICKS_PER_QUARTER = 960;

/** General MIDI's Acoustic Grand Piano, numbered from zero as the file writes it. */
const GM_ACOUSTIC_GRAND = 0;

export interface MidiExportOptions {
  /** The sequence's name: the take's title. */
  title: string;
  /** The key signature to declare, when one is known. */
  key?: { fifths: number; minor: boolean };
  /** The General MIDI program both hands play. */
  program?: number;
  /** Names for the two hands' tracks, which editors show. */
  trackNames?: Readonly<Record<Hand, string>>;
}

const CHANNEL: Record<Hand, number> = { right: 0, left: 1 };
const SUSTAIN_CONTROLLER = 64;

/**
 * What happens first when two things share a tick: the track's setup, then
 * notes ending, the pedal, and notes starting — so a key repeated on the tick
 * its last note ends is let go before it is struck again.
 */
const ORDER = { setup: 0, noteOff: 1, pedalUp: 2, pedalDown: 3, noteOn: 4, end: 5 } as const;

interface MidiEvent {
  tick: number;
  order: number;
  bytes: readonly number[];
}

/** A note as it is played: a key down from `start` to `end`, in ticks. */
interface PlayedNote {
  midi: number;
  velocity: number;
  start: number;
  end: number;
}

function variableLength(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) out.unshift((rest & 0x7f) | 0x80);
  return out;
}

function text(type: number, value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)];
  return [0xff, type, ...variableLength(bytes.length), ...bytes];
}

function velocityByte(velocity: number): number {
  return Math.min(127, Math.max(1, Math.round(velocity * 127)));
}

/**
 * The notes one hand plays, as a keyboard can play them. A key already down
 * can only be struck again, not doubled: the earlier note ends where the new
 * one starts, which then holds on until both have let go — how two voices
 * sharing a key are played, and what a MIDI note-off can say at all (one off
 * for two ons would end the pair). Struck together, they are one note, as hard
 * and as long as the harder and longer.
 */
function playedNotes(
  notes: readonly Take['notes'][number][],
  tickAt: (ms: number) => number,
): PlayedNote[] {
  const sorted = [...notes].sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);
  const out: PlayedNote[] = [];
  const latest = new Map<number, PlayedNote>();
  for (const note of sorted) {
    const start = tickAt(note.startMs);
    const velocity = velocityByte(note.velocity);
    let end = Math.max(start + 1, tickAt(note.startMs + note.durationMs));
    const previous = latest.get(note.midi);
    if (previous && previous.end > start) {
      if (previous.start === start) {
        previous.velocity = Math.max(previous.velocity, velocity);
        previous.end = Math.max(previous.end, end);
        continue;
      }
      end = Math.max(end, previous.end);
      previous.end = start;
    }
    const played = { midi: note.midi, velocity, start, end };
    out.push(played);
    latest.set(note.midi, played);
  }
  return out;
}

function chunk(type: string, body: readonly number[]): number[] {
  const length = body.length;
  return [
    ...[...type].map((letter) => letter.charCodeAt(0)),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ];
}

function track(events: MidiEvent[], endTick: number): number[] {
  events.push({ tick: endTick, order: ORDER.end, bytes: [0xff, 0x2f, 0x00] });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let at = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - at), ...event.bytes);
    at = event.tick;
  }
  return chunk('MTrk', body);
}

/** The whole file, ready to save as `.mid`. */
export function takeToMidi(take: Take, options: MidiExportOptions): Uint8Array<ArrayBuffer> {
  const { timeSignature } = take.tempo;
  const map = createTakeTempoMap(take.tempo);
  // The map counts the meter's own beats; a file counts quarter notes.
  const quartersPerBeat = 4 / timeSignature.denominator;
  const tickAt = (ms: number): number =>
    Math.max(0, Math.round(map.beatAtMs(ms) * quartersPerBeat * MIDI_TICKS_PER_QUARTER));

  const hands: Record<Hand, PlayedNote[]> = {
    right: playedNotes(
      take.notes.filter((note) => noteHand(note) === 'right'),
      tickAt,
    ),
    left: playedNotes(
      take.notes.filter((note) => noteHand(note) === 'left'),
      tickAt,
    ),
  };
  let endTick = 0;
  for (const played of [...hands.right, ...hands.left]) endTick = Math.max(endTick, played.end);

  const pedal: { tick: number; down: boolean }[] = [];
  let down = false;
  for (const event of [...take.pedalEvents].sort((a, b) => a.atMs - b.atMs)) {
    if (event.down === down) continue;
    down = event.down;
    pedal.push({ tick: tickAt(event.atMs), down });
  }
  for (const change of pedal) endTick = Math.max(endTick, change.tick);

  // Clocks per click, 24 to the quarter: a compound meter clicks dotted beats.
  const compound = timeSignature.denominator === 8 && timeSignature.numerator % 3 === 0;
  const clocks = Math.round((96 / timeSignature.denominator) * (compound ? 3 : 1));
  const conductor: MidiEvent[] = [
    { tick: 0, order: ORDER.setup, bytes: text(0x03, options.title) },
    {
      tick: 0,
      order: ORDER.setup,
      bytes: [
        0xff,
        0x58,
        0x04,
        timeSignature.numerator,
        Math.round(Math.log2(timeSignature.denominator)),
        clocks,
        8,
      ],
    },
  ];
  if (options.key) {
    const { fifths, minor } = options.key;
    conductor.push({
      tick: 0,
      order: ORDER.setup,
      bytes: [0xff, 0x59, 0x02, fifths & 0xff, minor ? 1 : 0],
    });
  }
  for (const segment of map.segments) {
    // Microseconds a quarter note; a take's bpm always counts quarters.
    const tempo = Math.round(60_000_000 / segment.bpm);
    conductor.push({
      tick: tickAt(segment.startMs),
      order: ORDER.setup,
      bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff],
    });
  }

  const handTrack = (hand: Hand): number[] => {
    const channel = CHANNEL[hand];
    const events: MidiEvent[] = [
      { tick: 0, order: ORDER.setup, bytes: text(0x03, options.trackNames?.[hand] ?? hand) },
      {
        tick: 0,
        order: ORDER.setup,
        bytes: [0xc0 | channel, options.program ?? GM_ACOUSTIC_GRAND],
      },
    ];
    for (const change of pedal) {
      events.push({
        tick: change.tick,
        order: change.down ? ORDER.pedalDown : ORDER.pedalUp,
        bytes: [0xb0 | channel, SUSTAIN_CONTROLLER, change.down ? 127 : 0],
      });
    }
    for (const played of hands[hand]) {
      events.push(
        {
          tick: played.start,
          order: ORDER.noteOn,
          bytes: [0x90 | channel, played.midi, played.velocity],
        },
        { tick: played.end, order: ORDER.noteOff, bytes: [0x80 | channel, played.midi, 64] },
      );
    }
    return track(events, endTick);
  };

  const header = chunk('MThd', [
    0,
    1, // format 1
    0,
    3, // tracks
    (MIDI_TICKS_PER_QUARTER >> 8) & 0xff,
    MIDI_TICKS_PER_QUARTER & 0xff,
  ]);
  return Uint8Array.from([
    ...header,
    ...track(conductor, endTick),
    ...handTrack('right'),
    ...handTrack('left'),
  ]);
}
