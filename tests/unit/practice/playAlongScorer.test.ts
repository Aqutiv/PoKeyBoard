import { describe, expect, it } from 'vitest';
import { scorePlayAlong, type Press, type TimedNote } from '@/features/practice/playAlongScorer';

const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const B4 = 71;
const C5 = 72;
const D5 = 74;

/**
 * Notes a run asks for, as [midi, take ms], falling due from an anchor at 10 s
 * on the audio clock at `speed`.
 */
function timed(notes: readonly (readonly [number, number])[], speed = 1): TimedNote[] {
  return notes.map(([midi, atMs], index) => ({
    id: `n${index}`,
    midi,
    atMs,
    runMs: atMs,
    pass: 0,
    dueAudioTime: 10 + atMs / 1000 / speed,
  }));
}

const press = (midi: number, audioTime: number): Press => ({ midi, audioTime });

/** A scale up from C4, a note every half second: due at 10, 10.5, 11, 11.5 and 12. */
const SCALE = timed([
  [C4, 0],
  [D4, 500],
  [E4, 1000],
  [F4, 1500],
  [G4, 2000],
]);

/** `count` notes on one key a second apart, each pressed `offsetsMs[i]` from its moment. */
function playedOff(offsetsMs: readonly number[]) {
  const notes = timed(offsetsMs.map((_, index) => [C4, index * 1000] as const));
  const presses = offsetsMs.map((offset, index) => press(C4, 10 + index + offset / 1000));
  return scorePlayAlong(notes, presses);
}

