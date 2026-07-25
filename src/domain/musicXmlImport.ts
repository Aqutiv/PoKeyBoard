import { ScoreImportError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { isValidMidi } from '@/utils/midi';
import { createEmptyTake, UNTITLED_TAKE_TITLE } from './noteEvents';
import { normalizeTake } from './takeSchema';
import { createQuarterTempoMap, tempoChangesFrom } from './tempoMap';
import {
  MAX_NOTE_COUNT,
  MAX_NOTE_DURATION_MS,
  MAX_NOTE_VOICE,
  MAX_TAKE_MS,
  MAX_TEMPO_CHANGES,
  type NoteClef,
  type NoteEvent,
  type NoteStaff,
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
  /** Engraving-only hints; undefined when the score does not say. */
  staff: NoteStaff | undefined;
  voice: number | undefined;
  clef: NoteClef | undefined;
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
  staff: NoteStaff | undefined;
  voice: number | undefined;
  clef: NoteClef | undefined;
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
    // A tie sounds as one note, so the whole chain belongs where it started.
    staff: pending.staff,
    voice: pending.voice,
    clef: pending.clef,
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
  let staffCount = 1;
  const pendingTies = new Map<string, PendingTie>();
  /** Staff number → the clef currently in force on it, once it is declared. */
  const clefByStaff = new Map<number, NoteClef>();
  /** `${staff}|${source voice}` → the small voice number we assign it. */
  const voiceNumbers = new Map<string, number>();
  /** Per staff, the next voice number to hand out. */
  const nextVoice = new Map<string, number>();

  const quartersOf = (el: Element): number => {
    const duration = numberByTag(el, 'duration');
    if (duration === null || duration <= 0) return 0;
    if (divisions === null || divisions <= 0) {
      throw new ScoreImportError(['The score uses durations before declaring <divisions>.']);
    }
    return duration / divisions;
  };

  /**
   * Which side of the grand staff a note was written on. MusicXML numbers a
   * part's staffs from the top down, so staff 1 is the right hand and anything
   * under it belongs on the bass staff; an omitted <staff> means staff 1. A
   * part with a single staff says nothing about hands, so it stays undefined
   * and the notation falls back to splitting at middle C.
   */
  const staffOf = (note: Element): NoteStaff | undefined => {
    if (staffCount < 2) return undefined;
    const declared = numberByTag(note, 'staff');
    return declared !== null && Math.round(declared) >= 2 ? 'bass' : 'treble';
  };

  /**
   * Voice numbers are per-part labels that can be anything (this Mozart edition
   * uses "1" on the upper staff and "5" on the lower). They only have to be
   * stable and small, so each staff renumbers them from 0 as they appear.
   */
  const voiceOf = (note: Element, staff: NoteStaff | undefined): number | undefined => {
    const source = textByTag(note, 'voice');
    if (source === null) return undefined;
    const staffKey = staff ?? '';
    const key = `${staffKey}|${source}`;
    const known = voiceNumbers.get(key);
    if (known !== undefined) return known;
    const assigned = nextVoice.get(staffKey) ?? 0;
    if (assigned > MAX_NOTE_VOICE) return undefined; // absurdly many voices
    nextVoice.set(staffKey, assigned + 1);
    voiceNumbers.set(key, assigned);
    return assigned;
  };

  /**
   * The clef a note is read under, but only when it is not the one its staff
   * normally carries — the notation falls back to that, so saying nothing
   * keeps ordinary scores exactly as they were. A C clef (alto, tenor) has no
   * equivalent here and is ignored, leaving the staff's own clef in force.
   */
  const clefOf = (staff: NoteStaff | undefined, staffNumber: number): NoteClef | undefined => {
    const declared = clefByStaff.get(staffNumber);
    if (declared === undefined) return undefined;
    const normal: NoteClef = staff === 'bass' ? 'bass' : 'treble';
    return declared === normal ? undefined : declared;
  };

  const applySound = (sound: Element, atQ: number): void => {
    const tempo = attrNumber(sound, 'tempo');
    if (tempo !== null && tempo > 0) out.tempi.push({ atQ, bpm: tempo });
    // Dynamics is a running state applied to later notes in document order, so
    // a direction offset does not reposition it.
    const dynamics = attrNumber(sound, 'dynamics');
    if (dynamics !== null && dynamics >= 0) dynamicsPercent = dynamics;
  };

  const applyPedal = (type: string | null, atQ: number): void => {
    if (type === 'start') {
      out.pedals.push({ atQ, down: true });
    } else if (type === 'stop') {
      out.pedals.push({ atQ, down: false });
    } else if (type === 'change') {
      out.pedals.push({ atQ, down: false });
      out.pedals.push({ atQ, down: true });
    }
  };

  const applyMetronome = (metronome: Element, atQ: number): void => {
    const unit = textByTag(metronome, 'beat-unit');
    const perMinute = numberByTag(metronome, 'per-minute');
    if (unit === null || perMinute === null || perMinute <= 0) return;
    let factor = METRONOME_UNIT_QUARTERS[unit];
    if (factor === undefined) return;
    for (const child of metronome.children) {
      if (child.tagName === 'beat-unit-dot') factor *= 1.5;
    }
    out.tempi.push({ atQ, bpm: perMinute * factor });
  };

  /**
   * The quarter-note shift from an element's <offset> child, or null when it
   * has none that sounds. A <direction> or a <sound> may carry one; per the
   * MusicXML spec it only affects playback when sound="yes", and a <sound>'s
   * own offset overrides its parent <direction>'s. The note cursor is unmoved.
   */
  const soundingOffsetQ = (el: Element): number | null => {
    const offset = childByTag(el, 'offset');
    if (offset === null || offset.getAttribute('sound') !== 'yes') return null;
    const value = Number.parseFloat(offset.textContent?.trim() ?? '');
    if (!Number.isFinite(value) || divisions === null || divisions <= 0) return null;
    return value / divisions;
  };

  for (const measure of part.children) {
    if (measure.tagName !== 'measure') continue;
    let maxQ = cursorQ;
    for (const el of measure.children) {
      switch (el.tagName) {
        case 'attributes': {
          const declared = numberByTag(el, 'divisions');
          if (declared !== null && declared > 0) divisions = declared;
          const staves = numberByTag(el, 'staves');
          if (staves !== null && staves >= 1) staffCount = Math.round(staves);
          // Clefs can turn over mid-part, and the lower staff of a piano score
          // routinely takes a G clef where the left hand climbs.
          for (const child of el.children) {
            if (child.tagName !== 'clef') continue;
            const sign = textByTag(child, 'sign');
            const number = attrNumber(child, 'number');
            const staffNumber = number === null ? 1 : Math.round(number);
            if (sign === 'G' || sign === 'F') {
              clefByStaff.set(staffNumber, sign === 'G' ? 'treble' : 'bass');
            } else {
              // A C clef (alto, tenor) has no equivalent here. It still ends
              // whatever was in force, so the staff goes back to reading under
              // its own clef rather than carrying a stale override onward.
              clefByStaff.delete(staffNumber);
            }
          }
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
          const staffNumber = Math.round(numberByTag(el, 'staff') ?? 1);
          const staff = staffOf(el);
          const voice = voiceOf(el, staff);
          const clef = clefOf(staff, staffNumber);
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
              pendingTies.set(key, { midi, onsetQ, endQ, velocity, staff, voice, clef });
            } else {
              out.notes.push({ midi, onsetQ, durQ, velocity, staff, voice, clef }); // orphan stop
            }
          } else if (hasStart) {
            const stale = pendingTies.get(key);
            if (stale) out.notes.push(pendingToNote(stale));
            pendingTies.set(key, { midi, onsetQ, endQ, velocity, staff, voice, clef });
          } else {
            out.notes.push({ midi, onsetQ, durQ, velocity, staff, voice, clef });
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
          const directionQ = cursorQ + (soundingOffsetQ(el) ?? 0);
          const sound = childByTag(el, 'sound');
          if (sound) {
            // A <sound>'s own offset overrides the direction-level one.
            const soundOwn = soundingOffsetQ(sound);
            applySound(sound, soundOwn !== null ? cursorQ + soundOwn : directionQ);
          }
          for (const directionType of el.children) {
            if (directionType.tagName !== 'direction-type') continue;
            const pedal = childByTag(directionType, 'pedal');
            if (pedal) applyPedal(pedal.getAttribute('type'), directionQ);
            if (sound === null || attrNumber(sound, 'tempo') === null) {
              const metronome = childByTag(directionType, 'metronome');
              if (metronome) applyMetronome(metronome, directionQ);
            }
          }
          break;
        }
        case 'sound': {
          applySound(el, cursorQ);
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

  // Quarter-note positions become milliseconds through the score's tempo map;
  // its changes ride along on the take so the notation can draw them.
  const tempoMap = createQuarterTempoMap(collected.tempi);
  const msAt = (q: number): number => tempoMap.msAtBeat(q);
  const firstBpm = tempoMap.baseBpm;
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
      // Left off entirely when the score is silent about them, so takes from
      // single-staff sources stay byte-identical to what they were before.
      ...(note.staff !== undefined ? { staff: note.staff } : {}),
      ...(note.voice !== undefined ? { voice: note.voice } : {}),
      ...(note.clef !== undefined ? { clef: note.clef } : {}),
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

  const tempoChanges = tempoChangesFrom(tempoMap)
    .filter((change) => change.atMs <= MAX_TAKE_MS)
    .slice(0, MAX_TEMPO_CHANGES)
    .map((change) => ({ ...change, bpm: clamp(change.bpm, 40, 240) }));

  return normalizeTake(
    createEmptyTake({
      title,
      tempo: {
        bpm: clamp(firstBpm, 40, 240),
        timeSignature,
        countInBars: 1,
        ...(tempoChanges.length > 0 ? { changes: tempoChanges } : {}),
      },
      notes,
      pedalEvents,
    }),
  );
}
