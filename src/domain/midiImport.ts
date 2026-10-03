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
/** Device (port) Name, and the older MIDI Port: which device a track's messages go to. */
const META_DEVICE_NAME = 0x09;
const META_PORT = 0x21;
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

/**
 * Where each channel message goes: its channel on its device, as one number.
 *
 * A channel belongs to a device. A file that drives several names each
 * track's device — a Device Name (FF 09), or the older MIDI Port (FF 21) —
 * and may use channel 1 of each for different parts, so a note-off, an All
 * Notes Off or a pedal on one device's channel 1 is nothing to another's. A
 * track takes the device it last named; one that names none, as almost every
 * file, is the file's own device — the one MIDI Port 0 names too — so such
 * files read exactly as by channel.
 */
interface ChannelAddressing {
  /**
   * Per track, each event's address, by its place in the track (a meta
   * event's is unused): an array beside the events, as cheap to read as they are.
   */
  addresses: number[][];
  /** One more than the highest address: what a track's addresses are counted in. */
  span: number;
}

function channelAddressing(smf: SmfFile): ChannelAddressing {
  const devices = new Map<string, number>();
  const addresses = smf.tracks.map((track) => {
    const ofTrack = new Array<number>(track.events.length);
    let device = 0;
    track.events.forEach((event, index) => {
      if (event.type === 'channel') {
        ofTrack[index] = device * 16 + event.channel;
        return;
      }
      ofTrack[index] = -1;
      let name: string | null;
      if (event.metaType === META_DEVICE_NAME) {
        const text = decodeName(event.data);
        name = text.length > 0 ? `name:${text}` : null;
      } else if (event.metaType === META_PORT && event.data.length >= 1) {
        // Port 0 is the first port: where a track that names none goes too.
        const port = event.data[0] as number;
        name = port === 0 ? null : `port:${port}`;
      } else {
        return;
      }
      if (name === null) {
        device = 0;
        return;
      }
      let found = devices.get(name);
      if (found === undefined) {
        found = devices.size + 1;
        devices.set(name, found);
      }
      device = found;
    });
    return ofTrack;
  });
  return { addresses, span: (devices.size + 1) * 16 };
}

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
  /** The track a track's own queue is for; strikes it leaves end with that track. */
  track?: number;
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
function queueAt(queues: Map<number, StrikeQueue>, key: number, track?: number): StrikeQueue {
  let queue = queues.get(key);
  if (!queue) {
    queue = track === undefined ? { strikes: [], head: 0 } : { strikes: [], head: 0, track };
    queues.set(key, queue);
  }
  return queue;
}

