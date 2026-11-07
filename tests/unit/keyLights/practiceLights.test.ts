import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import {
  COMING_WINDOW_MS,
  comingNotes,
  holdTargetHands,
} from '@/features/keyLights/practiceLights';
import {
  clearScreenCues,
  getScreenCues,
  NO_SCREEN_CUES,
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
    expect(holdTargetHands(NOTES, new Set([52, 76]), 1000)).toEqual(
      new Map([
        [52, 'left'],
        [76, 'right'],
      ]),
    );
  });

  it('takes no hand for a key with no note there', () => {
    expect(holdTargetHands(NOTES, new Set([61]), 1000)).toEqual(new Map([[61, null]]));
    expect(holdTargetHands(NOTES, new Set(), 1000).size).toBe(0);
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
    expect(getScreenCues()).toBe(NO_SCREEN_CUES);
    expect(heard).toBe(3);
    stop();
  });
});
