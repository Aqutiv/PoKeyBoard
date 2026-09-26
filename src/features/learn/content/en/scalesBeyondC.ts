import type { ChapterProse } from '../types';

/**
 * Intermediate chapter 3 in English. Assumes chapter 8's major-scale pattern
 * and thumb tuck, and chapter 2 of this level: key signatures, the circle,
 * and D and F major read from the page. Fingering is taught as advice, never
 * checked — the app cannot see a hand.
 */
export const scalesBeyondCEn: ChapterProse = {
  oneStaircase: {
    heading: 'One staircase, three new homes',
    body: [
      'Chapter eight’s C major scale was a pattern, not a row of white keys: whole, whole, half, whole, whole, whole, half. Start it on any key and you get that key’s major scale.',
      'This chapter takes the three keys closest to C on the circle of fifths: G and D on the sharp side, F on the flat side. You read two of them from the page in chapter two. Now you will learn all three the way pianists know them — by heart, with the right fingers.',
    ],
  },

  gMajor: {
    heading: 'G major: one black key',
    body: [
      'Climb the pattern from G: G, A, B, C, D, E — and a whole step up from E is not F but F sharp. Then a half step to G, home.',
      'So G major lands on one black key, F sharp, ringed here: the seventh step, a half step under home. It is G major’s one sharp from chapter two — a key signature is simply the list of black keys its scale lands on.',
      'Listen to it climb.',
    ],
  },

  gFingering: {
    heading: 'The same fingers as C',
    body: [
      'G major takes exactly the fingering of C major: 1, 2, 3 on G, A and B, then tuck your thumb under to C — ringed here — and carry on 1, 2, 3, 4, 5 up to G.',
      'F sharp falls under finger 4. The long middle fingers reach in to the black keys easily; the thumb, short and low, is kept for the white ones.',
    ],
  },

  playG: {
    heading: 'G major by heart',
    body: [
      'Play G major up one octave, from G to G, with no page to read it from. The one black key is yours to remember.',
      'Every note has to climb: a note back down, or a white F where F sharp belongs, starts the scale again.',
      'On a computer keyboard the top two notes are past the end of the rows, so press X after the E to move them up an octave. If you start over after that, press Z first — or click those two notes on screen instead.',
    ],
    prompt:
      'Play G major up, from G to G. On a computer keyboard, press X after the E: F♯ and G are then T and G.',
  },

  dMajor: {
    heading: 'D major: two black keys',
    body: [
      'From D the pattern lands on two black keys, ringed here: F sharp, the third step, and C sharp, the seventh. They are D major’s two sharps.',
      'The fingering is C’s again: 1, 2, 3 on D, E and F sharp, thumb under to G, then 1, 2, 3, 4, 5. Both black keys fall under long fingers, 3 and 4.',
      'Listen, then play it.',
    ],
  },

  playD: {
    heading: 'D major by heart',
    body: ['D major up one octave, from D to D, from memory — both black keys included.'],
    prompt: 'Play D major up, from D to D.',
  },

  fMajor: {
    heading: 'F major: one flat',
    body: [
      'From F the pattern goes F, G, A — and a half step up from A is not B but B flat. Then whole steps to C, D and E, and a half step home to F.',
      'So F major lands on one black key, B flat, ringed here: the fourth step. It is F major’s one flat.',
      'Listen to it.',
    ],
  },

  fFingering: {
    heading: 'Why the fingering shifts',
    body: [
      'Try C’s fingering from F and the thumb tucks under onto B flat — a black key, which the short thumb cannot play cleanly in the middle of a run.',
      'So in F major the crossing comes one note later: 1, 2, 3, 4 on F, G, A and B flat, then the thumb tucks under onto C, ringed here, and 1, 2, 3, 4 carry you up to F.',
      'That is the rule behind every scale fingering: keep the thumb off the black keys, and cross where it lands on a white one.',
    ],
  },

  playF: {
    heading: 'F major by heart',
    body: ['F major up one octave, from F to F, from memory — with the new fingering.'],
    prompt: 'Play F major up, from F to F.',
  },

  blackKeys: {
    heading: 'Where the black keys land',
    body: [
      'Each round names one of the three keys and a step of its scale. Play that note — any octave will do.',
      'Some answers are black keys and some are white. Picture the scale and go straight to the step, without climbing up from home to count.',
    ],
  },

  dInTime: {
    heading: 'D major, up and down in time',
    body: [
      'Now D major from the page against the click: up to the top D and straight back down, holding the last D for two beats.',
      'The signature carries the two sharps. Your fingers already know where they are.',
    ],
    prompt: 'Play D major up and back down in time with the click.',
  },

  chapterComplete: {
    heading: 'That is chapter three',
    body: [
      'Every major scale is the same staircase. G major lands on one black key, F sharp; D major on two, F sharp and C sharp; F major on one, B flat. And the fingers follow one rule — the thumb stays off the black keys — which is why F major crosses a note later than the others.',
      'The button below opens Pachelbel’s Canon in D on Play, waiting for your right hand. Its tune comes in at bar five with the D major scale walking down in long, slow notes. On a computer keyboard, X and Z move the rows up and down an octave there too.',
      'Next: minor keys — the same signatures, with a different home.',
    ],
  },
};
