import { describe, expect, it } from 'vitest';
import { phraseToNotes } from '@/features/learn/phrase';
import { midiToStaffPosition } from '@/features/notation/staffMapping';
import { singleNotePhrase, staffModeFor } from '@/features/learn/staffPhrase';

describe('singleNotePhrase', () => {
  it('returns the very same object for the same note', () => {
    // The point of the cache. `StaffSnippet` memoizes its engraved layout on
    // the phrase identity, and the runner re-renders on every key press, so a
    // fresh object per render would re-engrave the staff on every keystroke.
    expect(singleNotePhrase(60)).toBe(singleNotePhrase(60));
  });

  it('returns a different object for a different note', () => {
    expect(singleNotePhrase(60)).not.toBe(singleNotePhrase(62));
  });

  it('holds exactly the note it was asked for', () => {
    const notes = phraseToNotes(singleNotePhrase(67));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.midi).toBe(67);
  });

  it('fills the whole bar, so no rest is engraved beside it', () => {
    const notes = phraseToNotes(singleNotePhrase(64));
    // 4 beats at 60bpm.
    expect(notes[0]?.startMs).toBe(0);
    expect(notes[0]?.durationMs).toBe(4000);
  });

  it('caches the same note on each staff apart', () => {
    // Middle C is one pitch and two pictures: below the treble staff, above
    // the bass one. A cache keyed on midi alone would hand the bass round the
    // treble phrase and draw the note a third and a bit from where it belongs.
    expect(singleNotePhrase(60, 'bass')).toBe(singleNotePhrase(60, 'bass'));
    expect(singleNotePhrase(60, 'bass')).not.toBe(singleNotePhrase(60));
    expect(singleNotePhrase(60, 'bass')).not.toBe(singleNotePhrase(60, 'treble'));
  });

  it('writes the staff it was asked for onto the note', () => {
    const notes = phraseToNotes(singleNotePhrase(60, 'bass'));
    expect(notes[0]?.staff).toBe('bass');
    expect(midiToStaffPosition(notes[0]!.midi, notes[0]!.staff).staff).toBe('bass');
  });

  it('leaves the staff unsaid when it is not asked for', () => {
    // Chapters 1-4 say nothing, and `midiToStaffPosition` splitting at middle
    // C is the right answer for every note they draw.
    expect(phraseToNotes(singleNotePhrase(60))[0]?.staff).toBeUndefined();
  });
});

describe('staffModeFor', () => {
  it('draws one treble staff when a round says nothing', () => {
    expect(staffModeFor(undefined)).toBe('treble');
  });

  it('draws the staff a round names', () => {
    expect(staffModeFor('bass')).toBe('bass');
    expect(staffModeFor('treble')).toBe('treble');
  });
});
