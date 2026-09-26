import type { ChapterProse } from '../types';

/**
 * Chapter 10 in English — the last Beginner chapter. Assumes chapter 8's
 * degree numbers, chapter 9's triads, and chapter 5's grand staff. The pedal
 * is taught as a change made with the harmony, and graded on its order.
 */
export const chordsPedalAndHandsEn: ChapterProse = {
  fourChords: {
    heading: 'Four chords',
    body: [
      'Build a triad on degrees 1, 5, 6 and 4 of the C major scale and you get C major, G major, A minor and F major. Musicians write that I–V–vi–IV: capital numerals for major chords, small ones for minor.',
      'Played in that order they make one of the most used progressions there is — you will know its sound before you know where from.',
      'Listen to it go round once.',
    ],
  },

  playTheProgression: {
    heading: 'Play the progression',
    body: [
      'The four chords in order, each as a block, all three notes together. Take your time between them — only the order matters here.',
      'Every chord keeps the shape from chapter nine: root, a third up, a fifth up. Only where your hand sits changes.',
    ],
    prompt: 'Play C, G, A minor and F, each as a block.',
  },

  thePedal: {
    heading: 'The sustain pedal',
    body: [
      'A piano’s strings are silenced by felt dampers the moment you let a key go. The sustain pedal — the right-hand pedal on a real piano — lifts every damper at once, so notes keep ringing after your fingers leave them.',
      'Here it is the Sustain button beside the keyboard, the Space bar, or the pedal of a MIDI keyboard. Hold it and play a chord, then let go of the keys: the chord rings on until the pedal comes up.',
    ],
  },

  pressThePedal: {
    heading: 'Catch a chord',
    body: [
      'Play C major, and then — after the chord is down — press the pedal. That order matters, and the next steps are built on it.',
      'On a touch screen or with a mouse, tap Sustain to press it and tap again to lift it.',
    ],
    prompt: 'Play C major, then press the pedal.',
  },

  changeWithTheHarmony: {
    heading: 'Change it with the harmony',
    body: [
      'Hold the pedal down through a change of chord and the old chord keeps ringing under the new one. Listen to the first two bars: C runs straight into G, and the two blur into mud.',
      'The cure is to change the pedal with every new chord, in this order: play the new chord, then lift the pedal, then press it straight back down. The lift clears the old chord away; pressing again after the new one catches it.',
      'The last two bars are changed cleanly. Hear the difference.',
    ],
  },

  pedalTheProgression: {
    heading: 'Pedal the progression',
    body: [
      'The four chords again, now with a pedal change after each: chord, lift, press. Your fingers can let go once the pedal is holding the chord.',
      'Playing the next chord without changing the pedal starts the progression over — that is the blur, and the step will not let it pass.',
    ],
    prompt: 'Play the four chords, changing the pedal after each one.',
  },

  leftHandChords: {
    heading: 'Chords for the left hand',
    body: [
      'The same four chords belong to the left hand when the right hand has a tune to play. Down in the bass staff they sit here: C–E–G, G–B–D, A–C–E and F–A–C, each still root, third and fifth.',
      'Your little finger takes the root, the middle finger the third and the thumb the fifth — the left hand counts from its little finger, as chapter five showed.',
    ],
  },

  leftHandProgression: {
    heading: 'Left hand alone',
    body: [
      'Play the four chords with your left hand. There is no hurry and no need to play the notes at exactly the same instant: find each chord, then move on.',
      'From here the computer keyboard’s octave and a half stops one note short of the C chord’s G, so play these on the keys on screen, on a MIDI keyboard, or with the mouse, one note at a time.',
    ],
    prompt: 'Play the four chords with your left hand, lowest note first if you like.',
  },

  readingBothStaves: {
    heading: 'Reading both staves at once',
    body: [
      'On the grand staff, notes stacked in one column sound together — the left hand’s chord below, the right hand’s note above. Read the page in columns, left to right.',
      'Here are the first two bars of a short piece: each bar starts with a left-hand chord under the tune, and the chord holds while the right hand carries on.',
    ],
  },

  playThePiece: {
    heading: 'Play it, hands together',
    body: [
      'The whole piece: eight bars, left hand under right. It waits for you — each column counts once all its notes are down, in any order — so play it as slowly as you need.',
      'It needs about two octaves of keys. On a phone, turn it sideways; the computer keyboard cannot reach both hands at once, so use the keys on screen, a MIDI keyboard, or the mouse one note at a time. A slip takes you back two bars, not eight.',
    ],
    prompt: 'Play the piece with both hands, one column at a time.',
  },

  chapterComplete: {
    heading: 'That is the Beginner course',
    body: [
      'Ten chapters ago you had never pressed a key. Now you read both staves, keep time with a click, build and change chords, pedal with the harmony, and play with both hands.',
      '“A Beautiful Day” is waiting in the Library, and after its two-bar introduction its tune runs over the very progression you just learned. The button below opens it on Play in Training, so it waits for your hands at every note.',
      'The Intermediate level picks up from here: how to practise, keys beyond C, and real accompaniment.',
    ],
  },
};
