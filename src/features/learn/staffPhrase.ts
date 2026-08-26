import type { NoteStaff } from '@/domain/takeTypes';
import type { TrackEvent } from '@/features/library/trackBuilder';
import type { StaffMode } from '@/features/notation/scoreRenderer';
import { midiToNoteName } from '@/utils/midi';
import type { LearnPhrase } from './types';

/** One note, filling a whole bar. Rhythm is a later chapter's subject, and a
 *  shorter note would pull rests onto the staff beside it. */
const PHRASE_BPM = 60;
const BAR_BEATS = 4;

const cache = new Map<string, LearnPhrase>();

/**
 * A phrase showing one note, cached by midi and staff.
 *
 * The cache is not about speed — it is about **identity**. `StaffSnippet`
 * memoizes its engraved layout on the phrase object, and `ChapterRunner`
 * re-renders on every note-on and note-off while a round is being played.
 * A phrase built inline would therefore re-run the engraver and tear down a
 * `ResizeObserver` on every keystroke; a cached one is referentially stable
 * for as long as the round lasts.
 *
 * The key is composite because middle C on the bass staff and middle C on the
 * treble staff are one pitch and two different pictures.
 */
export function singleNotePhrase(midi: number, staff?: NoteStaff): LearnPhrase {
  const key = staff === undefined ? `${midi}` : `${midi}|${staff}`;
  let phrase = cache.get(key);
  if (!phrase) {
    const name = midiToNoteName(midi);
    // Spelled out rather than spread, so the tuple keeps inferring as a
    // `TrackEvent` instead of widening to an array of unions.
    const event: TrackEvent =
      staff === undefined ? [0, name, BAR_BEATS, 0.7] : [0, name, BAR_BEATS, 0.7, staff];
    phrase = {
      bpm: PHRASE_BPM,
      timeSignature: { numerator: 4, denominator: 4 },
      events: [event],
    };
    cache.set(key, phrase);
  }
  return phrase;
}

/**
 * The view a note-level staff hint asks for. Undefined means the treble staff,
 * which is what every chapter before the bass one draws.
 */
export function staffModeFor(staff?: NoteStaff): StaffMode {
  return staff ?? 'treble';
}
