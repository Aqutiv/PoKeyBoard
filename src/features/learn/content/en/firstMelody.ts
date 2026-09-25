import type { ChapterProse } from '../types';

/**
 * Chapter 7 in English. Assumes chapters 4 and 6: the right hand's five-finger
 * position and its notes on the treble staff, then quarters, halves and the
 * click. Nothing new is taught about either — only how to do both at once.
 */
export const firstMelodyEn: ChapterProse = {
  pitchAndRhythm: {
    heading: 'Which note, and when',
    body: [
      'Chapters four and five taught you to read which note to play. Chapter six taught you when. A melody asks for both at once — and you already know everything this one needs.',
      'Here are its first two bars. Every note is one of the five your right hand learned in chapter four, and every one is a quarter or a half note from chapter six.',
      'The click is back, keeping the beat the tune is measured against. Press Listen and follow the notes with your eyes as they sound.',
    ],
  },

  oneHandPosition: {
    heading: 'One hand, five notes',
    body: [
      'Put your right thumb on middle C and rest a finger on each white key above it: C, D, E, F, G. That is chapter four’s five-finger position, and the whole tune lives under it.',
      'Your hand never has to move. That leaves your eyes free for the page — which is where they belong, rather than on your fingers.',
    ],
  },

  phraseOne: {
    heading: 'A phrase is a musical sentence',
    body: [
      'Music is not one long string of notes. It breathes in phrases, the way speech comes in sentences, and this tune’s first phrase is four bars long.',
      'Listen to where it stops: on D, one step short of home. It sounds like a question, as if it is waiting for an answer.',
      'Read it left to right, a bar at a time, just as you read a line of words.',
    ],
  },

  findPhraseOne: {
    heading: 'Find the notes first',
    body: [
      'No clock this time. Play the first phrase note by note, as slowly as you like. Each note lights up on the staff as you play it.',
      'A wrong note takes you back to the start of the phrase, so the lit notes always show how far a clean run has got.',
    ],
    prompt: 'Play the first phrase in order, at your own speed.',
  },

  playPhraseOne: {
    heading: 'Now in time',
    body: [
      'The same phrase with the click: a quarter note on every beat, then the last two notes held for two beats each.',
      'Press Listen to hear it against the click. Then come in on any bar line — the count of “one” — and keep going to the end of the phrase.',
    ],
    prompt: 'Play the first phrase in time with the click.',
  },

  phraseTwo: {
    heading: 'The answer',
    body: [
      'The second phrase starts exactly like the first. Only its last bar changes: instead of stopping on D, it steps down to C and comes home.',
      'That is the answer to the first phrase’s question, and it is why the tune sounds finished when it ends.',
      'Listen for the difference in the last bar.',
    ],
  },

  playPhraseTwo: {
    heading: 'Play the answer',
    body: [
      'The second phrase, in time. Watch the last bar: D for two beats, then C for two.',
      'Come in on a bar line whenever you are ready.',
    ],
    prompt: 'Play the second phrase in time with the click.',
  },

  wholeMelody: {
    heading: 'Both phrases together',
    body: [
      'Here is the whole melody: eight bars, question then answer. Where it runs onto a second line, read it the way you read any page — to the end of the line, then on from the start of the next.',
      'The hard part is the join. The first phrase ends on a half note, and the beat will not wait: the second phrase starts right on the next bar line.',
    ],
  },

  playTheMelody: {
    heading: 'Play the whole melody',
    body: [
      'All eight bars in time, without stopping. Come in on a bar line and keep counting through the join.',
      'A slip starts the attempt again from the top, so if one phrase keeps tripping you, go back and play that step a few more times. There is no hurry.',
    ],
    prompt: 'Play all eight bars in time with the click.',
  },

  chapterComplete: {
    heading: 'That is chapter seven',
    body: [
      'You just played Ode to Joy — the tune Beethoven set to Schiller’s poem in his Ninth Symphony in 1824, and one of the best-known melodies ever written — read from the page and played in time.',
      'Nothing you used was new: five notes, two note lengths and one steady beat. Putting them together is the whole trick, and it is the same trick in every piece from here on.',
      'Next: the C major scale, the pattern every major key is built from.',
    ],
  },
};
