import type { ChapterProse } from '../types';

/**
 * Intermediate chapter 1 in English. Assumes the Beginner course: reading a
 * line, playing it in time, and "A Beautiful Day" from its closing hand-off.
 * Method is taught as advice — only the tempo steps are graded.
 */
export const howToPractiseEn: ChapterProse = {
  playingIsNotPractising: {
    heading: 'Playing is not practising',
    body: [
      'Playing a piece through from the top, over and over, feels like practice. Mostly it is repetition: the easy bars get played the most, the hard bars stay hard, and every slip is rehearsed as often as the notes around it.',
      'Practising is different, and this chapter is about how. You will use a real passage — the first four bars of the tune in “A Beautiful Day”, the piece the Beginner course handed you — and learn it the way you would learn anything.',
      'Here it is. Listen once, and follow it on the staff.',
    ],
  },

  startSlow: {
    heading: 'Start slow enough to be right',
    body: [
      'The click is back at 60. That is slow on purpose: slow enough that every note can be the right note, in the right place, every time.',
      'Your hands learn whatever they repeat. Play something fast and wrong ten times and you have practised a mistake ten times. Play it slowly and right, and that is what sticks — speed comes afterwards, on its own terms.',
    ],
  },

  chunkOne: {
    heading: 'One small piece at a time',
    body: [
      'Don’t start with all four bars. Take the first two — E G A G, F E D — and play them until the notes are easy, with no clock at all.',
      'A small chunk is something you can get right several times in a minute. That is how it becomes yours.',
    ],
    prompt: 'Play the first two bars, at your own speed.',
  },

  chunkTwo: {
    heading: 'Then the next piece',
    body: [
      'Now the second chunk: C E A G, F A G. It starts on middle C, below where the first one ended, which is exactly the kind of move worth practising on its own.',
    ],
    prompt: 'Play the second two bars, at your own speed.',
  },

  joinTheChunks: {
    heading: 'Practise the join',
    body: [
      'Two chunks that each work can still fall apart where they meet. The trouble is almost always the join — here, from the held D down to C.',
      'So practise across it: the last note of one chunk and the first few of the next, a few times, before you play the whole passage. Then put all four bars together.',
    ],
  },

  atSixty: {
    heading: 'The whole passage at 60',
    body: [
      'All four bars in time with the click at 60. Come in on any bar line.',
      'If a note slips, don’t push on: start again, slowly. A clean run at 60 is worth more than a messy one at any speed.',
    ],
    prompt: 'Play the passage in time at 60.',
  },

  turnItUp: {
    heading: 'Speed up in small steps',
    body: [
      'Only once it is clean, raise the tempo — and by a little, not a lot. The click is now at 80: the same notes, a third faster.',
      'If 80 falls apart, go back to 60 or try 70. The tempo you can play cleanly today is your starting point, not a failure.',
      'Listen to the passage at the new speed first.',
    ],
  },

  atEighty: {
    heading: 'The passage at 80',
    body: [
      'Same four bars, now with the click at 80. Let the beat carry you; don’t rush the half notes.',
    ],
    prompt: 'Play the passage in time at 80.',
  },

  atHundred: {
    heading: 'The passage at 100',
    body: [
      'And at 100 — a touch faster than the piece’s own 92, so the real thing will feel comfortable.',
      'You have now played the same passage at three tempos. That is the whole method: slow and right, then a little faster, then a little faster again.',
    ],
    prompt: 'Play the passage in time at 100.',
  },

  handsSeparate: {
    heading: 'One hand at a time',
    body: [
      'In a piece for two hands, learn each hand on its own before putting them together. Each hand has its own problems, and solving two sets at once is much harder than solving each in turn.',
      'Play has this built in. Its Training modes can wait for just your right hand or just your left while it plays the other one for you — practice with a patient accompanist.',
    ],
  },

  yourTools: {
    heading: 'Four tools, already in the app',
    body: [
      'The speed menu on Play slows a piece down without changing its pitch. Learn a passage at 60% of its speed, then 80%, the same way you just stepped up the click.',
      'The A–B loop plays one passage round and round — only the hard bars, as many times as you need, without the easy ones in between.',
      'The metronome keeps you honest about the beat. And the record button lets you hear what you actually played: you notice things listening back that you cannot notice while your hands are busy.',
    ],
  },

  comeBackTomorrow: {
    heading: 'A little, often',
    body: [
      'Fifteen minutes on each of four days beats an hour on one. Much of what you practise settles in overnight, and coming back to it the next day is what makes it last.',
      'When you come back, start at the last tempo you played cleanly, not where you wish you were — then step it up again.',
    ],
  },

  chapterComplete: {
    heading: 'That is chapter one',
    body: [
      'Slow and right first; in small pieces; hands apart; faster in small steps; a little every day. None of it is a trick — it is simply how anything difficult gets learned.',
      'The button below opens “A Beautiful Day” on Play set up exactly as this chapter practised: right hand in Training, slowed to 60%, looping these four bars. Change the speed and the loop as it gets easier.',
      'Next: key signatures, and why some pieces carry sharps or flats at the start of every line.',
    ],
  },
};
