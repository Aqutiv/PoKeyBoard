import { ScoreImportError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { isValidMidi } from '@/utils/midi';
import { createEmptyTake, UNTITLED_TAKE_TITLE } from './noteEvents';
import { normalizeTake } from './takeSchema';
import {
  MAX_NOTE_COUNT,
  MAX_NOTE_DURATION_MS,
  MAX_TAKE_MS,
  type NoteEvent,
  type PedalEvent,
  type Take,
  type TimeSignature,
} from './takeTypes';

/** MusicXML <step> letters to pitch classes; <alter> is applied on top. */
const STEP_TO_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MusicXML dynamics are percentages of forte, which is MIDI velocity 90. */
const FORTE_MIDI_VELOCITY = 90;
const DEFAULT_DYNAMICS_PERCENT = 100;

/** A tie stop must land where the tied note ends (quarter-note units). */
const TIE_CONTINUITY_EPSILON = 1e-3;

/** <beat-unit> values as multiples of a quarter note, for metronome marks. */
const METRONOME_UNIT_QUARTERS: Record<string, number> = {
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

/** All positions/durations in quarter-note units until tempo integration. */
interface QNote {
  midi: number;
  onsetQ: number;
  durQ: number;
  velocity: number;
}

interface QPedal {
  atQ: number;
  down: boolean;
}

interface TempoEntry {
  atQ: number;
  bpm: number;
}

/** A tie-start (or chain) waiting for its stop; endQ grows link by link. */
interface PendingTie {
  midi: number;
  onsetQ: number;
  endQ: number;
  velocity: number;
}

interface CollectedScore {
  notes: QNote[];
  pedals: QPedal[];
  tempi: TempoEntry[];
  timeSignature: TimeSignature | null;
  title: string | null;
}

function childByTag(el: Element, tag: string): Element | null {
  for (const child of el.children) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function textByTag(el: Element, tag: string): string | null {
  const text = childByTag(el, tag)?.textContent?.trim();
  return text ? text : null;
}

function numberByTag(el: Element, tag: string): number | null {
  const text = textByTag(el, tag);
  if (text === null) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function attrNumber(el: Element, name: string): number | null {
  const text = el.getAttribute(name);
  if (text === null) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pendingToNote(pending: PendingTie): QNote {
  return {
    midi: pending.midi,
    onsetQ: pending.onsetQ,
    durQ: pending.endQ - pending.onsetQ,
    velocity: pending.velocity,
  };
}

/**
 * The pending tie a stop note closes: same voice first, then any voice of the
 * same pitch whose end lines up with this onset (cross-voice/staff ties).
 */
function findPendingTie(
  pendings: Map<string, PendingTie>,
  key: string,
  midi: number,
  onsetQ: number,
): [string, PendingTie] | null {
  const direct = pendings.get(key);
  if (direct && Math.abs(direct.endQ - onsetQ) < TIE_CONTINUITY_EPSILON) return [key, direct];
  for (const [candidateKey, candidate] of pendings) {
    if (candidate.midi === midi && Math.abs(candidate.endQ - onsetQ) < TIE_CONTINUITY_EPSILON) {
      return [candidateKey, candidate];
    }
  }
  return null;
}

/** Both <tie> and <notations><tied> carry tie types; some tools write one. */
function collectTieTypes(note: Element): Set<string> {
  const types = new Set<string>();
  for (const child of note.children) {
    if (child.tagName === 'tie') {
      const type = child.getAttribute('type');
      if (type) types.add(type);
    } else if (child.tagName === 'notations') {
      for (const notation of child.children) {
        if (notation.tagName === 'tied') {
          const type = notation.getAttribute('type');
          if (type) types.add(type);
        }
      }
    }
  }
  return types;
}

/**
 * Walk one part's measures in document order, appending events to `out`.
 * Returns the part's final divisions value, used to seed the next part in
 * case a malformed file omits its declaration.
 */
function collectPart(
  part: Element,
  seedDivisions: number | null,
  out: CollectedScore,
): number | null {
  let divisions = seedDivisions;
  let cursorQ = 0;
  let measureStartQ = 0;
  let chordAnchorQ: number | null = null;
  let dynamicsPercent: number | null = null;
  let currentTs: TimeSignature | null = null;
  const pendingTies = new Map<string, PendingTie>();

  const quartersOf = (el: Element): number => {
    const duration = numberByTag(el, 'duration');
    if (duration === null || duration <= 0) return 0;
    if (divisions === null || divisions <= 0) {
      throw new ScoreImportError(['The score uses durations before declaring <divisions>.']);
    }
    return duration / divisions;
  };

  const applySound = (sound: Element): void => {
    const tempo = attrNumber(sound, 'tempo');
    if (tempo !== null && tempo > 0) out.tempi.push({ atQ: cursorQ, bpm: tempo });
    const dynamics = attrNumber(sound, 'dynamics');
    if (dynamics !== null && dynamics >= 0) dynamicsPercent = dynamics;
  };

  const applyPedal = (type: string | null): void => {
    if (type === 'start') {
      out.pedals.push({ atQ: cursorQ, down: true });
    } else if (type === 'stop') {
      out.pedals.push({ atQ: cursorQ, down: false });
    } else if (type === 'change') {
      out.pedals.push({ atQ: cursorQ, down: false });
      out.pedals.push({ atQ: cursorQ, down: true });
    }
  };

  const applyMetronome = (metronome: Element): void => {
    const unit = textByTag(metronome, 'beat-unit');
    const perMinute = numberByTag(metronome, 'per-minute');
    if (unit === null || perMinute === null || perMinute <= 0) return;
    let factor = METRONOME_UNIT_QUARTERS[unit];
    if (factor === undefined) return;
    for (const child of metronome.children) {
      if (child.tagName === 'beat-unit-dot') factor *= 1.5;
    }
    out.tempi.push({ atQ: cursorQ, bpm: perMinute * factor });
  };

  for (const measure of part.children) {
    if (measure.tagName !== 'measure') continue;
    let maxQ = cursorQ;
    for (const el of measure.children) {
      switch (el.tagName) {
        case 'attributes': {
          const declared = numberByTag(el, 'divisions');
          if (declared !== null && declared > 0) divisions = declared;
          const time = childByTag(el, 'time');
          if (time) {
            const beats = textByTag(time, 'beats');
            const beatType = textByTag(time, 'beat-type');
            if (
              beats !== null &&
              beatType !== null &&
              /^\d+$/.test(beats) &&
              /^\d+$/.test(beatType)
            ) {
              const ts = {
                numerator: Number.parseInt(beats, 10),
                denominator: Number.parseInt(beatType, 10),
              };
              currentTs = ts;
              out.timeSignature ??= ts;
            }
          }
          break;
        }
        case 'note': {
          if (childByTag(el, 'grace')) break; // no duration of its own; skip
          const isChord = childByTag(el, 'chord') !== null;
          const isRest = childByTag(el, 'rest') !== null;
          const isCue = childByTag(el, 'cue') !== null;
          const pitch = childByTag(el, 'pitch');
          const durQ = quartersOf(el);
          const onsetQ = isChord ? (chordAnchorQ ?? cursorQ) : cursorQ;
          if (!isChord) {
            chordAnchorQ = isRest ? null : cursorQ;
            cursorQ += durQ;
            maxQ = Math.max(maxQ, cursorQ);
          }
          if (isRest || isCue || pitch === null) break; // advanced; nothing sounds

          const step = textByTag(pitch, 'step');
          const octave = numberByTag(pitch, 'octave');
          const alter = numberByTag(pitch, 'alter') ?? 0;
          const pitchClass = step === null ? undefined : STEP_TO_PITCH_CLASS[step];
          if (pitchClass === undefined || octave === null) break;
          const midi = 12 * (Math.round(octave) + 1) + pitchClass + Math.round(alter);
          if (!isValidMidi(midi)) break;

          const percent = attrNumber(el, 'dynamics') ?? dynamicsPercent ?? DEFAULT_DYNAMICS_PERCENT;
          const velocity = clamp((percent / 100) * (FORTE_MIDI_VELOCITY / 127), 0, 1);
          const tieTypes = collectTieTypes(el);
          const hasStart = tieTypes.has('start');
          const hasStop = tieTypes.has('stop');
          const key = `${textByTag(el, 'voice') ?? '1'}|${midi}`;
          const endQ = onsetQ + durQ;

          if (hasStop) {
            const found = findPendingTie(pendingTies, key, midi, onsetQ);
            if (found) {
              const [foundKey, pending] = found;
              pendingTies.delete(foundKey);
              pending.endQ = endQ;
              if (hasStart)
                pendingTies.set(key, pending); // middle of a chain
              else out.notes.push(pendingToNote(pending));
            } else if (hasStart) {
              pendingTies.set(key, { midi, onsetQ, endQ, velocity });
            } else {
              out.notes.push({ midi, onsetQ, durQ, velocity }); // orphan stop
            }
          } else if (hasStart) {
            const stale = pendingTies.get(key);
            if (stale) out.notes.push(pendingToNote(stale));
            pendingTies.set(key, { midi, onsetQ, endQ, velocity });
          } else {
            out.notes.push({ midi, onsetQ, durQ, velocity });
          }
          break;
        }
        case 'backup': {
          cursorQ = Math.max(measureStartQ, cursorQ - quartersOf(el));
          chordAnchorQ = null;
          break;
        }
        case 'forward': {
          cursorQ += quartersOf(el);
          maxQ = Math.max(maxQ, cursorQ);
          break;
        }
        case 'direction': {
          const sound = childByTag(el, 'sound');
          if (sound) applySound(sound);
          for (const directionType of el.children) {
            if (directionType.tagName !== 'direction-type') continue;
            const pedal = childByTag(directionType, 'pedal');
            if (pedal) applyPedal(pedal.getAttribute('type'));
            if (sound === null || attrNumber(sound, 'tempo') === null) {
              const metronome = childByTag(directionType, 'metronome');
              if (metronome) applyMetronome(metronome);
            }
          }
          break;
        }
        case 'sound': {
          applySound(el);
          break;
        }
        default:
          break; // barline, harmony, print, …
      }
    }
    // The next measure starts at the furthest position any voice reached; a
    // measure with no content still advances by its nominal length so
    // parallel parts stay aligned.
    maxQ = Math.max(maxQ, cursorQ);
    if (maxQ - measureStartQ < 1e-9) {
      const ts = currentTs ?? { numerator: 4, denominator: 4 };
      maxQ = measureStartQ + ts.numerator * (4 / ts.denominator);
    }
    cursorQ = maxQ;
    measureStartQ = cursorQ;
    chordAnchorQ = null;
  }

  for (const pending of pendingTies.values()) {
    out.notes.push(pendingToNote(pending)); // tie never closed; keep the note
  }
  return divisions;
}

function collectScore(root: Element): CollectedScore {
  const out: CollectedScore = {
    notes: [],
    pedals: [],
    tempi: [],
    timeSignature: null,
    title: null,
  };
  const work = childByTag(root, 'work');
  out.title = (work ? textByTag(work, 'work-title') : null) ?? textByTag(root, 'movement-title');

  let divisions: number | null = null;
  for (const part of root.children) {
    if (part.tagName === 'part') divisions = collectPart(part, divisions, out);
  }
  return out;
}

interface TempoMap {
  msAt: (q: number) => number;
  firstBpm: number;
}

/**
 * Piecewise-constant tempo integration. Entries are collected part by part,
 * so they must be re-sorted by position; duplicates at one position collapse
 * to the last one seen.
 */
function createTempoMap(entries: readonly TempoEntry[]): TempoMap {
  const sorted = entries
    .filter((entry) => Number.isFinite(entry.bpm) && entry.bpm > 0 && entry.atQ >= 0)
    .sort((a, b) => a.atQ - b.atQ);
  const segments: TempoEntry[] = [];
  for (const entry of sorted) {
    const last = segments[segments.length - 1];
    if (last && entry.atQ - last.atQ < 1e-9) last.bpm = entry.bpm;
    else segments.push({ ...entry });
  }
  const first = segments[0];
  if (first === undefined) segments.push({ atQ: 0, bpm: 120 });
  else if (first.atQ > 0) segments.unshift({ atQ: 0, bpm: first.bpm });

  const startMs: number[] = [0];
  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1] as TempoEntry;
    const current = segments[i] as TempoEntry;
    startMs.push((startMs[i - 1] as number) + ((current.atQ - prev.atQ) * 60000) / prev.bpm);
  }

  const msAt = (q: number): number => {
    const target = Math.max(0, q);
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((segments[mid] as TempoEntry).atQ <= target) lo = mid;
      else hi = mid - 1;
    }
    const segment = segments[lo] as TempoEntry;
    return (startMs[lo] as number) + ((target - segment.atQ) * 60000) / segment.bpm;
  };

  return { msAt, firstBpm: (segments[0] as TempoEntry).bpm };
}

function fileTitle(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.[^.]*$/, '').trim();
  return base.length > 0 ? base : null;
}

/**
 * Parse MusicXML text (score-partwise) into a normalized Take.
 * Throws ScoreImportError with human-readable issues on failure.
 */
export function musicXmlToTake(xmlText: string, fileName?: string): Take {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ScoreImportError(['The file is not well-formed XML.']);
  }
  const root = doc.documentElement;
  if (root.tagName === 'score-timewise') {
    throw new ScoreImportError([
      'score-timewise MusicXML is not supported; re-export as score-partwise.',
    ]);
  }
  if (root.tagName !== 'score-partwise') {
    throw new ScoreImportError([`<${root.tagName}> is not a MusicXML score.`]);
  }

  const collected = collectScore(root);
  if (collected.notes.length === 0) {
    throw new ScoreImportError(['The score contains no playable notes.']);
  }
  if (collected.notes.length > MAX_NOTE_COUNT) {
    throw new ScoreImportError([
      `The score has ${collected.notes.length} notes; the limit is ${MAX_NOTE_COUNT}.`,
    ]);
  }

  const { msAt, firstBpm } = createTempoMap(collected.tempi);
  // Rounding endpoints (not durations) keeps adjacent notes seamless.
  const notes: NoteEvent[] = collected.notes.map((note) => {
    const startMs = Math.round(msAt(note.onsetQ));
    const endMs = Math.round(msAt(note.onsetQ + note.durQ));
    return {
      id: newId(),
      midi: note.midi,
      startMs,
      durationMs: clamp(endMs - startMs, 1, MAX_NOTE_DURATION_MS),
      velocity: note.velocity,
    };
  });
  let maxEndMs = 0;
  for (const note of notes) maxEndMs = Math.max(maxEndMs, note.startMs + note.durationMs);
  if (maxEndMs > MAX_TAKE_MS) {
    throw new ScoreImportError(['The score is longer than the 6-hour take limit.']);
  }
  const pedalEvents: PedalEvent[] = collected.pedals
    .map((pedal) => ({ atMs: Math.round(msAt(pedal.atQ)), down: pedal.down }))
    .filter((pedal) => pedal.atMs <= MAX_TAKE_MS);

  const ts = collected.timeSignature;
  const timeSignature =
    ts !== null &&
    Number.isInteger(ts.numerator) &&
    ts.numerator >= 1 &&
    ts.numerator <= 16 &&
    (ts.denominator === 2 || ts.denominator === 4 || ts.denominator === 8 || ts.denominator === 16)
      ? ts
      : { numerator: 4, denominator: 4 };

  const title =
    (collected.title ?? fileTitle(fileName) ?? UNTITLED_TAKE_TITLE).trim().slice(0, 200) ||
    UNTITLED_TAKE_TITLE;

  return normalizeTake(
    createEmptyTake({
      title,
      tempo: { bpm: clamp(firstBpm, 40, 240), timeSignature, countInBars: 1 },
      notes,
      pedalEvents,
    }),
  );
}
