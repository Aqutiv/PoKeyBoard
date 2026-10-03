import { MidiImportError } from '@/utils/errors';
import { buildImportedTake, importedTimeSignature, type ImportedNote } from './importedTake';
import {
  readSmf,
  type SmfChannelEvent,
  type SmfFile,
  type SmfMetaEvent,
  type SmfTrack,
} from './smfReader';
import { createTakeTempoMap } from './tempoMap';
import {
  MAX_FIFTHS,
  MAX_NOTE_COUNT,
  MAX_TEMPO_BPM,
  MIN_TEMPO_BPM,
  type NoteStaff,
  type QuantizationSetting,
  type Take,
  type TempoChange,
  type TimeSignature,
} from './takeTypes';

/**
 * A Standard MIDI File as a take.
 *
 * MIDI says what was played and when, in ticks, and how fast a tick goes; it
 * says almost nothing about how the music is written. So the milliseconds come
 * straight from the file — every note sounds exactly when the file says — and
 * the rest is inferred as carefully as the file allows: the tempo the notation
 * counts in, the grid it reads on, which hand plays what. Spelling, voices and
 * tuplets are left to the notation's own readers, which already handle takes
 * that never had them.
 */

/** File names a MIDI file goes by. */
export function isMidiFileName(name: string): boolean {
  return /\.midi?$/i.test(name);
}

/** General MIDI keeps channel 10 (9 counted from zero) for drums. */
const DRUM_CHANNEL = 9;
const SUSTAIN_CONTROLLER = 64;
/**
 * All Sound Off and All Notes Off: the two controllers that end every note a
 * channel holds, as `features/keyboard/midiInput.ts` treats them live.
 */
const ALL_SOUND_OFF_CONTROLLER = 120;
const ALL_NOTES_OFF_CONTROLLER = 123;
/** Reset All Controllers: among them the sustain pedal, which it lets up. */
const RESET_ALL_CONTROLLERS = 121;
/** A sustain pedal is down from this value up, as General MIDI reads it. */
const PEDAL_DOWN_FROM = 64;

const META_TRACK_NAME = 0x03;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;
const META_KEY_SIGNATURE = 0x59;

/** A file that names no tempo is at ♩=120, which is 500 000 µs a quarter. */
const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000;

/**
 * How far an onset may sit from a written position and still count as on it,
 * in quarters: two and a half ticks at 960 to the quarter.
 *
 * Exact ticks would do for a file a notation program wrote, but not for one
 * this app wrote: a take keeps whole milliseconds, so its export puts each note
 * up to half a millisecond off, plus half a tick. At ♩=240, the fastest a take
 * holds, that is just under two and a half ticks.
 */
const ON_GRID_TOLERANCE_Q = 2.5 / 960;

/** The share of onsets that must be written positions for a file to be a score. */
const SCORE_ONSET_SHARE = 0.9;
/** Below this many onsets, every one of them must be. */
const SCORE_MIN_ONSETS = 8;

/** Binary positions down to a 64th, and triplets down to a 16th triplet. */
const BINARY_STEP_Q = 1 / 16;
const TRIPLET_STEP_Q = 1 / 24;

/**
 * How much of the timeline lies near a written position: 16 binary and 24
 * triplet positions a quarter, 8 of them shared, each with the tolerance on
 * either side. An onset on no written position — one of a run of 39 in the
 * time of 32, say — still lands near one this often, by chance.
 */
const WRITTEN_POSITIONS_PER_QUARTER = 16 + 24 - 8;
const NEAR_WRITTEN_SHARE = WRITTEN_POSITIONS_PER_QUARTER * 2 * ON_GRID_TOLERANCE_Q;

/** How many times what chance explains a finer grid's onsets must exceed. */
const BEYOND_CHANCE = 2;

/** The offered grids as a length in quarter notes, coarsest first. */
const GRIDS: readonly { setting: QuantizationSetting; stepQ: number }[] = [
  { setting: '1/16', stepQ: 1 / 4 },
  { setting: '1/32', stepQ: 1 / 8 },
  { setting: '1/64', stepQ: 1 / 16 },
];

interface TempoSegment {
  tick: number;
  ms: number;
  microsecondsPerQuarter: number;
}

