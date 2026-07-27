import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { buildLibraryTake, type LibraryTrackDef } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { EVENING_TIDE } from '@/features/library/tracks/eveningTide';
import { FUR_ELISE } from '@/features/library/tracks/furElise';
import { GOOD_NIGHT } from '@/features/library/tracks/goodNight';
import { MOONLIGHT_SONATA } from '@/features/library/tracks/moonlightSonata';
import { layoutScore } from '@/features/notation/notationLayout';
import { TREBLE_SPLIT_MIDI } from '@/features/notation/staffMapping';
import { isTernaryBeat } from '@/features/notation/tuplets';

/** A little human sloppiness, as a fraction of the beat. */
function jitter(offsets: number[], by: number): number[] {
  return offsets.map((offset, i) => offset + (i % 2 === 0 ? by : -by));
}

describe('isTernaryBeat', () => {
  it('reads an even triplet as ternary', () => {
    expect(isTernaryBeat([0, 1 / 3, 2 / 3])).toBe(true);
  });

  it('does not read straight sixteenths as ternary', () => {
    expect(isTernaryBeat([0, 0.25, 0.5, 0.75])).toBe(false);
  });

  it('does not read straight quavers as ternary', () => {
    expect(isTernaryBeat([0, 0.5])).toBe(false);
  });

  it('tells a triplet from a dotted eighth and a sixteenth', () => {
    // The pair that fools a test which only counts notes. A dotted eighth plus
    // a sixteenth sits at 0 and ¾; a triplet at 0, ⅓, ⅔.
    expect(isTernaryBeat([0, 0.75])).toBe(false);
    expect(isTernaryBeat([0, 1 / 3, 2 / 3])).toBe(true);
    // And with a note on each side of the beat, still distinct.
    expect(isTernaryBeat([0, 0.5, 0.75])).toBe(false);
  });

  it('does not read a swung pair as a triplet on two notes alone', () => {
    // Swing lands the offbeat near ⅔, which is exactly a triplet position —
    // but two notes is not enough to claim the beat is in three.
    expect(isTernaryBeat([0, 2 / 3])).toBe(false);
  });

  it('forgives a player who is slightly out', () => {
    expect(isTernaryBeat(jitter([0, 1 / 3, 2 / 3], 0.02))).toBe(true);
    expect(isTernaryBeat(jitter([0, 0.25, 0.5, 0.75], 0.02))).toBe(false);
  });

  it('refuses to guess at playing too loose to read either way', () => {
    // Halfway between every division of both kinds: no reading is evidence.
    expect(isTernaryBeat([0, 0.19, 0.42])).toBe(false);
  });

  it('says nothing about a beat with too little in it', () => {
    expect(isTernaryBeat([])).toBe(false);
    expect(isTernaryBeat([0])).toBe(false);
    expect(isTernaryBeat([1 / 3])).toBe(false);
  });

  it('reads a sextuplet as ternary', () => {
    const sixths = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
    expect(isTernaryBeat(sixths)).toBe(true);
  });

  it('does not care what order the onsets arrive in', () => {
    expect(isTernaryBeat([0, 2 / 3, 1 / 3])).toBe(true);
  });

  it('leaves a triplet with a note missing alone', () => {
    // Two onsets on thirds is a swung pair as much as a gapped triplet, and
    // there is nothing to tell them apart; binary is the safer reading.
    expect(isTernaryBeat([0, 2 / 3])).toBe(false);
  });
});

describe('against the bundled repertoire', () => {
  /** Onsets grouped per staff per beat, the way the layout will group them. */
  function ternaryBeatsIn(def: LibraryTrackDef): { ternary: number; total: number } {
    const take = buildLibraryTake(def);
    const map = createTakeTempoMap(take.tempo);
    const byBeat = new Map<string, number[]>();
    for (const note of take.notes) {
      const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
      const beat = map.beatAtMs(note.startMs);
      const whole = Math.floor(beat + 1e-9);
      const offset = beat - whole;
      const key = `${staff}|${whole}`;
      const list = byBeat.get(key) ?? [];
      if (!list.some((seen) => Math.abs(seen - offset) < 1e-6)) list.push(offset);
      byBeat.set(key, list);
    }
    let ternary = 0;
    for (const offsets of byBeat.values()) if (isTernaryBeat(offsets)) ternary += 1;
    return { ternary, total: byBeat.size };
  }

  it('finds the triplets in the one piece built on them', () => {
    // Moonlight's whole texture is triplet arpeggios, across both hands.
    const { ternary, total } = ternaryBeatsIn(MOONLIGHT_SONATA);
    expect(ternary).toBeGreaterThan(total * 0.5);
  });

  it('finds none in music that is straight', () => {
    // The cost of a false positive is a wrong rhythm on the page, so these
    // have to come back at exactly zero, not merely low.
    for (const def of [FUR_ELISE, A_BEAUTIFUL_DAY, GOOD_NIGHT, EVENING_TIDE]) {
      expect(ternaryBeatsIn(def).ternary).toBe(0);
    }
  });
});

