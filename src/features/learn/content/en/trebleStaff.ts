import type { ChapterProse } from '../types';

/**
 * Chapter 4 in English. Assumes chapters 1–3: the keyboard, the note names,
 * and sharps and flats. Nothing here needs rhythm, which is chapter 6.
 */
export const trebleStaffEn: ChapterProse = {
  fiveLines: {
    heading: 'Five lines and four spaces',
    body: [
      'Written music sits on a stave: five lines with four spaces between them. A note is drawn either on a line or in a space — never between the two.',
      'One rule makes the whole thing readable: the higher a note sits, the higher it sounds. These two are the same shape, and the second one is much higher up.',
    ],
  },

  trebleClef: {
    heading: 'The treble clef',
    body: [
      'That curl at the front is a treble clef, and it is what pins everything down. Its spiral wraps around the second line up — and that line is G.',
      'Fix one note and every other one follows, because the lines and spaces just run up the alphabet from there.',
      'This is the clef your right hand usually reads.',
    ],
  },

  middleCBelow: {
    heading: 'Middle C sits just below',
    body: [
      'Middle C is too low for this stave, so it hangs underneath with a short line of its own. That extra line is called a ledger line.',
      'It is the same middle C you found in chapter one — the one in front of a group of two black keys, nearest the middle of the piano. This is what it looks like written down.',
    ],
  },

  playMiddleC: {
    heading: 'Play what you see',
    body: [
      'The note above is middle C. Find it on the keyboard and play it — read it this time, rather than being told where it is.',
    ],
    prompt: 'Play the note on the stave.',
  },

  fiveNotes: {
    heading: 'C, D, E, F, G',
    body: [
      'Climbing up from middle C: D sits in the space just under the stave, E is on the bottom line, F is in the first space, and G is on the second line — the one the clef curls around.',
      'Notice the pattern: space, line, space, line. Every step up the alphabet is one step up the stave.',
      'These five notes are all you need for a surprising amount of music.',
    ],
  },

  fingerNumbers: {
    heading: 'Your five fingers',
    body: [
      'Pianists number their fingers: thumb is 1, index is 2, and so on out to the little finger, 5. Both hands, thumbs are always 1.',
      'Put your right thumb on middle C and let the other four fall on D, E, F and G. That is the five-finger position, and while you are in it your hand never has to move — one finger already waits on every note.',
    ],
  },

  whichNote: {
    heading: 'Which note is this?',
    body: [
      'A note will appear on the stave. Work out its letter from where it sits: middle C hangs below on its ledger line, E is the bottom line, G is the line the clef curls around.',
    ],
  },

  playWhatYouRead: {
    heading: 'Play the note shown',
    body: ['Same five notes, the other way round. Read it, then find it — no letter this time.'],
  },

  runUp: {
    heading: 'Play the whole run',
    body: [
      'All five in order, bottom to top, straight off the stave. If you are in the five-finger position, that is simply thumb to little finger.',
    ],
    prompt: 'Play C, D, E, F, then G.',
  },

  runDown: {
    heading: 'And back down',
    body: ['The same five reversed — little finger back to thumb.'],
    prompt: 'Play G, F, E, D, then C.',
  },

  chapterComplete: {
    heading: 'That is chapter four',
    body: [
      'You can read the treble stave now: five lines, four spaces, a clef that fixes G, and middle C waiting on a ledger line underneath.',
      'Those three notes are C, E and G — the ones you just learned, and a chord you will meet properly in chapter nine.',
      'Next: the second stave, the one your left hand reads, and how the two join into the shape all piano music is written in.',
    ],
  },
};
