import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import {
  COMING_WINDOW_MS,
  comingNotes,
  holdTargetHands,
} from '@/features/keyLights/practiceLights';
import {
  clearPictureMarks,
  clearScreenCues,
  getScreenCues,
  NO_SCREEN_CUES,
  publishPictureMarks,
  publishScreenCues,
  subscribeScreenCues,
} from '@/features/keyboard/screenCues';

function note(midi: number, startMs: number, staff?: 'treble' | 'bass'): NoteEvent {
  return { id: `${midi}@${startMs}`, midi, startMs, durationMs: 400, velocity: 0.7, staff };
}

// Right hand (treble) C5, E5 at 0, 1000; left hand (bass) C3 at 0, 500, 1000.
const NOTES = [
  note(48, 0, 'bass'),
  note(72, 0, 'treble'),
  note(48, 500, 'bass'),
  note(52, 1000, 'bass'),
  note(76, 1000, 'treble'),
  note(79, 1030, 'treble'),
  note(84, 6000, 'treble'),
].sort((a, b) => a.startMs - b.startMs);

describe('holdTargetHands', () => {
  it('gives each key a hold waits for the hand of its note at the hold', () => {
    expect(holdTargetHands(NOTES, new Set([52, 76]), 1000, 'both')).toEqual(
      new Map([
        [52, 'left'],
        [76, 'right'],
      ]),
    );
  });

  it('takes no hand for a key with no note there', () => {
    expect(holdTargetHands(NOTES, new Set([61]), 1000, 'both')).toEqual(new Map([[61, null]]));
    expect(holdTargetHands(NOTES, new Set(), 1000, 'both').size).toBe(0);
  });

  it('reads the hand from the notes the hold asks for, not one the other hand struck just before', () => {
    // A bass C4 at 980, then the treble C4 a right-hand hold at 1000 asks for.
    const both = [note(60, 980, 'bass'), note(60, 1000, 'treble')];
    expect(holdTargetHands(both, new Set([60]), 1000, 'right')).toEqual(new Map([[60, 'right']]));
    // The same key in both hands at the hold itself: the practised hand's.
    const unison = [note(60, 1000, 'bass'), note(60, 1010, 'treble')];
    expect(holdTargetHands(unison, new Set([60]), 1000, 'right')).toEqual(new Map([[60, 'right']]));
    expect(holdTargetHands(unison, new Set([60]), 1000, 'left')).toEqual(new Map([[60, 'left']]));
  });
});

