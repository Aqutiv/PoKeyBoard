import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { noteFingers } from '@/domain/fingering';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { extractMusicXmlText } from '@/domain/mxlContainer';
import type { NoteEvent, NoteStaff } from '@/domain/takeTypes';
import { SCORE_PACK_PATH } from '@/features/library/scoreLoader';

const RIGHT: NoteStaff = 'treble';
const LEFT: NoteStaff = 'bass';

/**
 * A line of single notes or chords, a quarter of a second apart and held to
 * the next (so no rests), on one staff — or on none, as a recording is.
 */
function line(steps: readonly (number | readonly number[])[], staff?: NoteStaff): NoteEvent[] {
  return steps.flatMap((step, i) =>
    (typeof step === 'number' ? [step] : step).map((midi) => ({
      id: `n${i}-${midi}`,
      midi,
      startMs: i * 250,
      durationMs: 250,
      velocity: 0.7,
      ...(staff ? { staff } : {}),
    })),
  );
}

/** The fingers, note by note in the take's order, as one string. */
function fingered(notes: readonly NoteEvent[]): string {
  const fingers = noteFingers(notes);
  return notes.map((note) => fingers.get(note.id) ?? '-').join('');
}

/** A major scale's keys from `root`, up an octave. */
function major(root: number): number[] {
  return [0, 2, 4, 5, 7, 9, 11, 12].map((step) => root + step);
}

const C4 = 60;
const C3 = 48;

describe('noteFingers', () => {
  it('fingers the C major scale as it is taught, in both hands', () => {
    const up = major(C4);
    const upAndDown = [...up, ...up.slice(0, -1).reverse()];
    expect(fingered(line(upAndDown, RIGHT))).toBe('123123454321321');
    const left = major(C3);
    expect(fingered(line([...left, ...left.slice(0, -1).reverse()], LEFT))).toBe('543213212312345');
    // Two octaves: the thumb passes under twice.
    const twoOctaves = [...up, ...major(C4 + 12).slice(1)];
    expect(fingered(line(twoOctaves, RIGHT))).toBe('123123412312345');
  });

  it('takes C’s shape to scales whose black keys fall under long fingers', () => {
    expect(fingered(line(major(67), RIGHT))).toBe('12312345'); // G major
    expect(fingered(line(major(62), RIGHT))).toBe('12312345'); // D major
    expect(fingered(line(major(43), LEFT))).toBe('54321321'); // G major, left
  });

  it('keeps the thumb off the black keys where a white one serves', () => {
    // F, B♭ and E♭ major. Teachers start these on other fingers (F on 1 with
    // 4 on B♭, B♭ on 4, E♭ on 3), but every one keeps the thumb on white keys,
    // which is the rule behind them.
    for (const root of [65, 70, 63]) {
      const notes = line(major(root), RIGHT);
      const fingers = noteFingers(notes);
      const thumbs = notes.filter((note) => fingers.get(note.id) === 1).map((note) => note.midi);
      expect(thumbs.length, String(root)).toBeGreaterThan(0);
      expect(
        thumbs.every((midi) => ![1, 3, 6, 8, 10].includes(midi % 12)),
        String(root),
      ).toBe(true);
    }
  });

  it('holds a five-finger position', () => {
    const position = [0, 2, 4, 5, 7, 5, 4, 2, 0];
    expect(
      fingered(
        line(
          position.map((step) => C4 + step),
          RIGHT,
        ),
      ),
    ).toBe('123454321');
    expect(
      fingered(
        line(
          position.map((step) => C3 + step),
          LEFT,
        ),
      ),
    ).toBe('543212345');
  });

  it('spreads a triad across the thumb, the middle finger and the little finger', () => {
    expect(fingered(line([[C4, C4 + 4, C4 + 7]], RIGHT))).toBe('135');
    // Low to high, the left hand's little finger takes the bottom.
    expect(fingered(line([[C3, C3 + 4, C3 + 7]], LEFT))).toBe('531');
  });

  it('splits a take that names no staff at middle C, as the notation does', () => {
    const position = [0, 2, 4, 5, 7];
    expect(fingered(line(position.map((step) => C3 + step)))).toBe('54321');
    expect(fingered(line(position.map((step) => C4 + step)))).toBe('12345');
  });

  it('counts notes a hand spreads a little as one chord, and a later one as the next', () => {
    const at = (id: string, midi: number, startMs: number): NoteEvent => ({
      id,
      midi,
      startMs,
      durationMs: 400,
      velocity: 0.7,
    });
    // A triad struck over 30 ms, as a recording catches one: still a chord,
    // so three fingers rising with it. Then G again, struck 300 ms later.
    const notes = [at('c', 60, 0), at('e', 64, 12), at('g', 67, 30), at('g2', 67, 330)];
    const fingers = noteFingers(notes);
    expect(['c', 'e', 'g'].map((id) => fingers.get(id))).toEqual([1, 3, 5]);
    expect(fingers.get('g2')).toBe(5);
  });

  it('keeps the fingers a score prints, and fits the rest around them', () => {
    const notes = line(
      [0, 2, 4, 5, 7].map((step) => C4 + step),
      RIGHT,
    );
    // The line started on the second finger: the thumb passes under at once,
    // onto D, and the hand goes on up from there.
    (notes[0] as NoteEvent).finger = 2;
    expect(fingered(notes)).toBe('21345');
    // Even a finger the search would never choose is the score's to give.
    const chord = line([[C4, C4 + 4]], RIGHT).map((note) => ({ ...note, finger: 2 as const }));
    expect(fingered(chord)).toBe('22');
    expect(fingered(line([[C4, C4 + 4]], RIGHT))).not.toBe('22');
  });

  it('works out every note blind, printed or not, when asked', () => {
    const notes = line(
      [0, 2, 4, 5, 7].map((step) => C4 + step),
      RIGHT,
    );
    (notes[0] as NoteEvent).finger = 2;
    const blind = noteFingers(notes, { keepPrinted: false });
    expect(notes.map((note) => blind.get(note.id)).join('')).toBe('12345');
  });

  it('fingers no note that is never played, and no sixth key in one hand', () => {
    const notes = line([[48, 52, 55, 60, 64, 67]], RIGHT);
    const silent: NoteEvent = { ...(notes[0] as NoteEvent), id: 'silent', velocity: 0 };
    const fingers = noteFingers([...notes, silent]);
    // The right hand keeps its five highest keys; the lowest has no finger.
    expect(notes.map((note) => fingers.get(note.id) ?? '-').join('')).toBe('-12345');
    expect(fingers.has('silent')).toBe(false);
  });

  it('works out each notes array once', () => {
    const notes = line(major(C4), RIGHT);
    expect(noteFingers(notes)).toBe(noteFingers(notes));
  });

  it('fingers a long take within its time budget', () => {
    // Twenty thousand notes in both hands: runs, broken chords and full
    // chords, so every kind of step is searched.
    const notes: NoteEvent[] = [];
    for (let i = 0; notes.length < 20_000; i += 1) {
      const startMs = i * 120;
      const right = 60 + ((i * 5) % 24);
      const left = 36 + ((i * 7) % 20);
      notes.push({
        id: `r${i}`,
        midi: right,
        startMs,
        durationMs: 120,
        velocity: 0.7,
        staff: RIGHT,
      });
      if (i % 4 === 0) {
        for (const step of [0, 4, 7]) {
          notes.push({
            id: `l${i}-${step}`,
            midi: left + step,
            startMs,
            durationMs: 480,
            velocity: 0.6,
            staff: LEFT,
          });
        }
      }
    }
    const started = performance.now();
    const fingers = noteFingers(notes);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(fingers.size).toBe(notes.length);
  });
});

