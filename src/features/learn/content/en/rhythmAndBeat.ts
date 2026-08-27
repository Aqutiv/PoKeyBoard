import type { ChapterProse } from '../types';

/**
 * Chapter 6 in English. Assumes chapters 4 and 5: both staves, and reading a
 * note off them. Nothing here asks for a pitch other than middle C — this
 * chapter is about when, and only when.
 */
export const rhythmAndBeatEn: ChapterProse = {
  thePulse: {
    heading: 'Listen for the pulse',
    body: [
      'That steady tick is a metronome, and it is counting the beat — the pulse you tap your foot to without being told.',
      'Everything in music is measured against it. A note is not "long" or "short" on its own; it is long or short compared to the beat.',
      'Just listen for a moment. It will keep going while you read.',
    ],
  },

  tapThePulse: {
    heading: 'Play along with it',
    body: [
      'Any key at all — the note does not matter here, only the moment. Play one on each tick, four in a row.',
      'You do not have to start straight away. Let a few beats go by, find the pulse, then come in. That is what musicians are doing when they count themselves in.',
    ],
    prompt: 'Play any key on each beat, four times.',
  },

  theBar: {
    heading: 'Beats come in bars',
    body: [
      'Beats are not just a stream — they group. Listen and you will hear one tick land heavier than the others: that is beat one, and the group it starts is a bar.',
      'On the page, bars are separated by a vertical bar line. Here are two bars of four beats, one note on each.',
      'Count along: one, two, three, four, one, two, three, four.',
    ],
  },

  theTimeSignature: {
    heading: 'The time signature',
    body: [
      'The two stacked numbers at the front tell you how the bars are built. This is four four, and it is by far the most common.',
      'The top number is how many beats are in a bar — four. The bottom number says which kind of note gets one beat, and 4 there means a quarter note.',
      'It is written once, at the start, and holds until something says otherwise.',
    ],
  },

  wholeAndHalf: {
    heading: 'Whole notes and half notes',
    body: [
      'A note’s shape tells you how long to hold it. The hollow head with no stem is a whole note: four beats, a whole bar of four four.',
      'Add a stem and it becomes a half note — two beats. Two of them fill the same bar.',
      'That is the pattern the rest of them follow: each value is worth half the one before.',
    ],
  },

  quarterAndEighth: {
    heading: 'Quarter notes and eighth notes',
    body: [
      'Fill the head in and you have a quarter note: one beat. Four to a bar, and the note the bottom of the time signature is talking about.',
      'Half a beat each are eighth notes. On their own they carry a little flag, but when they sit together they join up with a beam instead — and they beam per beat, so eight of them read as four clean pairs rather than one long smear.',
      'Two eighths take exactly as long as one quarter. Listen: the second bar is twice as busy, and both bars last the same.',
    ],
  },

  playQuarters: {
    heading: 'Play four quarter notes',
    body: [
      'Four quarter notes, one on each beat, on middle C. This is what you just tapped, now with a note to play it on.',
      'Press Listen first if you want to hear it against the click. Then come in whenever you are ready — any bar will do.',
    ],
    prompt: 'Play middle C on each beat, four times.',
  },

  theRest: {
    heading: 'Silence is written too',
    body: [
      'Music needs silence as much as sound, so silence gets its own symbols. A rest is a written instruction to play nothing, and it lasts exactly as long as the note of the same name.',
      'The bar above has a note on beat one, then a quarter rest on beat two, then notes on three and four. The rest is not a gap in the writing — it is a beat you count through in silence.',
      'Listen for the hole.',
    ],
  },

  playWithARest: {
    heading: 'Play it, rest and all',
    body: [
      'Same bar: play on one, nothing on two, then three and four.',
      'The hard part is that the beat does not stop for you. Keep counting through the rest — the click will still be there when you come back in.',
    ],
    prompt: 'Play middle C on beats one, three and four.',
  },

  mixedRhythm: {
    heading: 'Putting the values together',
    body: [
      'Now all of it in one bar: a half note holding through beats one and two, a quarter on three, and two eighths sharing beat four.',
      'Count it as "one — two, three, four-and". The half note is not two notes; it is one note you keep holding while the count moves on underneath it.',
    ],
  },

  playTheRhythm: {
    heading: 'Play the rhythm',
    body: [
      'The whole figure, on middle C, in time with the click. Four notes: beat one, beat three, beat four, and the "and" halfway between four and the next bar.',
      'Listen to it once or twice first. Then wait for a bar line and go.',
    ],
    prompt: 'Play the written rhythm on middle C.',
  },

  chapterComplete: {
    heading: 'That is chapter six',
    body: [
      'You can read rhythm now, which means you can read everything on the page: which note, from chapters four and five, and how long, from this one.',
      'Whole, half, quarter, eighth — and rests for each — grouped into bars by a time signature, counted against a pulse that does not wait for anybody.',
      'Next: both halves at once. A real melody, pitch and rhythm together, played from the page.',
    ],
  },
};