/** All Sound Off or All Notes Off: a message that ends every note its channel holds. */
function isSilencing(event: SmfChannelEvent): boolean {
  return (
    event.command === 0xb0 &&
    (event.data1 === ALL_SOUND_OFF_CONTROLLER || event.data1 === ALL_NOTES_OFF_CONTROLLER)
  );
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
 * All Sound Off and All Notes Off end every note their channel holds, in every
 * track, there and then: every note struck before their tick, and those their
 * own track struck on it before them, in file order. Another track's note
 * struck on the same tick is left be, whichever came first, so a track that
 * opens with one as a reset never cuts short another track's first notes.
 * (The sustain pedal is its own controller; what it holds is
 * `collectPedal`'s business.) A note never let go ends where its track does.
 */
function collectNotes(
  smf: SmfFile,
  { addresses, span }: ChannelAddressing,
): { notes: TickNote[]; drumNotes: number } {
  const timeline: {
    event: SmfChannelEvent;
    track: number;
    silencing: boolean;
    /** Its channel on its device; see `channelAddressing`. */
    address: number;
  }[] = [];
  smf.tracks.forEach((track, trackIndex) => {
    const ofTrack = addresses[trackIndex] as number[];
    track.events.forEach((event, index) => {
      if (event.type !== 'channel') return;
      // Only what pairs notes is kept: a file may hold hundreds of thousands
      // of other messages — pitch bends, pressure — that would only be sorted
      // to be skipped.
      const silencing = isSilencing(event);
      if (!silencing && event.command !== 0x90 && event.command !== 0x80) return;
      timeline.push({ event, track: trackIndex, silencing, address: ofTrack[index] as number });
    });
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

  // Each track's strikes of each key, keyed by part (a track's channel on its
  // device) and key.
  const own = new Map<number, StrikeQueue>();
  // Every track's strikes of each key on each channel of each device, keyed by
  // address and key.
  const shared = new Map<number, StrikeQueue>();
  // Per channel, the tracks' keys with a strike still waiting: what an All
  // Notes Off has to end. A file may send thousands of them, so each looks only
  // at what its channel holds rather than sweeping every key of every track.
  const sounding = new Map<number, Set<StrikeQueue>>();
  // Per channel, the tick its strikes from before were last all ended on: the
  // first All Notes Off of a tick ends them, and any more on it need not look.
  const silencedOn = new Map<number, number>();
  // Per part, the strikes it made on the tick it last struck on: an All Notes
  // Off later in that track's tick ends them too, the file's order being theirs.
  const fresh = new Map<number, { tick: number; strikes: Strike[] }>();

  for (const { event, track, silencing, address } of timeline) {
    const part = track * span + address;
    if (silencing) {
      if (event.channel === DRUM_CHANNEL) continue;
      const { tick } = event;
      const held = sounding.get(address);
      if (held && silencedOn.get(address) !== tick) {
        silencedOn.set(address, tick);
        for (const queue of held) {
          // Every strike from before this tick; one struck on it by another
          // track waits, and its queue with it.
          let strike = oldestWaiting(queue);
          while (strike !== undefined && strike.startTick < tick) {
            end(strike, tick);
            strike = oldestWaiting(queue);
          }
          if (strike === undefined) held.delete(queue);
        }
      }
      const ownFresh = fresh.get(part);
      if (ownFresh?.tick === tick) {
        for (const strike of ownFresh.strikes) if (!strike.ended) end(strike, tick);
        ownFresh.strikes = [];
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
    const ownQueue = queueAt(own, part * 128 + event.data1, track);
    const sharedQueue = queueAt(shared, address * 128 + event.data1);
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
      let held = sounding.get(address);
      if (!held) {
        held = new Set();
        sounding.set(address, held);
      }
      held.add(ownQueue);
      let ownFresh = fresh.get(part);
      if (ownFresh?.tick !== event.tick) {
        ownFresh = { tick: event.tick, strikes: [] };
        fresh.set(part, ownFresh);
      }
      ownFresh.strikes.push(strike);
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
    if (oldestWaiting(ownQueue) === undefined) sounding.get(address)?.delete(ownQueue);
  }
  for (const queue of own.values()) {
    // A track's own queue: its track ends what it left.
    const track = smf.tracks[queue.track as number] as SmfTrack;
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
  /** The track it was written in: within one track a tick's events are in order. */
  track: number;
  /** Its channel on its device (see `channelAddressing`): whose pedal it moves. */
  channel: number;
  /**
   * Where the channel's pedal goes — or, for an All Sound Off, a break: up for
   * an instant, so what it held stops sounding, then as it was.
   */
  to: 'down' | 'up' | 'break';
}

/**
 * The sustain pedal, as one pedal. It is down while any channel holds it: the
 * app's own export writes the pedal into both hands' tracks, and a file from
 * elsewhere may pedal on several channels. A Reset All Controllers lets its
 * channel's pedal up, as MIDI says it does; an All Sound Off silences what the
 * pedal holds too, so it breaks the pedal for an instant without moving it —
 * the take's one pedal, whatever other channels hold.
 *
 * Changes are settled in two steps. First a tick at a time: each track's in
 * the order the file gives them, while how two tracks' events at one tick fall
 * against each other is not known. The pedal lifts at the tick if its channels
 * can all have been up at one instant — none holding untouched, each track
 * with an instant when every channel it changes alone is up, and a channel two
 * tracks change let up by either — and is down after it if any channel ends
 * down; a pedal down before the tick and up after it was let up, whatever else. So the change of pedal the export writes (both
 * hands up, then down, on one tick, in two tracks) is kept, and one hand
 * changing pedal while the other holds it changes nothing.
 *
 * Where the pedal is down after an All Sound Off's tick — pressed again after
 * the break, or pressed afresh on it — the press lands on the very millisecond
 * a note let go on that tick ends, and a note let go as the pedal goes down is
 * held by it; those ticks are handed back, so
 * such notes can let go a millisecond sooner, while the pedal from before
 * still holds them, and stop with the break — where the settled pedal does
 * still go down on that millisecond.
 *
 * Then a whole millisecond at a time, which is all a take keeps, and so all it
 * can order — two changes a tick apart at 960 to the quarter can share one,
 * and a take sorts one moment's release before its press whatever the file
 * said. Across ticks the order is real, so each millisecond is what the pedal
 * did in it, tick by tick: it lifts if it was ever up in it, and is down after
 * if it ends down. A press and release inside one millisecond nets nothing,
 * and two hands changing pedal on ticks of their own, one holding while the
 * other changes, never lift it.
 */
function collectPedal(
  smf: SmfFile,
  { addresses }: ChannelAddressing,
  msAtTick: (tick: number) => number,
): { pedals: { atMs: number; down: boolean }[]; heldAgainAfterBreak: Set<number> } {
  const changes: PedalChange[] = [];
  smf.tracks.forEach((source, track) => {
    const ofTrack = addresses[track] as number[];
    source.events.forEach((event, index) => {
      if (event.type !== 'channel' || event.command !== 0xb0 || event.channel === DRUM_CHANNEL) {
        return;
      }
      const { tick } = event;
      const channel = ofTrack[index] as number;
      let to: PedalChange['to'];
      if (event.data1 === SUSTAIN_CONTROLLER) to = event.data2 >= PEDAL_DOWN_FROM ? 'down' : 'up';
      else if (event.data1 === RESET_ALL_CONTROLLERS) to = 'up';
      else if (event.data1 === ALL_SOUND_OFF_CONTROLLER) to = 'break';
      else return;
      changes.push({ tick, track, channel, to });
    });
  });
  // Stable, so each track's changes keep the file's order within a tick.
  changes.sort((a, b) => a.tick - b.tick || a.track - b.track);

  /** The channels holding the pedal down; any other is up, seen or not. */
  const held = new Set<number>();
  // The pedal tick by tick: its changes, each at its tick's whole millisecond.
  const byTick: { atMs: number; down: boolean }[] = [];
  const heldAgainAfterBreak = new Set<number>();
  for (let first = 0; first < changes.length;) {
    const { tick } = changes[first] as PedalChange;
    let next = first;
    // The tick's changes, track by track, each track's in the file's order.
    const byTrack = new Map<number, PedalChange[]>();
    for (; next < changes.length && (changes[next] as PedalChange).tick === tick; next += 1) {
      const change = changes[next] as PedalChange;
      const ofTrack = byTrack.get(change.track);
      if (ofTrack) ofTrack.push(change);
      else byTrack.set(change.track, [change]);
    }

    const wasDown = held.size > 0;
    // The pedal lifts if its channels can all have been up at one instant: no
    // channel holds throughout untouched, and each track, played in its own
    // order, has an instant when every channel it changes is up. How two
    // tracks' events at one tick fall against each other is not known, so any
    // such instants count as one — and a channel two tracks change can be up
    // whenever either of them lets it up, since either may come last.
    const tracksOf = new Map<number, Set<number>>();
    for (const [track, ofTrack] of byTrack) {
      for (const change of ofTrack) {
        const tracks = tracksOf.get(change.channel) ?? new Set<number>();
        tracks.add(track);
        tracksOf.set(change.channel, tracks);
      }
    }
    let dipped = true;
    for (const channel of held) if (!tracksOf.has(channel)) dipped = false;
    for (const [channel, tracks] of tracksOf) {
      if (tracks.size < 2 || !dipped || !held.has(channel)) continue;
      let letUp = false;
      for (const track of tracks) {
        const ofTrack = byTrack.get(track) as PedalChange[];
        if (ofTrack.some((change) => change.channel === channel && change.to !== 'down')) {
          letUp = true;
        }
      }
      if (!letUp) dipped = false;
    }
    for (const ofTrack of byTrack.values()) {
      if (!dipped) break;
      // This track's own channels; one shared with another track was settled above.
      const down = new Map<number, boolean>();
      for (const change of ofTrack) {
        if ((tracksOf.get(change.channel) as Set<number>).size > 1) continue;
        down.set(change.channel, held.has(change.channel));
      }
      const allUp = (): boolean => [...down.values()].every((isDown) => !isDown);
      let wasAllUp = allUp();
      for (const change of ofTrack) {
        if (!down.has(change.channel)) continue;
        if (change.to === 'break') {
          // Up for an instant, then as it was.
          const before = down.get(change.channel) as boolean;
          down.set(change.channel, false);
          if (allUp()) wasAllUp = true;
          down.set(change.channel, before);
        } else {
          down.set(change.channel, change.to === 'down');
          if (allUp()) wasAllUp = true;
        }
      }
      if (!wasAllUp) dipped = false;
    }
    // Where each channel ends: the tick's changes in order, track by track.
    for (const ofTrack of byTrack.values()) {
      for (const change of ofTrack) {
        if (change.to === 'down') held.add(change.channel);
        else if (change.to === 'up') held.delete(change.channel);
      }
    }
    const isDown = held.size > 0;

    // A pedal down before the tick and up after it was let up, however its
    // events fell. And an All Sound Off breaks it whatever other channels
    // hold: a take has one pedal, and leaving it down would hold on every note
    // the controller silences — a channel holding the pedal through it loses
    // what its pedal held, the lesser fault.
    if (!isDown) dipped = true;
    for (const ofTrack of byTrack.values()) {
      if (ofTrack.some((change) => change.to === 'break')) dipped = true;
    }

    const atMs = Math.round(msAtTick(tick));
    if (wasDown && dipped) byTick.push({ atMs, down: false });
    if (isDown && (!wasDown || dipped)) byTick.push({ atMs, down: true });
    // An All Sound Off's tick the pedal ends down on — pressed again after
    // the break, or pressed afresh on it — holds what is let go on it.
    if (isDown) {
      for (const ofTrack of byTrack.values()) {
        if (ofTrack.some((change) => change.to === 'break')) heldAgainAfterBreak.add(tick);
      }
    }
    first = next;
  }

  // Then a millisecond at a time, in the order the ticks gave.
  const pedals: { atMs: number; down: boolean }[] = [];
  let down = false;
  for (let first = 0; first < byTick.length;) {
    const { atMs } = byTick[first] as { atMs: number; down: boolean };
    const wasDown = down;
    let lifted = !wasDown;
    let next = first;
    for (; next < byTick.length && (byTick[next] as { atMs: number }).atMs === atMs; next += 1) {
      down = (byTick[next] as { down: boolean }).down;
      if (!down) lifted = true;
    }
    if (wasDown && lifted) pedals.push({ atMs, down: false });
    if (down && (!wasDown || lifted)) pedals.push({ atMs, down: true });
    first = next;
  }
  return { pedals, heldAgainAfterBreak };
}

/**
 * At most as many pedal changes as a take holds (the note limit caps them too).
 * A file may change pedal more often than that — a pedal hovering about the
 * half-way point through a long recording — and is still worth opening: the
 * changes past the limit are left out, as tempo changes past theirs are, and
 * the pedal is let up where they stop rather than held for the rest of the
 * piece. The changes alternate, a press after a release and a release after a
 * press, so dropping a last press leaves a release last.
 */
function withinPedalLimit(
  pedals: { atMs: number; down: boolean }[],
): { atMs: number; down: boolean }[] {
  if (pedals.length <= MAX_NOTE_COUNT) return pedals;
  const kept = pedals.slice(0, MAX_NOTE_COUNT);
  if (kept[kept.length - 1]?.down === true) kept.pop();
  return kept;
}

// ---------------------------------------------------------------------------

/**
 * Parse a Standard MIDI File into a normalized take.
 * Throws `MidiImportError` with human-readable issues on failure.
 */
export function midiToTake(bytes: Uint8Array, fileName?: string): Take {
  const smf = readSmf(bytes);
  const addressing = channelAddressing(smf);
  const { notes, drumNotes } = collectNotes(smf, addressing);
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
  const { pedals: settledPedals, heldAgainAfterBreak } = collectPedal(smf, addressing, msAtTick);
  const pedals = withinPedalLimit(settledPedals);
  // The milliseconds the pedal goes down on, as the take keeps it: a break's
  // tick moves a note only where the pedal is still pressed again there once
  // its millisecond is settled — a release a tick later may let it up instead.
  const pressedAt = new Set(pedals.filter((pedal) => pedal.down).map((pedal) => pedal.atMs));
  const letGoSooner = (tick: number): boolean =>
    heldAgainAfterBreak.has(tick) && pressedAt.has(Math.round(msAtTick(tick)));

  const imported: ImportedNote[] = [];
  const onsetTicks = new Set<number>();
  for (const note of notes) {
    const startMs = msAtTick(note.startTick);
    let endMs = msAtTick(note.endTick);
    if (letGoSooner(note.endTick)) {
      // Let go on a tick where All Sound Off broke the pedal and it went down
      // again: a millisecond sooner, so the press cannot hold it on. A note
      // struck within that millisecond never sounded — the controller
      // silenced it as it began — and has no millisecond left to be let go
      // in: kept as the shortest note a take holds, it would end after the
      // press and ring on, so it is left out.
      endMs -= 1;
      if (Math.round(endMs) <= Math.round(startMs)) continue;
    }
    imported.push({
      midi: note.midi,
      startMs,
      endMs,
      velocity: note.velocity,
      seq: note.seq,
      staff: staff(note),
    });
    onsetTicks.add(note.startTick);
  }
  if (imported.length === 0) throw fail('The file contains no playable notes.');
  const onsets = [...onsetTicks].map((tick) => tick / smf.ticksPerQuarter);

  return buildImportedTake(
    {
      notes: imported,
      nextSeq: notes.length,
      pedals,
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
