import { describe, expect, it } from 'vitest';
import { phraseToNotes } from '@/features/learn/phrase';
import { singleNotePhrase } from '@/features/learn/staffPhrase';

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
});
