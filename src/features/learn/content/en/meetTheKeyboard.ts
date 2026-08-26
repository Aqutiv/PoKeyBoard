import type { ChapterProse } from '../types';

/**
 * Chapter 1 in English. Written for someone who has genuinely never played:
 * no term is used before the step that introduces it, and "octave" in
 * particular is avoided until step 9 earns it.
 */
export const meetTheKeyboardEn: ChapterProse = {
  makeSound: {
    heading: 'Press a key',
    body: [
      'This is a piano. It has one job: when you press a key, it makes a sound.',
      'There is no wrong key. Press a few and listen to them.',
    ],
    prompt: 'Play any three keys.',
  },

  highAndLow: {
    heading: 'Low on the left, high on the right',
    body: [
      'The keys run in order. The ones on the left sound low and heavy; the ones on the right sound high and bright. That is the entire map, side to side.',
      'Press Listen to hear both ends of it.',
      'One extra thing while you are here: how hard you press changes how loud the note is. If you are tapping the keys on screen, pressing nearer the bottom of a key plays it louder.',
    ],
  },

  lowThenHigh: {
    heading: 'Travel across',
    body: [
      'Play a key somewhere on the low side, then one well up to the right — about eight white keys along, or further.',
      'You should hear the difference clearly. If the two notes sound close together, go further.',
    ],
    prompt: 'Play a low key, then a much higher one.',
  },

  blackKeyGroups: {
    heading: 'The black keys come in twos and threes',
    body: [
      'A full piano has 88 keys, which sounds like a lot to learn. It is not. It is one small pattern, repeated all the way up.',
      'Look at the black keys. Two together, then three together, then two, then three — over and over, without a break.',
      'Once you can see that, you are never lost. The groups tell you where you are without reading a single label.',
    ],
  },

  findGroupOfTwo: {
    heading: 'Find a group of two',
    body: [
      'Pick any group of two black keys, anywhere on the keyboard, and play both of them — together, or one straight after the other.',
    ],
    prompt: 'Play both keys of any group of two.',
  },

  findGroupOfThree: {
    heading: 'Now a group of three',
    body: [
      'Same idea, one key wider. A group of three always sits between two groups of two, so it is never hard to spot.',
    ],
    prompt: 'Play all three keys of any group of three.',
  },

  meetC: {
    heading: 'This is C',
    body: [
      'Now the black keys can point at something.',
      'C is the white key immediately to the left of every group of two. Find the two black keys, step left onto the white key, and you have found C.',
      'This is how pianists find their place — by pattern and by feel, not by reading the key names.',
    ],
  },

  findThreeCs: {
    heading: 'Find three different Cs',
    body: [
      'There is a C in front of every group of two, so a full piano has eight of them. They are all C.',
      'Your screen only shows part of the keyboard at a time. Use the ‹ and › arrows just above the keys to slide along and find the next one — the left and right arrow keys do the same thing.',
    ],
    prompt: 'Play three different Cs.',
  },

  octaves: {
    heading: 'Same note, higher up',
    body: [
      'Press Listen. You will hear a C, then the next C above it, then both at once.',
      'They sound like the same note — one simply sits higher. That is why they share a name.',
      'The distance between them is called an octave, and it is the reason the whole keyboard is one repeating pattern: after an octave, everything starts again.',
      'To tell them apart, each one gets a number. The C nearest the middle of the piano is C4, called middle C. The next one up is C5.',
    ],
  },

  playAnOctave: {
    heading: 'Play an octave',
    body: [
      'Play a C and the next C above it at the same time.',
      'If you are using a mouse and can only press one key at a time, playing them quickly one after the other counts too.',
    ],
    prompt: 'Play a C and the C above it.',
  },

  chapterComplete: {
    heading: 'That is chapter one',
    body: [
      'You can now find your way around a piano: low to the left, high to the right, black keys in twos and threes, and a C in front of every pair.',
      'Here is middle C written down. Those five lines are called a stave, and learning to read them is what the next chapters are for.',
      'Until then — go and press some keys.',
    ],
  },
};
