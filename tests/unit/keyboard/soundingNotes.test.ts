import { describe, expect, it } from 'vitest';
import { noteHand, type Hand } from '@/domain/hands';
import type { NoteEvent } from '@/domain/takeTypes';
import { SoundingNotes } from '@/features/keyboard/soundingNotes';

/** What a scan of the whole take says is sounding — the answer to match. */
function scan(notes: readonly NoteEvent[], ms: number): Map<number, Hand> {
  const hands = new Map<number, Hand>();
  for (const note of notes) {
    if (note.startMs > ms) break;
    if (ms >= note.startMs + note.durationMs) continue;
    if (!hands.has(note.midi)) hands.set(note.midi, noteHand(note));
  }
  return hands;
}

/** A deterministic take of overlapping notes, long and short, sorted by start. */
function take(count: number): NoteEvent[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const notes: NoteEvent[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    at += Math.floor(random() * 120);
    notes.push({
      id: `n${i}`,
      midi: 36 + Math.floor(random() * 48),
      startMs: at,
      durationMs: 20 + Math.floor(random() * (random() < 0.1 ? 6000 : 600)),
      velocity: 0.6,
    });
  }
  return notes;
}

describe('the notes sounding under the playhead', () => {
  it('says what a scan of the whole take says, frame after frame', () => {
    const notes = take(2000);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    for (let ms = 0; ms < 60_000; ms += 16.7) {
      expect(sounding.handsAt(ms)).toEqual(scan(notes, ms));
    }
  });

  it('finds them afresh after a jump back or far ahead', () => {
    const notes = take(2000);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    for (const ms of [30_000, 30_050, 12_000, 12_016, 90_000, 5]) {
      expect(sounding.handsAt(ms)).toEqual(scan(notes, ms));
    }
  });

  it('gives a key both hands sound to the note that started first', () => {
    const sounding = new SoundingNotes();
    sounding.setNotes([
      { id: 'l', midi: 60, startMs: 0, durationMs: 1000, velocity: 0.6, staff: 'bass' },
      { id: 'r', midi: 60, startMs: 100, durationMs: 1000, velocity: 0.6, staff: 'treble' },
    ]);
    expect(sounding.handsAt(500)).toEqual(new Map([[60, 'left']]));
  });

  it('says what is about to start', () => {
    const notes = take(200);
    const sounding = new SoundingNotes();
    sounding.setNotes(notes);
    sounding.handsAt(1000);
    const expected = notes
      .filter((note) => note.startMs > 1000 && note.startMs <= 2500)
      .map((note) => note.midi);
    expect(sounding.startingWithin(1000, 1500)).toEqual(expected);
  });
});
