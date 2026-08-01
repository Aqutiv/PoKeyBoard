import type { ChapterProse } from '../types';

/**
 * Chapter 2 in English. Builds only on chapter 1, and keeps octave numbers to
 * the one step that needs them — the letters are the lesson here.
 */
export const musicalAlphabetEn: ChapterProse = {
  sevenLetters: {
    heading: 'Seven letters, then it starts again',
    body: [
      'Music only uses seven letters: A, B, C, D, E, F, G. After G there is no H — it goes straight back to A and carries on.',
      'You already know how to find C. From there the white keys simply run up the alphabet: C, D, E, F, G, A, B, and then C again.',
      'Press Listen to hear all eight in a row.',
    ],
  },

  walkUp: {
    heading: 'Walk up from C',
    body: [
      'Start on a C and play every white key upwards, one at a time, until you reach the next C.',
      'Skip nothing and go in order — if you land on a wrong one, the count starts again from C.',
    ],
    prompt: 'Play the white keys in order from one C to the next.',
  },

  whereLettersHide: {
    heading: 'Where each letter hides',
    body: [
      'The black-key groups tell you every letter at a glance, not just C.',
      'Around the group of two: C is on its left, D sits between the two black keys, E is on its right.',
      'Around the group of three: F is on its left, G and A sit between the black keys, B is on its right.',
      'That is the whole map. Two landmarks, seven letters, and it repeats forever.',
    ],
  },

  nameTheKey: {
    heading: 'Which key is this?',
    body: [
      'Playing a key and knowing its name are two different things — this is the second. Use the black keys around the highlighted one to work out its letter.',
    ],
  },

  findDFA: {
    heading: 'Find D, then F, then A',
    body: [
      'Now the other way round: you are given the letter and you find the key.',
      'D is between the two black keys. F is just left of the three. A is the middle white key inside the three. Any octave will do.',
    ],
    prompt: 'Play a D, then an F, then an A.',
  },

  walkingBackDown: {
    heading: 'Walking back down',
    body: [
      'Going down, the alphabet runs backwards: C, B, A, G, F, E, D, C. Most people find this direction harder, which is exactly why it is worth doing.',
      'Press Listen, then say the letters along with it.',
    ],
  },

  walkDown: {
    heading: 'Walk down from C',
    body: ['Start on the higher C this time and come down one white key at a time to the C below.'],
    prompt: 'Play the white keys in order from one C down to the next.',
  },

  sameSevenEverywhere: {
    heading: 'The same seven, all the way up',
    body: [
      'Those seven letters are all there are. An 88-key piano is just this handful, repeated a little over seven times.',
      'Both keys highlighted here are A. The lower one is A3 and the higher one is A4 — same letter, different octave, exactly like the Cs in chapter one.',
    ],
  },

  twoDifferentAs: {
    heading: 'Play two different As',
    body: [
      'Find an A, then find another one somewhere else on the keyboard.',
      'If only one is on screen, slide the keyboard along — either with the ‹ and › arrows above the keys, or with the left and right arrow keys.',
    ],
    prompt: 'Play two different As.',
  },

  chapterComplete: {
    heading: 'That is chapter two',
    body: [
      'You can now name every white key on the piano, in both directions, without counting up from C every time.',
      'Here are the first three of them written down: C, D, E. Notice they climb the stave exactly as they climb the keyboard — line, space, line.',
      'Next comes the black keys, and the sharps and flats that name them.',
    ],
  },
};
