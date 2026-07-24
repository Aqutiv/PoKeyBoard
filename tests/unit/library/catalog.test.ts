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
      'evening-tide',
      'forward-gently',
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

  it('breathes Evening Tide through its tempo map and ends on an open ninth', () => {
    const take = getLibraryTake(libraryTakeId('evening-tide'));
    expect(take?.tempo.bpm).toBe(66);
    // Bars 21, 25, 29, 37 and 41: più mosso, the climax, a tempo, the coda,
    // and the closing ritardando.
    expect(take?.tempo.changes).toEqual([
      { atMs: 72_727, bpm: 72 },
      { atMs: 86_061, bpm: 76 },
      { atMs: 98_692, bpm: 66 },
      { atMs: 127_783, bpm: 60 },
      { atMs: 143_783, bpm: 52 },
    ]);
    // The melody tops out exactly at B5, the highest key the default C3–B5
    // view shows, so its climax is always on screen. The left hand reaches an
    // octave below that view — the keyboard does not follow a take's range, so
    // the bass has to be shifted down to watch, as it does for every library
    // track except A Beautiful Day.
    const midis = take?.notes.map((note) => note.midi) ?? [];
    expect(Math.min(...midis)).toBe(36); // C2
    expect(Math.max(...midis)).toBe(83); // B5

    // The last bar is Em add9, struck once and left ringing.
    const finalChord = take?.notes.filter((note) => note.startMs >= 148_000) ?? [];
    expect(finalChord.map((note) => note.midi)).toEqual([40, 47, 52, 64, 67, 71, 78]);
    expect(finalChord.every((note) => note.durationMs === finalChord[0]?.durationMs)).toBe(true);
  });

  it('keeps the tempo marks of the score Forward, Gently came from', () => {
    const take = getLibraryTake(libraryTakeId('forward-gently'));
    expect(take?.tempo.bpm).toBe(96);
    // Bars 25, 29, 31 and 32: radiant, calm, rit., serene.
    expect(take?.tempo.changes).toEqual([
      { atMs: 60_000, bpm: 104 },
      { atMs: 69_231, bpm: 96 },
      { atMs: 74_231, bpm: 84 },
      { atMs: 77_088, bpm: 76 },
    ]);
    // The last bar is played slowest, so it is the longest in milliseconds.
    const finalChord = take?.notes.filter((note) => note.startMs >= 77_088) ?? [];
    expect(finalChord.length).toBeGreaterThan(4);
    expect(finalChord.every((note) => note.durationMs === 3158)).toBe(true);
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