/** A note as the file plays it, still in ticks. */
interface TickNote {
  midi: number;
  startTick: number;
  endTick: number;
  velocity: number;
  seq: number;
  track: number;
  channel: number;
}

function fail(issue: string): MidiImportError {
  return new MidiImportError([issue], 'invalid');
}

function metaEvents(smf: SmfFile, metaType: number): SmfMetaEvent[] {
  const found: SmfMetaEvent[] = [];
  for (const track of smf.tracks) {
    for (const event of track.events) {
      if (event.type === 'meta' && event.metaType === metaType) found.push(event);
    }
  }
  // Stable, so of two at one tick the one in the later track comes last.
  return found.sort((a, b) => a.tick - b.tick);
}

// ---------------------------------------------------------------------------
// Time: the file's own tempo map, which every millisecond comes from.
// ---------------------------------------------------------------------------

function fileTempoMap(smf: SmfFile): {
  segments: TempoSegment[];
  msAtTick: (tick: number) => number;
} {
  const segments: TempoSegment[] = [
    { tick: 0, ms: 0, microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER },
  ];
  for (const event of metaEvents(smf, META_TEMPO)) {
    if (event.data.length < 3) continue;
    const microsecondsPerQuarter =
      ((event.data[0] as number) << 16) |
      ((event.data[1] as number) << 8) |
      (event.data[2] as number);
    if (microsecondsPerQuarter === 0) continue;
    const previous = segments[segments.length - 1] as TempoSegment;
    if (event.tick === previous.tick) {
      // Two tempos at one tick (or one at the very start): the later wins.
      previous.microsecondsPerQuarter = microsecondsPerQuarter;
      continue;
    }
    segments.push({
      tick: event.tick,
      ms: previous.ms + msBetween(previous, event.tick, smf.ticksPerQuarter),
      microsecondsPerQuarter,
    });
  }
  const msAtTick = (tick: number): number => {
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((segments[mid] as TempoSegment).tick <= tick) low = mid;
      else high = mid - 1;
    }
    const found = segments[low] as TempoSegment;
    return found.ms + msBetween(found, tick, smf.ticksPerQuarter);
  };
  return { segments, msAtTick };
}

function msBetween(segment: TempoSegment, tick: number, ticksPerQuarter: number): number {
  return ((tick - segment.tick) * segment.microsecondsPerQuarter) / 1000 / ticksPerQuarter;
}

/** The most decimals a tempo is looked for with; see `bpmOf`. */
const MAX_BPM_DECIMALS = 4;

/**
 * The bpm a tempo event means. A file stores whole microseconds, so ♩=72
 * written out comes back as 72.0000288. The tempo with the fewest decimals
 * that rounds to exactly the stored value is the one that was meant — 72 —
 * and it times every note the same as the stored value does, to well under a
 * microsecond a beat.
 */
function bpmOf(microsecondsPerQuarter: number): number {
  const exact = 60_000_000 / microsecondsPerQuarter;
  for (let decimals = 0; decimals <= MAX_BPM_DECIMALS; decimals += 1) {
    const scale = 10 ** decimals;
    const meant = Math.round(exact * scale) / scale;
    if (Math.round(60_000_000 / meant) === microsecondsPerQuarter) return meant;
  }
  return exact;
}

/** The octaves (powers of two) that bring `bpm` inside the range a take holds. */
function foldRange(bpm: number): { low: number; high: number } {
  return {
    low: Math.ceil(Math.log2(MIN_TEMPO_BPM / bpm) - 1e-9),
    high: Math.floor(Math.log2(MAX_TEMPO_BPM / bpm) + 1e-9),
  };
}

/** The fold nearest none at all within a range: no change when none is needed. */
function nearestFold({ low, high }: { low: number; high: number }): number {
  return Math.min(high, Math.max(low, 0));
}

/**
 * How each tempo is folded into the range a take can hold.
 *
 * A file may ask for any tempo, a take only for ♩=20–240. Clamping would make
 * the notation count the music at a speed it is not played at, and every note
 * would read as the wrong length. Doubling or halving instead only renames the
 * beat — ♩=400 is ♪=200 — so the notes keep their length, written in values
 * twice as long or half as long.
 *
 * One factor for the whole piece, when one fits, keeps every bar the same
 * length on the page; only a piece whose tempos are more than about a factor
 * of twelve apart needs each one folded on its own.
 */
