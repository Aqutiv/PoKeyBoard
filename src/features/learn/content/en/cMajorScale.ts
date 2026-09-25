import type { ChapterProse } from '../types';

/**
 * Chapter 8 in English. Assumes chapter 2's walk from C to C, chapter 3's half
 * and whole steps, and chapter 7's playing from the page. Fingering is taught
 * as advice, never checked — the app cannot see a hand.
 */
export const cMajorScaleEn: ChapterProse = {
  whatIsAScale: {
    heading: 'A scale is a staircase',
    body: [
      'Back in chapter two you walked from one C to the next along the white keys. That walk has a name: it is the C major scale.',
      'A scale is the set of notes a piece of music lives in, laid out in order from its home note up to the next home note. Most of the tunes you know are built from one — Ode to Joy used five steps of this one.',
      'Listen to it climb: eight notes, starting and ending on C.',
    ],
  },

  thePattern: {
    heading: 'Whole, whole, half …',
    body: [
      'Measure each step of the scale the way chapter three taught you. From C to D is a whole step, D to E is a whole step, E to F is a half step. Carry on and the whole thing reads: whole, whole, half, whole, whole, whole, half.',
      'The two half steps are lit in the second colour: E to F and B to C. They are exactly the two places where white keys touch with no black key between them.',
      'That pattern is what a major scale is. The notes are just where it lands.',
    ],
  },

  whyAllWhite: {
    heading: 'Why C major is all white keys',
    body: [
      'Start the same pattern on D instead and see what happens. D to E is a whole step, but a whole step up from E is not F — it is the black key above it, F sharp. The same thing happens near the top, where C sharp takes the place of C.',
      'Starting on C is the one place where the pattern’s half steps fall exactly on the white keys’ touching pairs, so it never needs a black key. That is the only reason C major is where everyone begins.',
      'Listen: the scale from D sounds just as “major” as the one from C. Same pattern, different home.',
    ],
  },

  degrees: {
    heading: 'Numbering the steps',
    body: [
      'Musicians number the notes of a scale, starting from 1 on the home note — its tonic. In C major, C is 1, D is 2, all the way to B, which is 7.',
      'The C at the top is 8, which is really 1 again, an octave higher. Every scale ends where it began.',
      'Numbers let you talk about a scale without naming its key: “play 1, 3 and 5” means the same shape in every major key.',
    ],
  },

  playDegrees: {
    heading: 'Find the degree',
    body: [
      'Each round names a step of the C major scale by its number. Play that note — any octave will do.',
      'Count up from C if you need to. It gets quicker.',
    ],
  },

  thumbTuck: {
    heading: 'The thumb tuck',
    body: [
      'Eight notes and five fingers: the hand has to move somewhere. On the way up, play C, D and E with fingers 1, 2 and 3, then tuck your thumb under your hand to land on F — the key lit in the second colour — and carry on with 2, 3, 4 and 5.',
      'The tuck is the whole technique of a scale. Let the thumb travel under early, while finger 3 is still down, so the line never breaks.',
      'Nothing here checks your fingers — the app cannot see them — so this part is up to you. It is worth doing properly from the start.',
    ],
  },

  scaleUp: {
    heading: 'Play it up',
    body: [
      'The scale up from middle C, one note at a time, at your own speed. Each note lights on the staff as you play it.',
      'Try the thumb tuck on the way. The keyboard shows the whole octave, so nothing needs moving mid-scale.',
    ],
    prompt: 'Play the C major scale up, from middle C to the C above.',
  },

  crossingBack: {
    heading: 'Coming back down',
    body: [
      'Down is the mirror of up. Start on the top C with finger 5 and come down 5, 4, 3, 2, 1 — to F with your thumb — then cross finger 3 over the thumb onto E, lit in the second colour, and finish 2, 1.',
      'Every key keeps the same finger in both directions, so the numbers on the diagram read correctly either way.',
    ],
  },

  scaleDown: {
    heading: 'Play it down',
    body: [
      'The scale from the top C back to middle C. A note played the wrong way — up instead of down — starts the line over, so keep heading for home.',
    ],
    prompt: 'Play the C major scale down, from the top C to middle C.',
  },

  scaleInTime: {
    heading: 'Up and down, in time',
    body: [
      'Now the whole thing against the click: a quarter note on every beat, up to the top C and straight back down, holding the last C for two beats.',
      'The top C is the only note you play once, and the turn is where most people rush. Keep the beat even through it.',
      'Come in on any bar line, as in chapter seven.',
    ],
    prompt: 'Play the scale up and back down in time with the click.',
  },

  chapterComplete: {
    heading: 'That is chapter eight',
    body: [
      'You have played a major scale, up and down and in time, and you know why it sounds the way it does: whole, whole, half, whole, whole, whole, half.',
      'That pattern will follow you everywhere. Every major key is the same staircase built on a different note — and chords, next, are built by taking every other step of it.',
      'Next: triads, and the one note that decides whether a chord sounds happy or sad.',
    ],
  },
};
