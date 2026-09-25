import { describe, expect, it } from 'vitest';
import { isLibraryTakeId, libraryTakeId } from '@/domain/libraryTakes';
import { parseTakeJsonString } from '@/domain/takeSchema';
import {
  filterLibrarySections,
  getLibraryTake,
  LIBRARY_FOLDER_SECTIONS,
  LIBRARY_FOLDER_SUMMARIES,
  LIBRARY_TRACK_SUMMARIES,
  LIBRARY_TRACKS,
} from '@/features/library/catalog';
import { DEFAULT_LIBRARY_FOLDER, LIBRARY_FOLDER_IDS } from '@/features/library/folders';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { detectFifths } from '@/features/notation/keyDetection';
import { MIDI_MAX, MIDI_MIN } from '@/utils/midi';

describe('library catalog', () => {
  it('ships the library tracks in display order', () => {
    expect(LIBRARY_TRACKS.map((def) => def.trackId)).toEqual([
      'a-beautiful-day',
      'evening-tide',
      'forward-gently',
      'crooked-lantern-waltz',
      'fur-elise',
      'gymnopedie-1',
      'blues-in-c',
      'good-night',
      'moonlight-sonata',
      'ode-to-joy-first-steps',
      'where-starlight-lingers',
      'silverwood-tale',
    ]);
  });

  it('shelves every track in its folder', () => {
    expect(LIBRARY_FOLDER_SUMMARIES.originals.map((track) => track.trackId)).toEqual([
      'a-beautiful-day',
      'evening-tide',
      'forward-gently',
      'crooked-lantern-waltz',
      'blues-in-c',
      'good-night',
      'where-starlight-lingers',
      'silverwood-tale',
    ]);
    // Classics leads with the authored transcriptions, then the vendored pack.
    expect(
      LIBRARY_FOLDER_SUMMARIES.classics
        .filter((track) => track.source === 'authored')
        .map((track) => track.trackId),
    ).toEqual(['fur-elise', 'gymnopedie-1', 'moonlight-sonata', 'ode-to-joy-first-steps']);
    expect(
      LIBRARY_FOLDER_SUMMARIES.classics.slice(0, 4).every((t) => t.source === 'authored'),
    ).toBe(true);
    expect(LIBRARY_FOLDER_SUMMARIES.classics.slice(4).every((t) => t.source === 'score')).toBe(
      true,
    );
    // The default folder is the one shown before the user has chosen.
    expect(LIBRARY_FOLDER_SUMMARIES[DEFAULT_LIBRARY_FOLDER]).toBe(
      LIBRARY_FOLDER_SUMMARIES.originals,
    );
  });

  it('partitions the catalog exactly — every track filed once', () => {
    const filed = LIBRARY_FOLDER_IDS.flatMap((folder) => [...LIBRARY_FOLDER_SUMMARIES[folder]]);
    const authored = filed.filter((track) => track.source === 'authored');
    expect(authored).toHaveLength(LIBRARY_TRACK_SUMMARIES.length);
    // No id may repeat across the two sources: a vendored score wearing an
    // authored track's id would shadow it in getLibraryTake.
    expect(new Set(filed.map((track) => track.trackId)).size).toBe(filed.length);
    // Order inside a folder follows the catalog's display order.
    for (const folder of LIBRARY_FOLDER_IDS) {
      expect(authored.filter((track) => track.folder === folder)).toEqual(
        LIBRARY_TRACK_SUMMARIES.filter((track) => track.folder === folder),
      );
    }
  });

  it('lays each folder out as a pinned run then composer groups', () => {
    // The smaller Originals folder needs no grouping.
    expect(LIBRARY_FOLDER_SECTIONS.originals).toHaveLength(1);
    expect(LIBRARY_FOLDER_SECTIONS.originals[0]?.composer).toBeNull();

    const [pinned, ...groups] = LIBRARY_FOLDER_SECTIONS.classics;
    expect(pinned?.composer).toBeNull();
    expect(pinned?.tracks.map((track) => track.trackId)).toEqual([
      'fur-elise',
      'gymnopedie-1',
      'moonlight-sonata',
      'ode-to-joy-first-steps',
    ]);
    expect(groups.length).toBeGreaterThan(1);
    // Every later section is a real composer holding only their own tracks.
    for (const group of groups) {
      expect(group.composer).not.toBeNull();
      expect(group.tracks.every((track) => track.composer === group.composer)).toBe(true);
      expect(group.tracks.length).toBeGreaterThan(0);
    }
    // Groups run by surname — the last word of the credit.
    const surnames = groups.map((group) => (group.composer ?? '').split(' ').at(-1) ?? '');
    expect(surnames).toEqual([...surnames].sort((a, b) => a.localeCompare(b)));
    // Beethoven files under B, not V.
    expect(groups[0]?.composer).toBe('Johann Sebastian Bach');
  });

  it('sections hold every track in the folder, exactly once', () => {
    for (const folder of LIBRARY_FOLDER_IDS) {
      const sectioned = LIBRARY_FOLDER_SECTIONS[folder].flatMap((section) => [...section.tracks]);
      expect(sectioned).toHaveLength(LIBRARY_FOLDER_SUMMARIES[folder].length);
      expect(new Set(sectioned.map((track) => track.trackId)).size).toBe(sectioned.length);
      // Same set as the flat view, regardless of the order grouping imposes.
      expect(sectioned.map((track) => track.trackId).sort()).toEqual(
        LIBRARY_FOLDER_SUMMARIES[folder].map((track) => track.trackId).sort(),
      );
    }
  });

  it('narrows the sections to what matches, headings and all', () => {
    const classics = LIBRARY_FOLDER_SECTIONS.classics;
    // A blank query is not a filter: same array back, so nothing re-renders.
    expect(filterLibrarySections(classics, '')).toBe(classics);
    expect(filterLibrarySections(classics, '   ')).toBe(classics);

    const nocturnes = filterLibrarySections(classics, 'nocturne');
    const matched = nocturnes.flatMap((section) => [...section.tracks]);
    expect(matched.length).toBeGreaterThan(2);
    expect(matched.every((track) => /nocturne/i.test(track.title))).toBe(true);
    // Emptied sections drop out rather than leaving a bare heading.
    expect(nocturnes.every((section) => section.tracks.length > 0)).toBe(true);
    // Surviving sections keep the order they were built in.
    const order = nocturnes.map((section) => section.composer);
    expect(order).toEqual(classics.map((s) => s.composer).filter((c) => order.includes(c)));

    // Searching a composer returns that composer's whole group — and the
    // pinned run is filtered too, so the authored Gymnopédie comes along.
    const satie = filterLibrarySections(classics, 'satie');
    expect(satie.map((section) => section.composer)).toEqual([null, 'Erik Satie']);
    expect(satie[0]?.tracks.map((track) => track.trackId)).toEqual(['gymnopedie-1']);
    expect(satie[1]?.tracks).toEqual(
      classics.find((section) => section.composer === 'Erik Satie')?.tracks,
    );

    // Accents are optional, and a miss is empty rather than everything.
    expect(filterLibrarySections(classics, 'fur elise').length).toBeGreaterThan(0);
    expect(filterLibrarySections(classics, 'zzzz nothing')).toEqual([]);
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

  it('keeps the crooked waltz on the staffs its score was written on', () => {
    const take = getLibraryTake(libraryTakeId('crooked-lantern-waltz'));
    expect(take?.tempo.bpm).toBe(112);
    expect(take?.tempo.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    // Bars 29, 37 and the written-out ritardando of the last four bars.
    expect(take?.tempo.changes).toEqual([
      { atMs: 45_000, bpm: 126 },
      { atMs: 56_429, bpm: 112 },
      { atMs: 69_286, bpm: 96 },
      { atMs: 71_161, bpm: 84 },
      { atMs: 73_304, bpm: 72 },
      { atMs: 75_804, bpm: 56 },
    ]);
    // Every note says which hand wrote it, and the left hand climbs well past
    // middle C — where splitting the grand staff at middle C would misdraw it.
    const notes = take?.notes ?? [];
    expect(notes.every((note) => note.staff !== undefined)).toBe(true);
    const bass = notes.filter((note) => note.staff === 'bass');
    expect(bass.filter((note) => note.midi >= 60)).not.toHaveLength(0);
    expect(Math.max(...bass.map((note) => note.midi))).toBe(69); // A4

    // The last bar is A minor add 9 over an open bass, struck once and left ringing.
    const finalChord = notes.filter((note) => note.startMs >= 75_804);
    expect(finalChord.map((note) => note.midi)).toEqual([33, 40, 45, 69, 72, 76, 83]);
  });

  it('tells the Silverwood Tale in one flat, and lets no note ring into the next bar', () => {
    const take = getLibraryTake(libraryTakeId('silverwood-tale'));
    expect(take?.tempo.bpm).toBe(72);
    expect(take?.tempo.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    // The ballad at 96, the dragon's roar at 116, the last bell at 48.
    const bpms = take?.tempo.changes?.map((change) => change.bpm) ?? [];
    expect(bpms).toHaveLength(20);
    expect(bpms[1]).toBe(96);
    expect(Math.max(...bpms)).toBe(116);
    expect(bpms.at(-1)).toBe(48);

    const notes = take?.notes ?? [];
    // The notation reads a single key from the pitches, so the piece keeps
    // every colour on the flat side: one flat, and no F sharp at all.
    expect(detectFifths(notes)).toBe(-1);
    expect(notes.filter((note) => note.midi % 12 === 6)).toEqual([]);
    expect(notes.every((note) => note.staff !== undefined)).toBe(true);

    // The pedal goes down on every bar line, and a note released right on one
    // is caught by it and rings through the whole next bar.
    const pedalDowns = new Set(
      take?.pedalEvents.filter((event) => event.down).map((event) => event.atMs),
    );
    expect(notes.filter((note) => pedalDowns.has(note.startMs + note.durationMs))).toEqual([]);

    // The book closes on F with its ninth, spread up to a bell on A6.
    const finalChord = notes.filter((note) => note.startMs >= 118_000);
    expect(finalChord.map((note) => note.midi)).toEqual([29, 48, 57, 67, 72, 77, 81, 93]);
  });

  it('keeps the accidentals each track was written with', () => {
    // A name written with an accidental is its author's spelling, and the
    // notation keeps it: every A flat of the Silverwood Tale stays one.
    const silverwood = getLibraryTake(libraryTakeId('silverwood-tale'))!;
    const aFlats = silverwood.notes.filter((note) => note.midi % 12 === 8);
    expect(aFlats.length).toBeGreaterThan(0);
    expect(aFlats.every((note) => note.spelling?.step === 'A' && note.spelling.alter === -1)).toBe(
      true,
    );
    // A bare letter names only a key: the Moonlight's C's carry no spelling,
    // so the notation can write its leading tone as the B sharp it is.
    const moonlight = getLibraryTake(libraryTakeId('moonlight-sonata'))!;
    const cs = moonlight.notes.filter((note) => note.midi % 12 === 0);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((note) => note.spelling === undefined)).toBe(true);
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

  /**
   * Tracks a Learn chapter hands off to, which are exactly as long as the
   * lesson that teaches them — short on purpose, not a snippet by accident.
   */
  const LESSON_PIECES = new Set(['ode-to-joy-first-steps']);

  for (const def of LIBRARY_TRACKS) {
    describe(`track "${def.trackId}"`, () => {
      const take = buildLibraryTake(def);

      it('uses a library id and has substantial content', () => {
        expect(take.id).toBe(libraryTakeId(def.trackId));
        expect(isLibraryTakeId(take.id)).toBe(true);
        expect(take.title).toBe(def.title);
        expect(take.notes.length).toBeGreaterThan(LESSON_PIECES.has(def.trackId) ? 20 : 50);
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