function foldsFor(bpms: readonly number[]): { folds: number[]; uniform: boolean } {
  let low = -Infinity;
  let high = Infinity;
  for (const bpm of bpms) {
    const range = foldRange(bpm);
    low = Math.max(low, range.low);
    high = Math.min(high, range.high);
  }
  if (low <= high) {
    const fold = nearestFold({ low, high });
    return { folds: bpms.map(() => fold), uniform: true };
  }
  return { folds: bpms.map((bpm) => nearestFold(foldRange(bpm))), uniform: false };
}

/**
 * The meter, restated for a folded beat. When a file's quarter becomes a take's
 * half note (a slow tempo doubled), 4/4 has to become 4/2 for the bar lines to
 * stay where they were; when it becomes an eighth, 4/8. A denominator a take
 * cannot hold is traded against the numerator where that comes out whole.
 */
function foldedMeter(meter: TimeSignature, fold: number): TimeSignature | null {
  const denominator = meter.denominator / 2 ** fold;
  if (denominator > 16) {
    const factor = denominator / 16;
    return Number.isInteger(meter.numerator / factor)
      ? { numerator: meter.numerator / factor, denominator: 16 }
      : null;
  }
  if (denominator < 2) {
    const factor = 2 / denominator;
    return { numerator: meter.numerator * factor, denominator: 2 };
  }
  return { numerator: meter.numerator, denominator };
}

// ---------------------------------------------------------------------------
// The notation's grid: a written score, or a performance?
// ---------------------------------------------------------------------------

function onMultiple(q: number, stepQ: number): boolean {
  const steps = q / stepQ;
  return Math.abs(steps - Math.round(steps)) * stepQ <= ON_GRID_TOLERANCE_Q;
}

/**
 * The grid a file's notes read on.
 *
 * A file a notation program wrote puts its notes on written positions; a
 * recording puts them wherever the hands fell. Only where notes *start* is
 * asked: how long a note is held says how it is played (staccato, legato),
 * not where it is written. A file is a score when nearly every onset is on a
 * binary position down to a 64th or on a triplet; it then gets the coarsest of
 * the offered grids its binary onsets fit — triplets are read in their own
 * division and have no say. A performance gets 1/16, as a fresh recording does.
 *
 * "Fit" allows for chance. A score with irregular tuplets (Chopin writes runs
 * of 21, 28 and 39) has onsets on no written position, and a few of those
 * land near a 64th anyway; a handful of them is no reason to read the whole
 * piece on a 1/64 grid. So a finer grid is chosen only when the onsets that
 * need it outnumber, by `BEYOND_CHANCE`, what the off-grid onsets would put
 * there by chance. A score with no off-grid onsets at all — any file a
 * notation program writes without irregular tuplets — expects no chance hits,
 * and a single onset decides, as a single note value does for MusicXML.
 *
 * `fold` is the uniform tempo fold: halving the tempo makes every value half
 * as long on the page, so a grid one step finer is needed for each halving
 * (and one coarser for each doubling, down to the 1/16 floor).
 */
function gridFor(onsetsQ: readonly number[], fold: number): QuantizationSetting {
  if (onsetsQ.length === 0) return '1/16';
  const binary = onsetsQ.filter((q) => onMultiple(q, BINARY_STEP_Q));
  const triplet = onsetsQ.filter(
    (q) => !onMultiple(q, BINARY_STEP_Q) && onMultiple(q, TRIPLET_STEP_Q),
  );
  const written = binary.length + triplet.length;
  const isScore =
    onsetsQ.length < SCORE_MIN_ONSETS
      ? written === onsetsQ.length
      : written >= SCORE_ONSET_SHARE * onsetsQ.length;
  if (!isScore) return '1/16';

  // Of the onsets that missed every written position, how many more there
  // were in all — some of them hit one by chance and were counted as written.
  const irregular = (onsetsQ.length - written) / (1 - NEAR_WRITTEN_SHARE);
  // Finest first: a grid is needed when the onsets only it holds (those off
  // the next coarser one) are more than chance explains.
  let index = 0;
  for (let i = GRIDS.length - 1; i > 0; i -= 1) {
    const { stepQ } = GRIDS[i] as (typeof GRIDS)[number];
    const coarserStepQ = (GRIDS[i - 1] as (typeof GRIDS)[number]).stepQ;
    const onlyHere = binary.filter((q) => !onMultiple(q, coarserStepQ)).length;
    // Positions this grid has and the coarser lacks, per quarter, each with
    // the tolerance either side.
    const positions = 1 / stepQ - 1 / coarserStepQ;
    const byChance = irregular * positions * 2 * ON_GRID_TOLERANCE_Q;
    if (onlyHere > BEYOND_CHANCE * byChance) {
      index = i;
      break;
    }
  }
  const folded = Math.min(GRIDS.length - 1, Math.max(0, index - fold));
  return (GRIDS[folded] as (typeof GRIDS)[number]).setting;
}

