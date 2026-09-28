import { describe, expect, it } from 'vitest';
import { noteHand, type KeyCue } from '@/domain/hands';
import type { NoteEvent } from '@/domain/takeTypes';
import { SoundingNotes } from '@/features/keyboard/soundingNotes';

/**
 * What a scan of the whole take says is sounding — the answer to match. Each
 * key is lit in the hand of its earliest note still sounding. While a played
 * note holds it down, it shows the velocity of the strike heard on it: the
 * last played note struck by then, the louder of two at one moment. A key only
 * notes written but not played are on shows none.
 */
function scan(notes: readonly NoteEvent[], ms: number): Map<number, KeyCue> {
  const heard = new Map<number, NoteEvent>();
  const earliest = new Map<number, NoteEvent>();
  const held = new Set<number>();
  for (const note of notes) {
    if (note.startMs > ms) break;
    const played = note.velocity > 0;
    const best = heard.get(note.midi);
    if (
      played &&
      (best === undefined || note.startMs > best.startMs || note.velocity > best.velocity)
    ) {
      heard.set(note.midi, note);
    }
    if (ms < note.startMs + note.durationMs) {
      if (!earliest.has(note.midi)) earliest.set(note.midi, note);
      if (played) held.add(note.midi);
    }
  }
  const keys = new Map<number, KeyCue>();
  for (const [midi, note] of earliest) {
    const velocity = held.has(midi) ? (heard.get(midi) as NoteEvent).velocity : 0;
    keys.set(midi, { hand: noteHand(note), velocity });
  }
  return keys;
}

/**
 * A deterministic take of overlapping notes, long and short, sorted by start:
 * at all sorts of velocities, some of them written but not played, and some
 * struck twice at one moment, the way two voices share a key.
 */
function take(count: number): NoteEvent[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const velocity = () => (random() < 0.05 ? 0 : Math.round(random() * 1000) / 1000);
  const notes: NoteEvent[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    const previous = notes[notes.length - 1];
    if (previous && random() < 0.08) {
      notes.push({
        ...previous,
        id: `n${i}`,
        durationMs: 20 + Math.floor(random() * 2000),
        velocity: velocity(),
        staff: random() < 0.5 ? 'bass' : 'treble',
      });
      continue;
    }
    at += Math.floor(random() * 120);
    notes.push({
      id: `n${i}`,
      midi: 36 + Math.floor(random() * 48),
      startMs: at,
      durationMs: 20 + Math.floor(random() * (random() < 0.1 ? 6000 : 600)),
      velocity: velocity(),
    });
  }
  return notes;
}

function note(
  id: string,
  startMs: number,
  durationMs: number,
  velocity: number,
  staff?: 'bass' | 'treble',
): NoteEvent {
  return { id, midi: 60, startMs, durationMs, velocity, ...(staff ? { staff } : {}) };
}

function cueAt(notes: NoteEvent[], ms: number): KeyCue | undefined {
  const sounding = new SoundingNotes();
  sounding.setNotes(notes);
  return sounding.keysAt(ms).get(60);
}

