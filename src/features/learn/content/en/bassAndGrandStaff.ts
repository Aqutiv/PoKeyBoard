import type { ChapterProse } from '../types';

/**
 * Chapter 5 in English. Assumes chapter 4: the stave, the treble clef, and
 * middle C on its ledger line below it. Rhythm is still chapter 6, so nothing
 * here counts anything.
 */
export const bassAndGrandStaffEn: ChapterProse = {
  secondStaff: {
    heading: 'There is a second stave',
    body: [
      'Piano music is written on two staves at once, one above the other. Chapter four was the top one; this is the bottom one, and it is the one your left hand usually reads.',
      'It is built exactly the same way — five lines, four spaces — and the same rule still holds: the higher a note sits, the higher it sounds.',
      'These two are both called A, an octave apart. What changed is not the stave. It is the symbol at the front.',
    ],
  },

  bassClef: {
    heading: 'The bass clef',
    body: [
      'This one is a bass clef, and it does the same job the treble clef did: it fixes one note, and every other note follows from there.',
      'Look at its two dots. They sit either side of the fourth line up, and that line is F — the F just below middle C. That is why it is also called the F clef.',
      'One note pinned, and the lines and spaces run up the alphabet from it, exactly as before.',
    ],
  },

  playBassF: {
    heading: 'Play what you see',
    body: [
      'The note above is that F, the one the two dots point at. Find it on the keyboard and play it.',
      'It is below middle C, so it lives in the left half of the piano. The keyboard has moved down to meet you.',
    ],
    prompt: 'Play the note on the stave.',
  },

  middleCAbove: {
    heading: 'Middle C, from the other side',
    body: [
      'Here is the note that ties the two staves together. On the treble stave, middle C hung underneath on a short ledger line. On this stave it sits just above, on a ledger line of its own.',
      'Same key. Same sound. Two ways to write it — and which one a composer picks simply tells you which hand is meant to play it.',
    ],
  },

  leftHandFive: {
    heading: 'C, D, E, F, G — down here',
    body: [
      'The same five letters chapter four read in the right hand, an octave lower. C sits in the second space, D on the middle line, E in the space above it, F on the fourth line — the clef’s line — and G in the top space.',
      'Space, line, space, line, space. Every step up the alphabet is still one step up the stave.',
    ],
  },

  leftHandFingers: {
    heading: 'The left hand counts the other way',
    body: [
      'Fingers are numbered from the thumb in both hands: thumb 1, little finger 5. But the left hand is a mirror of the right, so as you climb the keyboard the numbers come down.',
      'Put your left little finger on this C and let the rest fall on D, E, F and G. Your thumb lands on G. That is the left hand’s five-finger position.',
    ],
  },

  whichBassNote: {
    heading: 'Which note is this?',
    body: [
      'A note will appear on the bass stave. Work out its letter from where it sits — F is the line between the two dots, and the rest follow the alphabet from there.',
      'Five of them. Wrong answers cost nothing but another look.',
    ],
  },

  playWhatYouRead: {
    heading: 'Play the note shown',
    body: [
      'Same five notes, the other way round: read it, then find it. No letter this time.',
      'If you are playing on a computer keyboard, the letter row has moved down with the lesson — the leftmost white key on screen is still the A key.',
    ],
  },

  bassRun: {
    heading: 'Play the whole run',
    body: [
      'All five in order, bottom to top, straight off the stave. In the five-finger position that is little finger to thumb.',
    ],
    prompt: 'Play C, D, E, F, then G.',
  },

  grandStaff: {
    heading: 'The two staves together',
    body: [
      'Put them one above the other, join them with a brace down the left and a bar line through both, and you have the grand stave — the shape almost all piano music is written in.',
      'Treble on top for the right hand, bass underneath for the left, and middle C sitting in the gap between them, reachable from either side.',
      'Two notes here, sounding at once: F below middle C in the left hand, middle C itself in the right.',
    ],
  },

  handsTogether: {
    heading: 'One note in each hand',
    body: [
      'Now play both. Left hand on the F, right hand on middle C, sounding together rather than one after the other.',
      'Press Listen first if you want to hear it. Then find both keys and put them down at the same time — this is the first thing in the course that needs two hands at once, and it only has to happen once.',
    ],
    prompt: 'Play both notes together.',
  },

  chapterComplete: {
    heading: 'That is chapter five',
    body: [
      'You can read both staves now, and you know why there are two: one hand each, with middle C as the bridge between them.',
      'Everything from here is written this way. What is still missing is how long each note lasts — so far every note you have read has simply filled its bar.',
      'Next: rhythm, the beat, and playing in time rather than near it.',
    ],
  },
};