// ---------------------------------------------------------------------------
// What the file says about itself.
// ---------------------------------------------------------------------------

/** A name as UTF-8 when it is valid UTF-8, otherwise as Windows-1252. */
function decodeName(data: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder('windows-1252').decode(data);
  }
  return text.replace(/\p{Cc}/gu, '').trim();
}

function fileTitleOf(smf: SmfFile): string | null {
  // The first track's name is the sequence's: the conductor track of a type 1
  // file, the only track of a type 0. Other tracks' names name instruments.
  const first = smf.tracks[0];
  if (!first) return null;
  for (const event of first.events) {
    if (event.type === 'meta' && event.metaType === META_TRACK_NAME) {
      const name = decodeName(event.data);
      return name.length > 0 ? name : null;
    }
  }
  return null;
}

function fileMeter(smf: SmfFile): TimeSignature | null {
  const event = metaEvents(smf, META_TIME_SIGNATURE).find((e) => e.data.length >= 2);
  if (!event) return null;
  const power = event.data[1] as number;
  return power > 6 ? null : { numerator: event.data[0] as number, denominator: 2 ** power };
}

function fileKey(smf: SmfFile): { fifths: number; mode: 'major' | 'minor' } | null {
  const event = metaEvents(smf, META_KEY_SIGNATURE).find((e) => e.data.length >= 2);
  if (!event) return null;
  const fifths = ((event.data[0] as number) << 24) >> 24; // a signed byte
  const minor = event.data[1] === 1;
  if (Math.abs(fifths) > MAX_FIFTHS) return null;
  // Plenty of programs write C major at the start whatever the music is in;
  // the notation reads the key from the pitches better than that.
  if (fifths === 0 && !minor) return null;
  return { fifths, mode: minor ? 'minor' : 'major' };
}

// ---------------------------------------------------------------------------
// Notes, hands and the pedal.
// ---------------------------------------------------------------------------

/** A note-on waiting for the note-off that ends it. */
interface Strike extends Omit<TickNote, 'endTick'> {
  /** Paired already — by a note-off, possibly another track's, or a silencing controller. */
  ended: boolean;
}

/**
 * Strikes in the order they were made, oldest first. A strike may wait in more
 * than one queue (its own track's, and every track's), so one ended through
 * another queue is skipped here when the head reaches it. The head moves on
 * rather than the array shifting: a key struck thousands of times before it
 * is let go would otherwise make every note-off move every strike waiting.
 */
interface StrikeQueue {
  strikes: Strike[];
  /** No strike before this one is still waiting. */
  head: number;
}

/** The oldest strike in a queue still waiting, or undefined; empties a spent queue. */
function oldestWaiting(queue: StrikeQueue): Strike | undefined {
  while (queue.head < queue.strikes.length && (queue.strikes[queue.head] as Strike).ended) {
    queue.head += 1;
  }
  if (queue.head === queue.strikes.length) {
    queue.strikes = [];
    queue.head = 0;
    return undefined;
  }
  return queue.strikes[queue.head];
}

/** A map's queue for `key`, made empty the first time it is asked for. */
function queueAt(queues: Map<number, StrikeQueue>, key: number): StrikeQueue {
  let queue = queues.get(key);
  if (!queue) {
    queue = { strikes: [], head: 0 };
    queues.set(key, queue);
  }
  return queue;
}

/** One track's part on one channel, as a number: what a silencing controller addresses. */
function partKey(track: number, channel: number): number {
  return track * 16 + channel;
}

