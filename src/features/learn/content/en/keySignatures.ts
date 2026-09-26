import type { ChapterProse } from '../types';

/**
 * Intermediate chapter 2 in English. Assumes the Beginner course: sharps,
 * flats and enharmonics (chapter 3), reading the treble staff (chapter 4),
 * and the major scale's pattern with its detour to D (chapter 8).
 */
export const keySignaturesEn: ChapterProse = {
  sharpsEverywhere: {
    heading: 'Sharps everywhere',
    body: [
      'In chapter eight you started the major scale’s pattern on D, and it needed two black keys: F sharp and C sharp. Written out note by note, each of them carries its own sharp sign.',
      'That is fine for one scale. A whole piece in D would need a sharp in front of nearly every F and every C, bar after bar — a lot of ink to keep saying the same thing.',
      'Listen to the scale once more.',
    ],
  },

  theSignature: {
    heading: 'Say it once: the key signature',
    body: [
      'So music says it once. The sharps are written at the start of every line, just after the clef, and they hold for the whole piece. That little group is the key signature.',
      'These two, on the F line and the C space, make every F an F sharp and every C a C sharp — in every octave, not just the one they sit on. The signature’s F sharp is on the top line; the scale’s F is down in the bottom space, and it is sharp too.',
      'Same notes, same sound. Listen: only the writing has changed.',
    ],
  },

  readInD: {
    heading: 'Read it with the signature',
    body: [
      'Play the D major scale from the page. Nothing beside the notes says sharp any more — the signature does, so the F and the C are the black keys.',
      'A white F or C here is a wrong note, and starts the scale again.',
    ],
    prompt: 'Play the D major scale, reading the key signature.',
  },

  orderOfSharps: {
    heading: 'Sharps come in order',
    body: [
      'Sharps never turn up at random. They always arrive in the same order: F, C, G, D, A, E, B. Here are all seven.',
      'A key with one sharp has F sharp. A key with two has F sharp and C sharp. Three adds G sharp, and so on: each key keeps every sharp of the one before and adds the next.',
      'One way to remember the order: Father Charles Goes Down And Ends Battle.',
    ],
  },

  lastSharp: {
    heading: 'The last sharp points home',
    body: [
      'To name a key from its sharps, find the last sharp in the signature and go up a half step. That note is home — the first note of the key’s scale.',
      'One sharp, F sharp: a half step up is G, so the key is G major. Two, ending on C sharp: D major. Three, ending on G sharp, ringed here with the other two — and a half step up, lit, is A: A major.',
      'No sharps or flats at all is C major.',
    ],
  },

  nameSharpKeys: {
    heading: 'Name the key',
    body: [
      'Each round shows a key signature and nothing else. Name its major key.',
      'Find the last sharp and go up a half step. An empty signature is C.',
    ],
  },

  orderOfFlats: {
    heading: 'Flats come in order too',
    body: [
      'Flat keys work the same way from the other side. Flats arrive in a fixed order too — B, E, A, D, G, C, F — which is the order of sharps read backwards.',
      'So is the sentence: Battle Ends And Down Goes Charles’s Father.',
    ],
  },

  secondToLastFlat: {
    heading: 'The second-to-last flat names the key',
    body: [
      'For a flat key, look at the flat just before the last one: it is the key. B flat and E flat: B flat major. B flat, E flat and A flat: E flat major — lit here, with the other two ringed.',
      'One flat has no flat before it, so learn that one by heart: one flat, B flat, is F major.',
    ],
  },

  readInF: {
    heading: 'A flat key from the page',
    body: [
      'Now the F major scale under its one flat. The flat sits on the middle line, which is B — so every B is B flat, the black key just below it.',
      'Play it from the page. A white B is a wrong note here.',
    ],
    prompt: 'Play the F major scale, reading the key signature.',
  },

  nameAnyKey: {
    heading: 'Sharps or flats',
    body: [
      'Now any signature up to four sharps or four flats, in no particular order.',
      'Sharps: go up a half step from the last one. Flats: read the second-to-last — and one flat is F.',
    ],
  },

  playTheTonic: {
    heading: 'Find home',
    body: [
      'Each round shows a signature. Work out its key and play its home note — any octave will do.',
      'This is the first thing to do with any new piece: look at the signature, and find home.',
    ],
  },

  theCircle: {
    heading: 'The circle of fifths',
    body: [
      'Put the keys in a ring and they fall into place. C, with no sharps or flats, sits at the top. Go clockwise and each key has one more sharp: G, D, A, E, B. Go the other way and each has one more flat: F, B flat, E flat, A flat, D flat.',
      'The two sides meet at the bottom, where six sharps and six flats turn out to be the same key spelled two ways: F sharp major is G flat major — chapter three’s enharmonics, a whole key at a time.',
    ],
  },

  aFifthApart: {
    heading: 'Why fifths',
    body: [
      'Each step clockwise is a fifth up: count five letters from C and you land on G, five from G and you land on D. It is seven half steps every time.',
      'Neighbours on the circle share six of their seven notes — G major is C major with its F made sharp. That is why a piece that changes key usually moves one step round the circle: only one note has to change.',
      'Listen to the walk from C, each note a fifth above the last, dropped an octave whenever it climbs too high.',
    ],
  },

  walkTheCircle: {
    heading: 'Walk the circle',
    body: [
      'Play the home notes round the circle, clockwise from C: C, G, D, A, E, B. Any octave will do.',
      'Look familiar? It is the order of sharps, starting one letter later. The circle is where that order comes from.',
    ],
    prompt: 'Play C, G, D, A, E and B, in that order.',
  },

  chapterComplete: {
    heading: 'That is chapter two',
    body: [
      'A key signature says once, at the start of every line, which notes are sharp or flat all the way through. Sharps come F C G D A E B, and the last one sits a half step below home; flats come B E A D G C F, and the second-to-last is the key. The circle puts all of it in one picture.',
      'The button below opens the Minuet in G by Christian Petzold — long thought to be Bach’s — on Play, waiting for your right hand. One sharp: G major, so every F is F sharp — watch for them in both octaves. Later on, some Cs carry a sharp of their own; a sign written beside a note holds until the next bar line.',
      'Every signature also belongs to a minor key; that is chapter four. Next: the scales of G, F and D major, and why the fingering shifts to fit them.',
    ],
  },
};
