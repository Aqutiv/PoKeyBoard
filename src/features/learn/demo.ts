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
 *
 * `startAtAudioTime` picks the moment the phrase begins. A rhythm lesson
 * passes the next bar line of its click, so the demo lands *on* the beats the
 * user is about to be graded against — played from wherever the button
 * happened to be pressed, the same phrase would drift against the click and
 * teach the opposite of the step. Omitted, it starts as soon as it safely can.
 */
export async function playPhrase(phrase: LearnPhrase, startAtAudioTime?: number): Promise<number> {
  const notes = phraseToNotes(phrase);
  if (notes.length === 0) return 0;

  // Unlocked first, before anything that can take a while: transient user
  // activation expires, and fetching a cold range can outlive the click that
  // asked for it — leaving `resume()` to be refused and the demo scheduled
  // into a suspended context. `transportController.record` orders it the same
  // way. The app also unlocks on its first interaction, so this is the
  // second line of defence rather than the first.
  await audioEngine.unlockFromUserGesture();

  const midis = notes.map((note) => note.midi);
  // A demo can name notes well outside the visible window, and scheduleNote is
  // silent for any pitch with no decoded sample.
  await audioEngine.ensurePlayableRange(Math.min(...midis), Math.max(...midis));

  // Never earlier than the slack allows, however stale the requested time is
  // by the time the range above finished loading.
  const earliest = audioEngine.currentTime + START_SLACK_S;
  const startTime = Math.max(earliest, startAtAudioTime ?? earliest);
  const waitedMs = (startTime - audioEngine.currentTime) * 1000;
  for (const note of notes) {
    audioEngine.scheduleNote(
      { midi: note.midi, velocity: note.velocity, durationMs: note.durationMs },
      startTime + note.startMs / 1000,
      'learn',
    );
  }
  return phraseDurationMs(notes) + waitedMs;
}
