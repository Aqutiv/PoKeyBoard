import { midiToNoteName } from '@/utils/midi';
import type { LearnPhrase } from './types';

/** One note, filling a whole bar. Rhythm is a later chapter's subject, and a
 *  shorter note would pull rests onto the staff beside it. */
const PHRASE_BPM = 60;
const BAR_BEATS = 4;

const cache = new Map<number, LearnPhrase>();

/**
 * A phrase showing one note, cached by midi.
 *
 * The cache is not about speed — it is about **identity**. `StaffSnippet`
 * memoizes its engraved layout on the phrase object, and `ChapterRunner`
 * re-renders on every note-on and note-off while a round is being played.
 * A phrase built inline would therefore re-run the engraver and tear down a
 * `ResizeObserver` on every keystroke; a cached one is referentially stable
 * for as long as the round lasts.
 */
export function singleNotePhrase(midi: number): LearnPhrase {
  let phrase = cache.get(midi);
  if (!phrase) {
    phrase = {
      bpm: PHRASE_BPM,
      timeSignature: { numerator: 4, denominator: 4 },
      events: [[0, midiToNoteName(midi), BAR_BEATS, 0.7]],
    };
    cache.set(midi, phrase);
  }
  return phrase;
}