describe('laying a tuplet out', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  /** `count` even notes filling each of `beats` beats, in one hand. */
  function evenly(count: number, beats: number, midi = 72): NoteEvent[] {
    const notes: NoteEvent[] = [];
    for (let beat = 0; beat < beats; beat += 1) {
      for (let k = 0; k < count; k += 1) {
        notes.push({
          id: `b${beat}k${k}`,
          midi,
          startMs: Math.round(beat * 500 + (k * 500) / count),
          durationMs: Math.round(400 / count),
          velocity: 0.5,
        });
      }
    }
    return notes;
  }

  it('writes triplets in one hand as beamed threes with a numeral', () => {
    const layout = layoutScore(evenly(3, 4), OPTS);
    expect(layout.chords.every((chord) => chord.symbol.tuplet)).toBe(true);
    expect(layout.chords.every((chord) => chord.symbol.base === 'eighth')).toBe(true);
    expect(layout.beams.map((beam) => [beam.members.length, beam.tupletCount])).toEqual([
      [3, 3],
      [3, 3],
      [3, 3],
      [3, 3],
    ]);
  });

  it('leaves straight sixteenths entirely alone', () => {
    const layout = layoutScore(evenly(4, 4), OPTS);
    expect(layout.chords.some((chord) => chord.symbol.tuplet)).toBe(false);
    expect(layout.beams.every((beam) => beam.tupletCount === null)).toBe(true);
  });

  it('makes a bar of triplets add up, rests and all', () => {
    // Three of the four beats played, the last silent: the rests filling it
    // have to be triplet rests too, or the bar comes out short.
    const layout = layoutScore(evenly(3, 3), OPTS);
    const written = (symbol: {
      base: string;
      dotted: boolean;
      tuplet?: { actual: number; normal: number };
    }): number => {
      const base = { whole: 96, half: 48, quarter: 24, eighth: 12, sixteenth: 6 }[symbol.base]!;
      const dotted = base * (symbol.dotted ? 1.5 : 1);
      return symbol.tuplet ? (dotted * symbol.tuplet.normal) / symbol.tuplet.actual : dotted;
    };
    const inBar = (ms: number): boolean => ms < 2000;
    const filled =
      layout.chords
        .filter((c) => c.staff === 'treble' && inBar(c.displayStartMs))
        .reduce((sum, c) => sum + written(c.symbol), 0) +
      layout.rests
        .filter((r) => r.staff === 'treble' && inBar(r.displayStartMs))
        .reduce((sum, r) => sum + written(r.symbol), 0);
    expect(filled).toBe(96); // one 4/4 bar in ninety-sixths
  });

  it('does not number a tuplet the hands have split between them', () => {
    // An arpeggio crossing middle C leaves a fragment on each staff. Two
    // thirds of a triplet numbered "2" would name a duplet — a different
    // rhythm — so a fragment carries no numeral at all.
    const notes: NoteEvent[] = [];
    for (let beat = 0; beat < 4; beat += 1) {
      for (let k = 0; k < 3; k += 1) {
        notes.push({
          id: `s${beat}${k}`,
          midi: k === 0 ? 52 : 72, // the lowest of each triplet falls to the bass
          startMs: Math.round(beat * 500 + (k * 500) / 3),
          durationMs: 130,
          velocity: 0.5,
        });
      }
    }
    const layout = layoutScore(notes, OPTS);
    // Both hands still agree the beat is in three...
    expect(layout.chords.every((chord) => chord.symbol.tuplet)).toBe(true);
    // ...but neither holds a whole one, so neither is numbered.
    expect(layout.beams.every((beam) => beam.tupletCount === null)).toBe(true);
  });
});
