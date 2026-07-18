import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Gymnopédie No. 1" — Erik Satie, 1888. Public domain. The opening period,
 * stated twice, over the famous swaying G/D vamp. Lent et douloureux: 3/4 at
 * 66 bpm, soft throughout, per-bar sustain pedal for the wash. The bass
 * (G2/D2) keeps Satie's wide spacing and dips below the default keyboard
 * view — this one is for listening more than note-chasing.
 */

const events: TrackEvent[] = [];

function n(bar: number, beat: number, note: string | string[], dur: number, vel: number): void {
  events.push([(bar - 1) * 3 + (beat - 1), note, dur, vel]);
}

/** The vamp: odd bars lean on G, even bars on D. */
function vamp(bar: number): void {
  if (bar % 2 === 1) {
    n(bar, 1, 'G2', 2.9, 0.48);
    n(bar, 2, ['B3', 'D4', 'F#4'], 1.9, 0.42);
  } else {
    n(bar, 1, 'D2', 2.9, 0.48);
    n(bar, 2, ['A3', 'D4', 'F#4'], 1.9, 0.42);
  }
}

/** The twelve-bar melodic period beginning at `startBar`. */
function period(startBar: number): void {
  const m = (bar: number, beat: number, note: string, dur: number, vel: number): void =>
    n(startBar + bar, beat, note, dur, vel);
  // First phrase: the long arc down to a held F#4.
  m(0, 1, 'F#5', 0.95, 0.62);
  m(0, 2, 'A5', 0.95, 0.64);
  m(0, 3, 'G5', 0.95, 0.62);
  m(1, 1, 'F#5', 0.95, 0.6);
  m(1, 2, 'C#5', 0.95, 0.58);
  m(1, 3, 'B4', 0.95, 0.56);
  m(2, 1, 'C#5', 0.95, 0.58);
  m(2, 2, 'D5', 0.95, 0.6);
  m(2, 3, 'A4', 0.95, 0.56);
  m(3, 1, 'F#4', 6, 0.56);
  // Second phrase: same opening, then climbing to rest on A4.
  m(5, 1, 'F#5', 0.95, 0.63);
  m(5, 2, 'A5', 0.95, 0.65);
  m(5, 3, 'G5', 0.95, 0.63);
  m(6, 1, 'F#5', 0.95, 0.6);
  m(6, 2, 'C#5', 0.95, 0.58);
  m(6, 3, 'B4', 0.95, 0.56);
  m(7, 1, 'C#5', 0.95, 0.58);
  m(7, 2, 'D5', 0.95, 0.6);
  m(7, 3, 'E5', 0.95, 0.63);
  m(8, 1, 'F#5', 1.95, 0.65);
  m(8, 3, 'E5', 0.95, 0.61);
  m(9, 1, 'D5', 0.95, 0.59);
  m(9, 2, 'C#5', 0.95, 0.57);
  m(9, 3, 'B4', 0.95, 0.55);
  m(10, 1, 'A4', 6, 0.56);
}

// Four vamp bars set the sway, then the period twice, then a quiet close.
for (let bar = 1; bar <= 29; bar += 1) vamp(bar);
period(5);
period(17);
n(30, 1, 'D2', 5, 0.46);
n(30, 2, ['A3', 'D4', 'F#4'], 4, 0.4);
n(30, 1, 'D5', 5, 0.54);

export const GYMNOPEDIE_1: LibraryTrackDef = {
  trackId: 'gymnopedie-1',
  title: 'Gymnopédie No. 1',
  composer: 'Erik Satie',
  descriptionKey: 'gymnopedie1',
  bpm: 66,
  timeSignature: { numerator: 3, denominator: 4 },
  quantization: '1/8',
  pedal: 'bar',
  events,
};
