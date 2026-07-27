import { describe, expect, it } from 'vitest';
import { FORTE_VELOCITY, readDynamics } from '@/features/notation/dynamics';

/** One bar of 4/4 at 120bpm, the tempo the other notation tests use. */
const BAR_MS = 2000;
const OPTS = { barMs: BAR_MS };

/** Notes a beat apart, at the given velocities. */
function played(velocities: number[], stepMs = 500) {
  return velocities.map((velocity, i) => ({ startMs: i * stepMs, velocity }));
}

/** Velocity for a fraction of forte, which is what the bands are cut against. */
function atForte(fraction: number): number {
  return FORTE_VELOCITY * fraction;
}

describe('readDynamics', () => {
  it('has nothing to say about silence', () => {
    expect(readDynamics([], OPTS)).toEqual({ marks: [], hairpins: [] });
  });

  it('marks a steady passage once', () => {
    // Sixteen even beats at one level: one mark, at the start, and no more.
    const reading = readDynamics(played(new Array(16).fill(atForte(0.5))), OPTS);
    expect(reading.marks).toHaveLength(1);
    expect(reading.marks[0]!.atMs).toBe(0);
    expect(reading.hairpins).toEqual([]);
  });

  it('names the band the level sits in', () => {
    const markFor = (fraction: number): string =>
      readDynamics(played(new Array(12).fill(atForte(fraction))), OPTS).marks[0]!.mark;
    expect(markFor(0.2)).toBe('ppp');
    expect(markFor(0.35)).toBe('pp');
    expect(markFor(0.5)).toBe('p');
    expect(markFor(0.65)).toBe('mp');
    expect(markFor(0.8)).toBe('mf');
    expect(markFor(1)).toBe('f');
    expect(markFor(1.2)).toBe('ff');
  });

  it('does not turn one hard note into a dynamic', () => {
    // An accent in the middle of an even passage is touch, not a change of
    // level, and smoothing is what keeps it from being written down.
    const velocities = new Array(16).fill(atForte(0.5));
    velocities[8] = atForte(1.25);
    const reading = readDynamics(played(velocities), OPTS);
    expect(reading.marks).toHaveLength(1);
  });

  it('does not flicker when the level sits on a boundary', () => {
    // Wobbling either side of the p/mp line must not write a mark each time.
    const velocities = Array.from({ length: 24 }, (_, i) => atForte(i % 2 === 0 ? 0.55 : 0.58));
    const reading = readDynamics(played(velocities), OPTS);
    expect(reading.marks).toHaveLength(1);
  });

  it('writes a real change of level', () => {
    // Eight soft bars, then eight loud ones.
    const reading = readDynamics(
      played([...new Array(16).fill(atForte(0.35)), ...new Array(16).fill(atForte(1.0))]),
      OPTS,
    );
    expect(reading.marks.map((mark) => mark.mark)).toEqual(['pp', 'f']);
    // The second mark lands where the music actually changed, not at the start.
    expect(reading.marks[1]!.atMs).toBeGreaterThan(BAR_MS * 3);
  });

  it('keeps marks at least a bar apart', () => {
    const reading = readDynamics(
      played([...new Array(16).fill(atForte(0.3)), ...new Array(16).fill(atForte(1.2))]),
      OPTS,
    );
    for (let i = 1; i < reading.marks.length; i += 1) {
      const gap = reading.marks[i]!.atMs - reading.marks[i - 1]!.atMs;
      expect(gap).toBeGreaterThanOrEqual(BAR_MS);
    }
  });

  it('never writes the dynamic already in force', () => {
    // A level that wanders off and comes back has changed nothing, and the
    // page must not say "mf" twice with nothing between.
    const velocities = Array.from({ length: 60 }, (_, i) => {
      const phase = Math.floor(i / 6) % 2;
      return atForte(phase === 0 ? 0.8 : 0.86);
    });
    const reading = readDynamics(played(velocities), OPTS);
    for (let i = 1; i < reading.marks.length; i += 1) {
      expect(reading.marks[i]!.mark).not.toBe(reading.marks[i - 1]!.mark);
    }
  });

  it('rides over the gaps where only the accompaniment sounds', () => {
    // A melody that rests every other bar leaves the left hand alone and
    // quieter. That is scoring, not a diminuendo, and it must not be marked.
    const velocities: number[] = [];
    for (let bar = 0; bar < 12; bar += 1) {
      for (let beat = 0; beat < 4; beat += 1) {
        velocities.push(atForte(bar % 2 === 0 ? 0.85 : 0.5));
      }
    }
    const reading = readDynamics(played(velocities), OPTS);
    expect(reading.marks.length).toBeLessThanOrEqual(2);
    expect(reading.hairpins).toEqual([]);
  });

  it('writes a long swell as a hairpin, not a row of marks', () => {
    // Forty beats climbing steadily from pp to ff.
    const velocities = Array.from({ length: 40 }, (_, i) => atForte(0.3 + (i / 39) * 1.0));
    const reading = readDynamics(played(velocities), OPTS);
    expect(reading.hairpins).toHaveLength(1);
    const hairpin = reading.hairpins[0]!;
    expect(hairpin.grow).toBe(true);
    expect(hairpin.toMs).toBeGreaterThan(hairpin.fromMs);
    // A hairpin says "get louder", never how loud to arrive — so the marks at
    // each end stay, and the ones it swallowed do not.
    expect(reading.marks).toHaveLength(2);
    expect(reading.marks[0]!.atMs).toBe(hairpin.fromMs);
    expect(reading.marks[1]!.atMs).toBe(hairpin.toMs);
  });

  it('writes a fall as a diminuendo', () => {
    const velocities = Array.from({ length: 40 }, (_, i) => atForte(1.3 - (i / 39) * 1.0));
    const reading = readDynamics(played(velocities), OPTS);
    expect(reading.hairpins).toHaveLength(1);
    expect(reading.hairpins[0]!.grow).toBe(false);
  });

  it('leaves a single step as a plain mark', () => {
    // One band up is a change of dynamic, not a swell.
    const reading = readDynamics(
      played([...new Array(16).fill(atForte(0.5)), ...new Array(16).fill(atForte(0.65))]),
      OPTS,
    );
    expect(reading.hairpins).toEqual([]);
    expect(reading.marks).toHaveLength(2);
  });

  it('will not draw a hairpin too short to read', () => {
    // The same climb crammed into a beat and a half: the level moved, but
    // there is nowhere to put a wedge.
    const velocities = Array.from({ length: 40 }, (_, i) => atForte(0.3 + (i / 39) * 1.0));
    const reading = readDynamics(
      velocities.map((velocity, i) => ({ startMs: i * 10, velocity })),
      OPTS,
    );
    expect(reading.hairpins).toEqual([]);
  });

  it('reads the loudest note of a chord, not the average of it', () => {
    // A melody over a soft accompaniment is as loud as the melody; averaging
    // would flatten every piece written that way.
    const withAccompaniment = readDynamics(
      new Array(12).fill(0).flatMap((_, i) => [
        { startMs: i * 500, velocity: atForte(1.0) },
        { startMs: i * 500, velocity: atForte(0.2) },
        { startMs: i * 500, velocity: atForte(0.2) },
      ]),
      OPTS,
    );
    expect(withAccompaniment.marks[0]!.mark).toBe('f');
  });
});
