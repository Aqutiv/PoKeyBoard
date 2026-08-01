import { audioEngine } from '@/audio/AudioEngine';
import { phraseDurationMs, phraseToNotes } from './phrase';
import type { LearnPhrase } from './types';

/** Enough lead time for the scheduler to place the first note cleanly. */
const START_SLACK_S = 0.06;

/**
 * Play a worked example.
 *
 * Uses `scheduleNote`, which deliberately emits no input events — so a demo
 * can never be mistaken by the exercise matcher for the user playing, and
 * pressing Listen can never complete a step for them.
 *
 * Returns how long the phrase lasts, so the caller can keep the button
 * disabled for the duration: scheduled notes cannot be cancelled, and
 * `allNotesOff` would cut the user's own held keys as well.
 */
export async function playPhrase(phrase: LearnPhrase): Promise<number> {
  const notes = phraseToNotes(phrase);
  if (notes.length === 0) return 0;

  const midis = notes.map((note) => note.midi);
  // A demo can name notes well outside the visible window, and scheduleNote is
  // silent for any pitch with no decoded sample.
  await audioEngine.ensurePlayableRange(Math.min(...midis), Math.max(...midis));
  await audioEngine.unlockFromUserGesture();

  const startTime = audioEngine.currentTime + START_SLACK_S;
  for (const note of notes) {
    audioEngine.scheduleNote(
      { midi: note.midi, velocity: note.velocity, durationMs: note.durationMs },
      startTime + note.startMs / 1000,
      'learn',
    );
  }
  return phraseDurationMs(notes) + START_SLACK_S * 1000;
}
