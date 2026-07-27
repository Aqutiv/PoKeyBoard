import { describe, expect, it } from 'vitest';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { buildLibraryTake, type LibraryTrackDef } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { EVENING_TIDE } from '@/features/library/tracks/eveningTide';
import { FUR_ELISE } from '@/features/library/tracks/furElise';
import { GOOD_NIGHT } from '@/features/library/tracks/goodNight';
import { MOONLIGHT_SONATA } from '@/features/library/tracks/moonlightSonata';
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