/**
 * Every note: a note-on paired with the first note-off for the same key on the
 * same channel (first in, first out, so a key struck again before it was let
 * go keeps both strikes). A note-on at velocity 0 is a note-off, as MIDI says.
 *
 * Every track's messages are read on one timeline — by tick, then by track,
 * each track's own in file order — because a channel is what MIDI addresses,
 * and a file may keep a note's end in another track than its start. A track's
 * own strikes are let go first, so two hands sharing a channel in two tracks
 * each keep their own notes; a note-off with none of its own track's to end
 * takes another track's oldest — but never one struck on that very tick, as
 * the order of two tracks' messages at one tick means nothing.
 *
 * All Sound Off and All Notes Off end every note their channel holds in that
 * track, there and then — the sustain pedal is its own controller and is left
 * alone, so a note it holds still rings. A note never let go ends where its
 * track does.
 */
function collectNotes(smf: SmfFile): { notes: TickNote[]; drumNotes: number } {
  const timeline: { event: SmfChannelEvent; track: number }[] = [];
  smf.tracks.forEach((track, trackIndex) => {
    for (const event of track.events) {
      if (event.type === 'channel') timeline.push({ event, track: trackIndex });
    }
  });
  // Stable, so each track's messages keep the file's order within a tick.
  timeline.sort((a, b) => a.event.tick - b.event.tick || a.track - b.track);

  const notes: TickNote[] = [];
  let drumNotes = 0;
  let seq = 0;
  const end = (strike: Strike, endTick: number): void => {
    strike.ended = true;
    const { midi, startTick, velocity, seq: order, track, channel } = strike;
    notes.push({ midi, startTick, endTick, velocity, seq: order, track, channel });
  };
  /** End every strike a queue still holds, at `endTick`, and empty it. */
  const endWaiting = (queue: StrikeQueue, endTick: number): void => {
    for (let i = queue.head; i < queue.strikes.length; i += 1) {
      const strike = queue.strikes[i] as Strike;
      if (!strike.ended) end(strike, endTick);
    }
    queue.strikes = [];
    queue.head = 0;
  };

  // Each track's strikes of each key, keyed by part and key.
  const own = new Map<number, StrikeQueue>();
  // Every track's strikes of each key on each channel, keyed by channel and key.
  const shared = new Map<number, StrikeQueue>();
  // Per part, its keys with a strike still waiting: what an All Notes Off has
  // to end. A file may send thousands of them, so each looks only at what its
  // part holds rather than sweeping every key.
  const sounding = new Map<number, Set<StrikeQueue>>();

  for (const { event, track } of timeline) {
    const part = partKey(track, event.channel);
    if (
      event.command === 0xb0 &&
      (event.data1 === ALL_SOUND_OFF_CONTROLLER || event.data1 === ALL_NOTES_OFF_CONTROLLER) &&
      event.channel !== DRUM_CHANNEL
    ) {
      const held = sounding.get(part);
      if (held) {
        for (const queue of held) endWaiting(queue, event.tick);
        held.clear();
      }
      continue;
    }
    const isOn = event.command === 0x90 && event.data2 > 0;
    const isOff = event.command === 0x80 || (event.command === 0x90 && event.data2 === 0);
    if (!isOn && !isOff) continue;
    if (event.channel === DRUM_CHANNEL) {
      if (isOn) drumNotes += 1;
      continue;
    }
    const ownQueue = queueAt(own, part * 128 + event.data1);
    const sharedQueue = queueAt(shared, event.channel * 128 + event.data1);
    if (isOn) {
      const strike: Strike = {
        midi: event.data1,
        startTick: event.tick,
        velocity: event.data2 / 127,
        seq: seq++,
        track,
        channel: event.channel,
        ended: false,
      };
      ownQueue.strikes.push(strike);
      sharedQueue.strikes.push(strike);
      let held = sounding.get(part);
      if (!held) {
        held = new Set();
        sounding.set(part, held);
      }
      held.add(ownQueue);
      continue;
    }
    let strike = oldestWaiting(ownQueue);
    if (strike === undefined) {
      // None of this track's own: another track's oldest, struck before now.
      const other = oldestWaiting(sharedQueue);
      if (other !== undefined && other.startTick < event.tick) strike = other;
    }
    // A note-off with nothing struck to let go of is ignored.
    if (strike === undefined) continue;
    end(strike, event.tick);
    if (oldestWaiting(ownQueue) === undefined) sounding.get(part)?.delete(ownQueue);
  }
  for (const [key, queue] of own) {
    // The part and key are in the queue's own key; its track ends what it left.
    const track = smf.tracks[Math.floor(key / (16 * 128))] as SmfTrack;
    endWaiting(queue, track.endTick);
  }
  return { notes, drumNotes };
}

