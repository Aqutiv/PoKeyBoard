import { describe, expect, it } from 'vitest';
import { isLibraryTakeId, libraryTakeId } from '@/domain/libraryTakes';
import { parseTakeJsonString } from '@/domain/takeSchema';
import {
  getLibraryTake,
  LIBRARY_TRACK_SUMMARIES,
  LIBRARY_TRACKS,
} from '@/features/library/catalog';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { MIDI_MAX, MIDI_MIN } from '@/utils/midi';

describe('library catalog', () => {
  it('ships the library tracks in display order', () => {
    expect(LIBRARY_TRACKS.map((def) => def.trackId)).toEqual([
      'a-beautiful-day',
      'fur-elise',
      'gymnopedie-1',
      'blues-in-c',
      'good-night',
      'moonlight-sonata',
    ]);
  });

  it('credits Good Night to its requested artist', () => {
    const goodNight = LIBRARY_TRACKS.find((def) => def.trackId === 'good-night');
    expect(goodNight).toMatchObject({
      title: 'Good Night',
      composer: 'GPT 5.6 Sol Ultra',
    });
  });

  it('summaries mirror the built takes', () => {
    expect(LIBRARY_TRACK_SUMMARIES).toHaveLength(LIBRARY_TRACKS.length);
    for (const summary of LIBRARY_TRACK_SUMMARIES) {
      const take = getLibraryTake(summary.takeId);
      expect(take).toBeDefined();
      expect(take?.notes).toHaveLength(summary.noteCount);
      expect(take?.durationMs).toBe(summary.durationMs);
      expect(take?.tempo.bpm).toBe(summary.bpm);
    }
  });

  it('returns a fresh pristine instance on every call', () => {
    const id = libraryTakeId('fur-elise');
    const first = getLibraryTake(id);
    const second = getLibraryTake(id);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(getLibraryTake('library:unknown-track')).toBeUndefined();
    expect(getLibraryTake('not-a-library-id')).toBeUndefined();
  });

  for (const def of LIBRARY_TRACKS) {
    describe(`track "${def.trackId}"`, () => {
      const take = buildLibraryTake(def);

      it('uses a library id and has substantial content', () => {
        expect(take.id).toBe(libraryTakeId(def.trackId));
        expect(isLibraryTakeId(take.id)).toBe(true);
        expect(take.title).toBe(def.title);
        expect(take.notes.length).toBeGreaterThan(50);
        // Every launch track is a real piece, not a snippet (the longest,
        // the full Moonlight first movement, runs about five minutes).
        expect(take.durationMs).toBeGreaterThan(30_000);
        expect(take.durationMs).toBeLessThan(8 * 60_000);
      });

      it('stays inside the physical keyboard range', () => {
        for (const note of take.notes) {
          expect(note.midi).toBeGreaterThanOrEqual(MIDI_MIN);
          expect(note.midi).toBeLessThanOrEqual(MIDI_MAX);
        }
      });

      it('round-trips the take schema with zero repairs', () => {
        const parsed = parseTakeJsonString(JSON.stringify(take));
        expect(parsed.repairs).toEqual([]);
        expect(parsed.take.notes).toHaveLength(take.notes.length);
        expect(parsed.take.id).toBe(take.id);
      });
    });
  }
});