describe('noteFingers against the library’s printed fingers', () => {
  const PACK_DIR = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);
  // The library's scores that print fingers.
  const FINGERED = [
    'Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl',
    'Fur_Elise_fingered.mxl',
    'The_Entertainer_-_Scott_Joplin.mxl',
    'Chopin_-_Nocturne_Op_9_No_2_E_Flat_Major.mxl',
    'Canon_in_D_easy.mxl',
    'WA_Mozart_Marche_Turque_Turkish_March_fingered.mxl',
    'Waltz_in_A_MinorChopin.mxl',
    'Greensleeves_for_Piano_easy_and_beautiful.mxl',
  ];

  it('agrees with the editors on as many notes as it did when written, working blind', async () => {
    let printed = 0;
    let agreed = 0;
    for (const file of FINGERED) {
      const bytes = await readFile(path.join(PACK_DIR, file));
      const { notes } = musicXmlToTake(extractMusicXmlText(new Uint8Array(bytes)), file);
      const blind = noteFingers(notes, { keepPrinted: false });
      const kept = noteFingers(notes);
      for (const note of notes) {
        if (note.finger === undefined) continue;
        printed += 1;
        if (blind.get(note.id) === note.finger) agreed += 1;
        // Kept, every printed finger shows as printed.
        expect(kept.get(note.id), `${file} ${note.id}`).toBe(note.finger);
      }
    }
    // Every finger the scores print on a note that is struck, grace notes and
    // held ties aside.
    expect(printed).toBe(1428);
    // 809 of them (57%) since The Entertainer's two parts were read as its two
    // hands. A change to the costs that agrees with the editors less often
    // should be a deliberate one.
    expect(agreed).toBeGreaterThanOrEqual(809);
  }, 60_000);
});