describe('the notes sounding under the playhead', () => {
  it('says what a scan of the whole take says, frame after frame', () => {
    const notes = take(2000);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    for (let ms = 0; ms < 60_000; ms += 16.7) {
      expect(sounding.keysAt(ms)).toEqual(scan(notes, ms));
    }
  });

  it('finds them afresh after a jump back or far ahead', () => {
    const notes = take(2000);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    for (const ms of [30_000, 30_050, 12_000, 12_016, 90_000, 5]) {
      expect(sounding.keysAt(ms)).toEqual(scan(notes, ms));
    }
  });

  it('gives a key both hands sound to the note that started first', () => {
    const sounding = new SoundingNotes();
    sounding.setNotes([
      { id: 'l', midi: 60, startMs: 0, durationMs: 1000, velocity: 0.4, staff: 'bass' },
      { id: 'r', midi: 60, startMs: 100, durationMs: 1000, velocity: 0.8, staff: 'treble' },
    ]);
    // In its shade, but at the strike heard since: the right hand's.
    expect(sounding.keysAt(500)).toEqual(new Map([[60, { hand: 'left', velocity: 0.8 }]]));
  });

  it('shows a key at the strike last heard on it', () => {
    const notes = [note('long', 0, 2000, 0.3), note('short', 500, 200, 0.9)];
    expect(cueAt(notes, 300)?.velocity).toBe(0.3);
    expect(cueAt(notes, 600)?.velocity).toBe(0.9);
  });

  it('holds a strike inside a longer note until that one lets the key go', () => {
    // The eighth is struck inside the half note and held for it, so it is what
    // sounds after its own end.
    const notes = [note('half', 0, 2000, 0.3), note('eighth', 500, 200, 0.9)];
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    for (const ms of [800, 1500, 1999]) expect(sounding.keysAt(ms).get(60)?.velocity).toBe(0.9);
    expect(sounding.keysAt(2000).has(60)).toBe(false);
  });

  it('shows the louder of two copies struck together, however they are stored', () => {
    const loud = note('loud', 0, 200, 0.9);
    const soft = note('soft', 0, 2000, 0.3);
    for (const notes of [
      [loud, soft],
      [soft, loud],
    ]) {
      expect(cueAt(notes, 100)?.velocity).toBe(0.9);
      // Past the loud copy's own end, it still sounds: it was struck last.
      expect(cueAt(notes, 1000)?.velocity).toBe(0.9);
    }
  });

  it('never lets a note written but not played dim one that is heard', () => {
    expect(cueAt([note('played', 0, 1000, 0.7), note('silent', 200, 600, 0)], 500)?.velocity).toBe(
      0.7,
    );
    expect(cueAt([note('silent', 0, 1000, 0), note('played', 0, 1000, 0.7)], 500)?.velocity).toBe(
      0.7,
    );
  });

  it('lights a key only a note not played is on, at no velocity at all', () => {
    expect(cueAt([note('silent', 0, 1000, 0, 'bass')], 500)).toEqual({ hand: 'left', velocity: 0 });
    // The played note's press is over; the silent one lights the key alone.
    expect(cueAt([note('played', 0, 300, 0.8), note('silent', 500, 1000, 0)], 1000)?.velocity).toBe(
      0,
    );
  });

  it('lets a strike go once no played note holds the key, whatever a silent one still lights', () => {
    // A trill as a score writes it out: the written note, not played, under
    // hidden strikes that are. Between strikes nothing holds the key down.
    const notes = [
      note('written', 0, 2000, 0, 'treble'),
      { ...note('first', 100, 50, 0.9), hidden: true as const },
      { ...note('second', 300, 50, 0.8), hidden: true as const },
    ];
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    expect(sounding.keysAt(120).get(60)).toEqual({ hand: 'right', velocity: 0.9 });
    expect(sounding.keysAt(200).get(60)).toEqual({ hand: 'right', velocity: 0 });
    expect(sounding.keysAt(320).get(60)?.velocity).toBe(0.8);
    expect(sounding.keysAt(400).get(60)?.velocity).toBe(0);
    // Found afresh after a jump, the same.
    expect(sounding.keysAt(200).get(60)?.velocity).toBe(0);
  });

  it('forgets what a jump leaves behind', () => {
    const notes = [note('first', 0, 1000, 0.3), note('second', 5000, 1000, 0.9)];
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    expect(sounding.keysAt(5500).get(60)?.velocity).toBe(0.9);
    expect(sounding.keysAt(500).get(60)?.velocity).toBe(0.3);
  });

  it('says what is about to start', () => {
    const notes = take(200);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    sounding.keysAt(1000);
    const expected = notes
      .filter((note) => note.startMs > 1000 && note.startMs <= 2500)
      .map((note) => note.midi);
    expect(sounding.startingWithin(1000, 1500)).toEqual(expected);
  });
});