describe('scoring a run kept in time', () => {
  it('judges each note on time, early, late or missed', () => {
    const score = scorePlayAlong(SCALE, [
      press(C4, 10.02),
      press(D4, 10.41),
      press(E4, 11.15),
      // F4 never played.
      press(G4, 12.06),
    ]);
    expect(score.outcomes.map((note) => [note.verdict, note.offsetMs])).toEqual([
      ['onTime', 20],
      ['early', -90],
      ['late', 150],
      ['missed', null],
      // Sixty milliseconds out is still on time.
      ['onTime', 60],
    ]);
    expect(score).toMatchObject({
      notes: 5,
      hits: 4,
      onTime: 2,
      early: 1,
      late: 1,
      missed: 1,
      wrong: 0,
      accuracy: 4 / 5,
      onTimeShare: 2 / 5,
    });
    // What the cells are drawn from: where each note is, and whether it was on time.
    expect(score.outcomes.map(({ atMs, pass, good }) => [atMs, pass, good])).toEqual([
      [0, 0, true],
      [500, 0, false],
      [1000, 0, false],
      [1500, 0, false],
      [2000, 0, true],
    ]);
  });

  it('gives each note 200 ms either side in real time, at half speed as at full', () => {
    // At half speed the notes fall due a second apart: 10, 11 and 12.
    const notes = timed(
      [
        [C4, 0],
        [D4, 500],
        [E4, 1000],
      ],
      0.5,
    );
    const score = scorePlayAlong(notes, [
      press(C4, 10.19),
      // 210 ms late and 250 ms early: outside, so neither plays its note.
      press(D4, 11.21),
      press(E4, 11.75),
    ]);
    expect(score.outcomes.map((note) => note.verdict)).toEqual(['late', 'missed', 'missed']);
    expect(score).toMatchObject({ hits: 1, missed: 2, wrong: 2, accuracy: 1 / 5 });
  });

  it('plays each key of a chord on its own', () => {
    const chord = timed([
      [C4, 0],
      [E4, 0],
      [G4, 0],
    ]);
    const score = scorePlayAlong(chord, [press(E4, 9.97), press(F4, 10), press(C4, 10.1)]);
    expect(score.outcomes.map((note) => [note.midi, note.verdict])).toEqual([
      [C4, 'late'],
      [E4, 'onTime'],
      [G4, 'missed'],
    ]);
    expect(score.wrong).toBe(1);
  });

  it('cuts a repeated key’s window halfway to the next strike of it', () => {
    // C4 twice, 200 ms apart: each note has 100 ms either side.
    const repeated = timed([
      [C4, 0],
      [C4, 200],
    ]);
    // 120 ms after the first is nearer the second: early for it.
    expect(
      scorePlayAlong(repeated, [press(C4, 10.12)]).outcomes.map((note) => [
        note.verdict,
        note.offsetMs,
      ]),
    ).toEqual([
      ['missed', null],
      ['early', -80],
    ]);
    expect(
      scorePlayAlong(repeated, [press(C4, 9.95), press(C4, 10.12)]).outcomes.map(
        (note) => note.verdict,
      ),
    ).toEqual(['onTime', 'early']);
  });

  it('keeps a trill’s strikes apart, each to its own note', () => {
    // C5 and D5 a tenth of a second apart: each key every 200 ms.
    const trill = timed([
      [C5, 0],
      [D5, 100],
      [C5, 200],
      [D5, 300],
      [C5, 400],
    ]);
    const score = scorePlayAlong(trill, [
      press(C5, 10.03),
      press(D5, 10.13),
      press(C5, 10.17),
      press(D5, 10.33),
      press(C5, 10.43),
    ]);
    expect(score.outcomes.map((note) => note.offsetMs)).toEqual([30, 30, -30, 30, 30]);
    expect(score).toMatchObject({ onTime: 5, wrong: 0 });
  });

  it('takes the nearer of two presses in a window, and counts the other neither way', () => {
    const one = timed([[C4, 0]]);
    const score = scorePlayAlong(one, [press(C4, 10.09), press(C4, 10.01)]);
    expect(score.outcomes.map((note) => [note.verdict, note.offsetMs])).toEqual([['onTime', 10]]);
    expect(score).toMatchObject({ notes: 1, hits: 1, wrong: 0, accuracy: 1 });
  });

  it('counts a press in no note’s window as a wrong note', () => {
    const score = scorePlayAlong(SCALE, [
      // A key the run never asks for.
      press(B4, 10.5),
      // One it asks for, but nowhere near now.
      press(C4, 11),
      press(D4, 10.5),
    ]);
    expect(score).toMatchObject({ hits: 1, missed: 4, wrong: 2 });
  });

  it('weighs wrong notes against the notes played, so mashing does not pay', () => {
    // Every key of a C chord at each note of the scale: C, E and G each play
    // their own note once, and every other press of them is a wrong note.
    const presses = SCALE.flatMap((note) =>
      [C4, E4, G4].map((midi) => press(midi, note.dueAudioTime)),
    );
    const score = scorePlayAlong(SCALE, presses);
    expect(score.hits).toBe(3);
    expect(score.wrong).toBe(12);
    expect(score.accuracy).toBeCloseTo(3 / (5 + 12), 9);
    // On time is the share of the notes alone.
    expect(score.onTimeShare).toBeCloseTo(3 / 5, 9);
  });

  it('has nothing to say of a run that asked for nothing', () => {
    expect(scorePlayAlong([], [])).toMatchObject({
      notes: 0,
      hits: 0,
      accuracy: 0,
      onTimeShare: 0,
      meanOffsetMs: null,
      tendency: null,
      consistentlyLate: false,
      outcomes: [],
    });
  });
});

