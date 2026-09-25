import type { ChapterProse } from '../types';

/**
 * Chapter 9 in English. Assumes chapter 3's half steps, chapter 8's scale and
 * its degree numbers, and chapter 4's treble staff. The quiz is the only step
 * in the course that asks something of the ear alone.
 */
export const triadsEn: ChapterProse = {
  stackingThirds: {
    heading: 'Every other note',
    body: [
      'Take the C major scale from chapter eight and play only every other note of it, starting from the bottom: C, skip D, E, skip F, G. Play those three together and you have a chord.',
      'In scale numbers that is 1, 3 and 5. A chord of three notes stacked like this is called a triad, and nearly every song you know is built on them.',
      'Listen to all three sound at once.',
    ],
  },

  rootThirdFifth: {
    heading: 'Root, third and fifth',
    body: [
      'Each note of a triad has a name. The bottom one, which the chord is named after, is the root. The middle one is the third, because it is a third up from the root. The top one is the fifth.',
      'On the staff a triad in this shape looks like a little snowman: three notes stacked line, line, line — or space, space, space. Whenever you see that, you are looking at a root-position triad.',
    ],
  },

  playCMajor: {
    heading: 'Play C major',
    body: [
      'Middle C, E and G, all at once — thumb, middle finger and little finger of your right hand.',
      'Press them together. With a mouse, click all three quickly one after another and they count as one chord.',
    ],
    prompt: 'Play C, E and G together.',
  },

  threeMajors: {
    heading: 'Three major chords',
    body: [
      'Build the same shape on F and on G and you have F major (F–A–C) and G major (G–B–D). All three use only white keys.',
      'These are the three most important chords in C major: built on degrees 1, 4 and 5 of the scale. Listen to them go by and come home to C.',
    ],
  },

  majorAndMinorThirds: {
    heading: 'A big third and a small one',
    body: [
      'Count half steps inside C major. From C up to E is four half steps; from E up to G is three. A third of four is called major, a third of three is called minor.',
      'Now D minor, lit in the second colour: D up to F is three half steps, and F up to A is four. Same shape on the keyboard, the two thirds the other way round.',
      'That swap is the whole difference. Major is big then small; minor is small then big. Listen to C major, then D minor.',
    ],
  },

  hearTheMood: {
    heading: 'Happy or sad?',
    body: [
      'Major chords tend to sound bright and settled; minor chords sound darker, more wistful. It is a rough description, but your ear already knows the difference even if you have never named it.',
      'Press Hear it, listen, and choose. Play the chord as often as you like before you answer.',
    ],
  },

  threeMinors: {
    heading: 'Three minor chords',
    body: [
      'The white keys hold three minor chords too: A minor (A–C–E), D minor (D–F–A) and E minor (E–G–B). Count them and each is small third first.',
      'Together with C, F and G major, that is six chords, every one of them on white keys — which is why this chapter uses these six and not others.',
    ],
  },

  playNamedTriads: {
    heading: 'Play the chord named',
    body: [
      'Each round names one of the six chords. Find its root, stack the third and the fifth above it, and play all three together — in any octave you like.',
      'Keep the root at the bottom. The same three notes in another order are the same chord turned over, which is a later chapter’s subject.',
    ],
  },

  majorToMinor: {
    heading: 'One note changes the mood',
    body: [
      'Here is C major, then C minor. Only the middle note moves: E comes down a half step to E flat. The root and the fifth stay exactly where they were.',
      'It is written E flat rather than D sharp because a triad stacks its letters — C, E, G — and moving the third keeps it an E of some kind.',
      'Listen to how much that one half step changes.',
    ],
  },

  makeItMinor: {
    heading: 'Make it minor',
    body: [
      'Play C major, then turn it into C minor by moving just the third down to E flat — the black key just below E.',
      'Keep C and G down if you can, and let the E go as the E flat comes in. The chord only counts once the old third is up.',
    ],
    prompt: 'Play C major, then move one note to make C minor.',
  },

  makeItMajor: {
    heading: 'And the other way',
    body: [
      'Now D minor, D–F–A, and make it major by moving the third up a half step, from F to F sharp.',
      'Same rule, opposite direction: raise the third and a minor chord turns major.',
    ],
    prompt: 'Play D minor, then move one note to make D major.',
  },

  chapterComplete: {
    heading: 'That is chapter nine',
    body: [
      'You can build a triad on any white key, tell major from minor by ear, and change one into the other by moving a single note.',
      'The four chords above — C, G, A minor and F — are next. Play them in that order and you have the progression behind a startling number of songs.',
      'Next: those four chords with the sustain pedal, and then both hands at once.',
    ],
  },
};