/**
 * Which staff each note belongs on, when the file says.
 *
 * The app's own export writes the right hand on channel 1 in one track and the
 * left on channel 2 in another, so a file shaped exactly like that is read
 * back the same way — even where a hand crosses the other. Any other file with
 * exactly two parts (two tracks, or two channels of one) is split by which
 * part sits higher. One part, or three and more, says nothing about hands, so
 * the notation's middle-C split decides, as it does for a recording.
 */
function staffOf(notes: readonly TickNote[]): (note: TickNote) => NoteStaff | undefined {
  const parts = new Map<string, { track: number; channel: number; sum: number; count: number }>();
  for (const note of notes) {
    const key = `${note.track}:${note.channel}`;
    const part = parts.get(key) ?? { track: note.track, channel: note.channel, sum: 0, count: 0 };
    part.sum += note.midi;
    part.count += 1;
    parts.set(key, part);
  }
  if (parts.size !== 2) return () => undefined;
  const [a, b] = [...parts.values()] as [
    { track: number; channel: number; sum: number; count: number },
    { track: number; channel: number; sum: number; count: number },
  ];
  const ownExport =
    a.track !== b.track && a.channel + b.channel === 1 && a.channel * b.channel === 0;
  let upper: typeof a;
  if (ownExport) upper = a.channel === 0 ? a : b;
  else upper = b.sum / b.count > a.sum / a.count ? b : a;
  return (note) =>
    note.track === upper.track && note.channel === upper.channel ? 'treble' : 'bass';
}

/** One channel's sustain controller, as the file sends it. */
interface PedalChange {
  tick: number;
  channel: number;
  down: boolean;
}

/**
 * The sustain pedal, as one pedal. It is down while any channel holds it: the
 * app's own export writes the pedal into both hands' tracks, and a file from
 * elsewhere may pedal on several channels. A Reset All Controllers lets its
 * channel's pedal up, as MIDI says it does.
 *
 * Changes on one tick are settled together rather than one by one, since the
 * order of two tracks' events at one tick means nothing. Each channel's own
 * changes are taken in the order the file gives them, so its last is where it
 * ends up; and it was up at some moment of the tick if it was up already, or
 * let go along the way. The pedal lifts at the tick if every channel was up at
 * some moment of it, and is down after it if any channel ends down. So the
 * change of pedal the export writes (both hands up, then down, on one tick)
 * is kept; a channel's redundant press and release ends up; and one hand
 * changing pedal while the other holds it changes nothing.
 */
function collectPedal(smf: SmfFile, msAtTick: (tick: number) => number) {
  const changes: PedalChange[] = [];
  for (const track of smf.tracks) {
    for (const event of track.events) {
      if (event.type !== 'channel' || event.command !== 0xb0 || event.channel === DRUM_CHANNEL) {
        continue;
      }
      if (event.data1 === SUSTAIN_CONTROLLER) {
        changes.push({
          tick: event.tick,
          channel: event.channel,
          down: event.data2 >= PEDAL_DOWN_FROM,
        });
      } else if (event.data1 === RESET_ALL_CONTROLLERS) {
        changes.push({ tick: event.tick, channel: event.channel, down: false });
      }
    }
  }
  // Stable, and by tick alone, so each channel's changes keep the file's order.
  changes.sort((a, b) => a.tick - b.tick);

  /** The channels holding the pedal down; any other is up, seen or not. */
  const held = new Set<number>();
  const pedals: { atMs: number; down: boolean }[] = [];
  for (let first = 0; first < changes.length;) {
    const { tick } = changes[first] as PedalChange;
    let next = first;
    // Each channel that changes at this tick: where it ends up, and whether it
    // was up at some moment of the tick.
    const settled = new Map<number, { down: boolean; dipped: boolean }>();
    for (; next < changes.length && (changes[next] as PedalChange).tick === tick; next += 1) {
      const { channel, down } = changes[next] as PedalChange;
      const state = settled.get(channel) ?? {
        down: held.has(channel),
        dipped: !held.has(channel),
      };
      state.down = down;
      if (!down) state.dipped = true;
      settled.set(channel, state);
    }

    const wasDown = held.size > 0;
    // A channel with nothing at this tick holds throughout if it was down.
    let dipped = true;
    for (const channel of held) if (!settled.has(channel)) dipped = false;
    for (const state of settled.values()) if (!state.dipped) dipped = false;
    for (const [channel, state] of settled) {
      if (state.down) held.add(channel);
      else held.delete(channel);
    }
    const isDown = held.size > 0;

    const atMs = msAtTick(tick);
    if (wasDown && dipped) pedals.push({ atMs, down: false });
    if (isDown && (!wasDown || dipped)) pedals.push({ atMs, down: true });
    first = next;
  }
  return pedals;
}

