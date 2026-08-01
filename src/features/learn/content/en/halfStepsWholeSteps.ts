import type { ChapterProse } from '../types';

/**
 * Chapter 3 in English. Assumes chapters 1 and 2: finding C, the black-key
 * groups, octaves, and the names of the white keys.
 */
export const halfStepsWholeStepsEn: ChapterProse = {
  smallestStep: {
    heading: 'The smallest step there is',
    body: [
      'A half step is simply the very next key along. Nothing sits between them.',
      'It does not matter what colour they are: C to the black key beside it is a half step, and so is E to F. Both pairs are marked here — press Listen to hear them.',
      'This is the smallest distance a piano can play. Everything else is built out of it.',
    ],
  },

  playHalfStep: {
    heading: 'Play a half step',
    body: [
      'Play any two keys that are right next to each other, with nothing in between. Anywhere on the keyboard, any two colours.',
    ],
    prompt: 'Play two keys that touch.',
  },

  wholeSteps: {
    heading: 'Two halves make a whole',
    body: [
      'A whole step is two half steps: play a key, skip exactly one, land on the next.',
      'C to D is a whole step — the black key marked between them is the one you step over. Most neighbouring white keys work this way.',
    ],
  },

  playWholeStep: {
    heading: 'Play a whole step',
    body: ['Play two keys with exactly one key skipped between them.'],
    prompt: 'Play two keys one step apart.',
  },

  whiteKeysTouch: {
    heading: 'Where the white keys touch',
    body: [
      'Two pairs break that rule, and they are the reason the black keys come in groups of two and three at all.',
      'E and F have no black key between them. Neither do B and C. Those two pairs are half steps, even though both keys are white.',
      'Find them by eye: they are the only places where two white keys sit side by side with no black key in the gap.',
    ],
  },

  playTouchingPairs: {
    heading: 'Play both of them',
    body: ['E then F, then B then C — going upwards, so each note is higher than the last.'],
    prompt: 'Play E, F, B, then C.',
  },

  sharps: {
    heading: 'Sharps',
    body: [
      'Now the black keys can be named. A black key takes the name of the white key just below it, with a ♯ after it — said "sharp".',
      'So the black key above C is C♯, the one above F is F♯, and so on. Five white keys have a black key above them, and those are the five black keys.',
    ],
  },

  nameTheBlackKey: {
    heading: 'Name the black key',
    body: [
      'A black key will light up. Find the white key just below it, and that gives you the name.',
    ],
  },

  flats: {
    heading: 'The same keys, named from above',
    body: [
      'A black key can just as well be named from the white key above it instead, with a ♭ after it — said "flat".',
      'That black key between C and D is C♯ counting up from C, and D♭ counting down from D. Same key, two names. Look at this diagram and the last one: they label exactly the same five keys.',
      'Which name gets used depends on the music around it. For now, what matters is knowing they are the same key.',
    ],
  },

  findNamedKeys: {
    heading: 'Find the key I name',
    body: [
      'Five keys, named with flats this time. Count down from the white key above.',
      'One of them will be a key you called something else a moment ago — that is the point.',
    ],
  },

  chapterComplete: {
    heading: 'That is chapter three',
    body: [
      'You now know the smallest distance on the keyboard, the two places where white keys break the pattern, and how to name all twelve keys — five of them two ways.',
      'Written down, a sharp is a ♯ sitting just before the note it changes. Here is C, then C♯, then D.',
      'That is everything about the instrument itself. From here on, the course is about reading what to play on it.',
    ],
  },
};
