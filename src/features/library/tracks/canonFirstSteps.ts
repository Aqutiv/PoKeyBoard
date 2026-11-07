import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * A new, deliberately short teaching arrangement of Pachelbel's public-domain
 * Canon in D. Entered directly from its ground bass and opening melody; no
 * third-party piano arrangement or MusicXML file is used. The bass introduces
 * four bars, then the right hand walks down the scale taught in Scales Beyond C.
 */
const events: TrackEvent[] = [];
const bass = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D3', 'G2', 'A2'];
for (let repeat = 0; repeat < 2; repeat += 1) {
  bass.forEach((note, index) => events.push([repeat * 16 + index * 2, note, 2, 0.48, 'bass']));
}
['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'].forEach((note, index) =>
  events.push([16 + index * 2, note, 2, 0.68, 'treble']),
);
// A tonic resolution makes this teaching excerpt a complete short performance.
events.push([32, 'D3', 4, 0.48, 'bass'], [32, 'D5', 4, 0.64, 'treble']);

export const CANON_FIRST_STEPS: LibraryTrackDef = {
  trackId: 'canon-in-d-first-steps',
  title: 'Canon in D (first steps)',
  composer: 'Johann Pachelbel',
  folder: 'classics',
  descriptionKey: 'canonFirstSteps',
  bpm: 60,
  timeSignature: { numerator: 4, denominator: 4 },
  keySignature: 2,
  events,
};