describe('comingNotes', () => {
  it('is the practised hand’s next chord after the one at the playhead', () => {
    expect(comingNotes(NOTES, 0, 'right', 1)).toEqual(
      new Map([
        [76, 'right'],
        [79, 'right'],
      ]),
    );
    expect(comingNotes(NOTES, 0, 'left', 1)).toEqual(new Map([[48, 'left']]));
  });

  it('shows both hands when both are practised, each in its own colour', () => {
    expect(comingNotes(NOTES, 600, 'both', 1)).toEqual(
      new Map([
        [52, 'left'],
        [76, 'right'],
        [79, 'right'],
      ]),
    );
  });

  it('waits until the next chord is within reach, in real time at the practice speed', () => {
    expect(comingNotes(NOTES, 1500, 'right', 1).size).toBe(0);
    expect(comingNotes(NOTES, 6000 - COMING_WINDOW_MS, 'right', 1)).toEqual(
      new Map([[84, 'right']]),
    );
    // At half speed the same two seconds cover half as much music.
    expect(comingNotes(NOTES, 6000 - COMING_WINDOW_MS, 'right', 0.5).size).toBe(0);
  });

  it('keeps a coming chord lit right up to its onset', () => {
    // The chord at 1000 is next however close the playhead comes (to within
    // the millisecond a hold's rounding may leave), and whole: 79 at 1030
    // belongs to it, not a chord of its own.
    for (const playhead of [960, 990, 998]) {
      expect(comingNotes(NOTES, playhead, 'right', 0.25)).toEqual(
        new Map([
          [76, 'right'],
          [79, 'right'],
        ]),
      );
    }
  });

  it('at a hold, shows the chord the transport will hold for next', () => {
    const chords = [note(60, 1000), note(64, 1030), note(67, 1400)];
    // Held at 1000 for 60 and 64: next is 67, as the transport resumes past the chord.
    expect(comingNotes(chords, 1000, 'right', 1, null, true)).toEqual(new Map([[67, 'right']]));
    // Playing on, a chord's later note is still coming until its own onset.
    expect(comingNotes(chords, 1015, 'right', 1)).toEqual(new Map([[64, 'right']]));
  });

  it('never drops a key before its onset in a dense passage', () => {
    // A key every 30 ms: whatever the playhead, the first key not yet played leads the chord.
    const run = Array.from({ length: 12 }, (_, i) => note(60 + i, i * 30));
    for (const playhead of [155, 160, 175, 179]) {
      expect(comingNotes(run, playhead, 'right', 1)).toEqual(
        new Map([
          [66, 'right'],
          [67, 'right'],
        ]),
      );
    }
    expect([...comingNotes(run, 181, 'right', 1).keys()]).toEqual([67, 68]);
  });

  it('comes round to the top of a loop, never past its end', () => {
    const notes = [note(60, 0), note(64, 2500), note(67, 3100)];
    const loop = { startMs: 0, endMs: 3000 };
    expect(comingNotes(notes, 1000, 'right', 1, loop)).toEqual(new Map([[64, 'right']]));
    // Near the end the next chord is the loop's first, 400 ms away, not 67.
    expect(comingNotes(notes, 2600, 'right', 1, loop)).toEqual(new Map([[60, 'right']]));
    expect(comingNotes(notes, 2600, 'right', 1)).toEqual(new Map([[67, 'right']]));
    // The way round counts: a first chord far into the loop waits.
    const late = [note(60, 1900), note(64, 2500)];
    expect(comingNotes(late, 2600, 'right', 1, loop).size).toBe(0);
  });

  it('comes round to the loop’s first note asked for, never one before the loop', () => {
    // 1000 is outside a loop from 1020; the next pass starts its asking at 1030.
    const notes = [note(60, 1000), note(64, 1030)];
    const loop = { startMs: 1020, endMs: 2000 };
    expect(comingNotes(notes, 1900, 'right', 1, loop)).toEqual(new Map([[64, 'right']]));
    // A hold just before the loop's end looks round the loop too.
    const edge = [note(60, 1030), note(64, 1990)];
    expect(comingNotes(edge, 1990, 'right', 1, loop, true)).toEqual(new Map([[60, 'right']]));
  });

  it('leaves out notes the score hides', () => {
    const hidden = { ...note(74, 200, 'treble'), hidden: true } as NoteEvent;
    const withHidden = [...NOTES, hidden].sort((a, b) => a.startMs - b.startMs);
    expect(comingNotes(withHidden, 100, 'right', 1).has(74)).toBe(false);
  });
});

describe('screenCues', () => {
  it('holds what the key bed on screen marks, and lets only its owner clear it', () => {
    const play = Symbol('play');
    const learn = Symbol('learn');
    let heard = 0;
    const stop = subscribeScreenCues(() => {
      heard += 1;
    });
    publishScreenCues(play, new Set([60]), undefined);
    expect([...getScreenCues().targets]).toEqual([60]);
    publishScreenCues(learn, new Set([62]), new Set([61]));
    clearScreenCues(play);
    expect([...getScreenCues().wrong]).toEqual([61]);
    clearScreenCues(learn);
    expect(getScreenCues()).toEqual(NO_SCREEN_CUES);
    expect(heard).toBe(3);
    stop();
  });

  it('holds a lesson picture’s marks beside the key bed’s, unmoved by an equal redraw', () => {
    const picture = Symbol('picture');
    let heard = 0;
    const stop = subscribeScreenCues(() => {
      heard += 1;
    });
    publishPictureMarks(picture, [60], [62, 64]);
    expect([...getScreenCues().pictured]).toEqual([60]);
    expect([...getScreenCues().picturedSecond]).toEqual([62, 64]);
    // A render hands over new arrays of the same keys: nothing changes.
    publishPictureMarks(picture, [60], [64, 62]);
    expect(heard).toBe(1);
    clearPictureMarks(Symbol('another'));
    expect(getScreenCues().pictured.size).toBe(1);
    clearPictureMarks(picture);
    expect(getScreenCues()).toEqual(NO_SCREEN_CUES);
    expect(heard).toBe(2);
    stop();
  });
});