// ---------------------------------------------------------------------------

/**
 * Parse a Standard MIDI File into a normalized take.
 * Throws `MidiImportError` with human-readable issues on failure.
 */
export function midiToTake(bytes: Uint8Array, fileName?: string): Take {
  const smf = readSmf(bytes);
  const { notes, drumNotes } = collectNotes(smf);
  if (notes.length === 0) {
    throw fail(
      drumNotes > 0
        ? 'The file holds only drums (channel 10), which a piano cannot play.'
        : 'The file contains no playable notes.',
    );
  }
  if (notes.length > MAX_NOTE_COUNT) {
    throw fail(`The file has ${notes.length} notes; the limit is ${MAX_NOTE_COUNT}.`);
  }

  const { segments, msAtTick } = fileTempoMap(smf);

  // Every tempo, folded into the take's range; the meter follows the opening
  // fold, and the grid the finest, since that is where the shortest values are.
  const bpms = segments.map((segment) => bpmOf(segment.microsecondsPerQuarter));
  const { folds } = foldsFor(bpms);
  const meterFold = folds[0] as number;
  // Reduced, not Math.min(...folds): a file may hold more tempos than a call
  // can take arguments.
  const gridFold = folds.reduce((finest, fold) => Math.min(finest, fold), meterFold);
  const meter = importedTimeSignature(
    foldedMeter(fileMeter(smf) ?? { numerator: 4, denominator: 4 }, meterFold),
  );

  // The tempo the take carries, at whole milliseconds. Two changes on one
  // millisecond would be "repaired" on the way in, so the later wins here, as
  // it does in playback; and a change to the tempo already in force is no change.
  const byMs = new Map<number, number>();
  segments.forEach((segment, i) => {
    byMs.set(Math.max(0, Math.round(segment.ms)), (bpms[i] as number) * 2 ** (folds[i] as number));
  });
  const base = byMs.get(0) as number;
  const changes: TempoChange[] = [];
  let inForce = base;
  for (const [atMs, bpm] of [...byMs.entries()].sort((a, b) => a[0] - b[0])) {
    if (atMs === 0 || bpm === inForce) continue;
    changes.push({ atMs, bpm });
    inForce = bpm;
  }

  const staff = staffOf(notes);
  const keyOf = fileKey(smf);
  const onsets = [...new Set(notes.map((note) => note.startTick))].map(
    (tick) => tick / smf.ticksPerQuarter,
  );

  return buildImportedTake(
    {
      notes: notes.map((note): ImportedNote => ({
        midi: note.midi,
        startMs: msAtTick(note.startTick),
        endMs: msAtTick(note.endTick),
        velocity: note.velocity,
        seq: note.seq,
        staff: staff(note),
      })),
      nextSeq: notes.length,
      pedals: collectPedal(smf, msAtTick),
      tempoMap: createTakeTempoMap({ bpm: base, timeSignature: meter, changes }),
      timeSignature: meter,
      keySignature: keyOf?.fifths ?? null,
      keyMode: keyOf?.mode ?? null,
      title: fileTitleOf(smf),
      quantization: gridFor(onsets, gridFold),
    },
    fileName,
    fail,
  );
}