describe('the player’s timing', () => {
  it('rushes, or drags, by more than 30 ms on average over six notes or more', () => {
    expect(playedOff([-31, -31, -31, -31, -31, -31])).toMatchObject({
      meanOffsetMs: -31,
      tendency: 'rushing',
    });
    expect(playedOff([20, 40, 30, 50, 10, 40])).toMatchObject({
      meanOffsetMs: 31.666666666666668,
      tendency: 'dragging',
    });
    expect(playedOff([-30, -30, -30, -30, -30, -30]).tendency).toBe('steady');
    expect(playedOff([30, 30, 30, 30, 30, 30]).tendency).toBe('steady');
  });

  it('says nothing of a tendency from fewer than six notes played', () => {
    expect(playedOff([-100, -100, -100, -100, -100])).toMatchObject({
      meanOffsetMs: -100,
      tendency: null,
    });
  });

  it('reads the notes played only, not those missed', () => {
    // Six played 40 ms early; the two missed have no offset to pull it either way.
    const notes = timed([0, 1, 2, 3, 4, 5, 6, 7].map((index) => [C4, index * 1000] as const));
    const presses = [0, 1, 2, 3, 4, 5].map((index) => press(C4, 10 + index - 0.04));
    expect(scorePlayAlong(notes, presses)).toMatchObject({
      missed: 2,
      meanOffsetMs: -40,
      tendency: 'rushing',
    });
  });

  it('is late by the same amount every note: perhaps the sound reaching the player late', () => {
    const steadyLate = [95, 100, 92, 98, 96, 94, 99, 97];
    expect(playedOff(steadyLate)).toMatchObject({ tendency: 'dragging', consistentlyLate: true });
    // Fewer than eight notes cannot tell.
    expect(playedOff(steadyLate.slice(0, 7)).consistentlyLate).toBe(false);
    // Late by no more than 90 ms in the middle.
    expect(playedOff([90, 90, 90, 90, 90, 90, 90, 90]).consistentlyLate).toBe(false);
    // Late, but all over the place: the player, more likely than the sound.
    expect(playedOff([60, 70, 80, 95, 100, 120, 140, 150]).consistentlyLate).toBe(false);
  });
});

describe('the end of a run kept in time', () => {
  it('counts a press after the music stopped only where it plays a note', () => {
    // The music stopped at 12.05, just after the last note was due.
    const score = scorePlayAlong(
      SCALE,
      [
        press(C4, 10),
        press(D4, 10.5),
        press(E4, 11),
        press(F4, 11.5),
        // Late for the last note…
        press(G4, 12.15),
        // …and a key played once it was all over.
        press(B4, 12.3),
      ],
      { endAudioTime: 12.05 },
    );
    expect(score.outcomes.at(-1)).toMatchObject({ verdict: 'late', offsetMs: 150 });
    expect(score).toMatchObject({ notes: 5, hits: 5, wrong: 0 });
  });

  it('leaves out a note whose window was still open when a run stopped short, unless played', () => {
    // Paused at 10.6: the presses heard reach no further.
    const cut = { endAudioTime: 10.6, heardUntil: 10.6 };
    // D4's window runs to 10.7 and E4's opens at 10.8: neither was through.
    const unplayed = scorePlayAlong(SCALE, [press(C4, 10)], cut);
    expect(unplayed.outcomes.map((note) => note.atMs)).toEqual([0]);
    expect(unplayed).toMatchObject({ notes: 1, missed: 0 });

    // Played before the pause, D4 counts, however much longer its window had.
    const played = scorePlayAlong(SCALE, [press(C4, 10), press(D4, 10.45)], cut);
    expect(played.outcomes.map((note) => [note.atMs, note.verdict])).toEqual([
      [0, 'onTime'],
      [500, 'onTime'],
    ]);
    expect(played.notes).toBe(2);
  });

  it('ignores a press past what was heard', () => {
    const score = scorePlayAlong(SCALE, [press(C4, 10), press(B4, 10.3), press(D4, 10.5)], {
      endAudioTime: 10.25,
      heardUntil: 10.25,
    });
    expect(score).toMatchObject({ notes: 1, hits: 1, wrong: 0 });
  });
});

describe('the start of a run kept in time', () => {
  it('counts a press before the music set off only where it plays a note', () => {
    // Counted in until 10, when C4 falls due.
    const score = scorePlayAlong(
      SCALE,
      [
        // In the count-in, with nothing of its key near…
        press(B4, 9.85),
        // …and C4 early, in its window.
        press(C4, 9.9),
        // Once the music is going, a key asked for nowhere near is wrong.
        press(B4, 10.05),
      ],
      { startAudioTime: 10 },
    );
    expect(score.outcomes[0]).toMatchObject({ verdict: 'early', offsetMs: -100 });
    expect(score.wrong).toBe(1);
  });
});
