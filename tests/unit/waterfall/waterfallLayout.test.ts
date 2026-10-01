import { describe, expect, it } from 'vitest';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import { layoutKeyboard } from '@/features/keyboard/keyboardGeometry';
import {
  firstReaching,
  layoutWaterfall,
  MAX_LOOP_PASSES,
  MIN_BAR_PX,
  noteReach,
  STRIKE_GAP_PX,
  type WaterfallTimeline,
} from '@/features/waterfall/waterfallLayout';

let nextId = 0;
function note(
  midi: number,
  startMs: number,
  durationMs: number,
  extra: Partial<NoteEvent> = {},
): NoteEvent {
  nextId += 1;
  return { id: `n${nextId}`, midi, startMs, durationMs, velocity: 0.7, ...extra };
}

// C4–B4: seven white keys across 700 px, so a white key is 100 px wide, and
// 3000 ms over 300 px is 0.1 px per take millisecond.
const KEYS = layoutKeyboard(60, 71);
const VIEW = { widthPx: 700, heightPx: 300, keys: KEYS };

function at(nowMs: number, spanMs = 3000, loop: PlaybackLoop | null = null): WaterfallTimeline {
  return { nowMs, spanMs, loop };
}

describe('layoutWaterfall', () => {
  it('stands each bar over its key: a white key’s inset, a black key’s at its own width', () => {
    const scene = layoutWaterfall([note(60, 1000, 500), note(61, 1000, 500)], at(0), VIEW);
    const [white, black] = scene.bars;
    expect(white?.note.midi).toBe(60);
    expect(white?.black).toBe(false);
    expect(white?.x).toBeCloseTo(2);
    expect(white?.width).toBeCloseTo(96);
    // C♯ stands where the key bed puts it: centred 0.95 keys in, 0.62 wide.
    expect(black?.note.midi).toBe(61);
    expect(black?.black).toBe(true);
    expect(black?.x).toBeCloseTo(64);
    expect(black?.width).toBeCloseTo(62);
  });

  it('brings a note’s lower edge down onto the keys the moment it starts', () => {
    const ahead = layoutWaterfall([note(64, 1000, 500)], at(0), VIEW).bars[0];
    expect(ahead?.bottom).toBeCloseTo(200);
    expect(ahead?.top).toBeCloseTo(150 + STRIKE_GAP_PX);
    expect(ahead?.cutBottom).toBe(false);

    const landing = layoutWaterfall([note(64, 1000, 500)], at(1000), VIEW).bars[0];
    expect(landing?.bottom).toBeCloseTo(300);
    expect(landing?.cutBottom).toBe(false);
  });

  it('shows the take stretched at half speed: half the take time over the same height', () => {
    // At 0.5× the view shows 1500 ms of the take, so 750 ms ahead is halfway up.
    const bar = layoutWaterfall([note(64, 750, 300)], at(0, 1500), VIEW).bars[0];
    expect(bar?.bottom).toBeCloseTo(150);
  });

  it('runs a sounding note into the keys and a long one off the top, each end cut there', () => {
    const scene = layoutWaterfall([note(64, 500, 5000)], at(1000), VIEW);
    const bar = scene.bars[0];
    expect(bar?.bottom).toBe(300);
    expect(bar?.top).toBe(0);
    expect(bar?.cutBottom).toBe(true);
    expect(bar?.cutTop).toBe(true);
    expect(bar?.onset).toBe(true);
  });

  it('leaves out notes that have ended and notes beyond the top', () => {
    const scene = layoutWaterfall(
      [note(60, 0, 400), note(62, 1500, 400), note(64, 4200, 400)],
      at(1000),
      VIEW,
    );
    expect(scene.bars.map((bar) => bar.note.midi)).toEqual([62]);
  });

  it('lays white keys’ bars before black keys’, which stand over them', () => {
    const scene = layoutWaterfall(
      [note(61, 100, 300), note(60, 200, 300), note(63, 300, 300), note(64, 400, 300)],
      at(0),
      VIEW,
    );
    expect(scene.bars.map((bar) => bar.black)).toEqual([false, false, true, true]);
  });

  it('keeps the shortest note at least 2 px tall', () => {
    const bar = layoutWaterfall([note(64, 1000, 4)], at(0), VIEW).bars[0];
    expect(bar ? bar.bottom - bar.top : 0).toBeCloseTo(MIN_BAR_PX);
  });

  it('shows a note off either end of the key bed as a mark at that edge', () => {
    const scene = layoutWaterfall([note(48, 1000, 500), note(84, 1200, 500)], at(0), VIEW);
    expect(scene.bars).toEqual([]);
    expect(scene.markers.map((marker) => [marker.note.midi, marker.side])).toEqual([
      [48, 'low'],
      [84, 'high'],
    ]);
    expect(scene.markers[0]?.bottom).toBeCloseTo(200);
  });

  it('tells a written-only note from a played one, and draws a hidden one like any other', () => {
    const scene = layoutWaterfall(
      [note(60, 100, 300, { velocity: 0 }), note(62, 200, 300, { hidden: true })],
      at(0),
      VIEW,
    );
    expect(scene.bars.map((bar) => [bar.note.midi, bar.silent])).toEqual([
      [60, true],
      [62, false],
    ]);
  });

  it('gives each bar the hand that plays its note', () => {
    const scene = layoutWaterfall(
      [note(60, 100, 300), note(62, 200, 300, { staff: 'bass' })],
      at(0),
      VIEW,
    );
    expect(scene.bars.map((bar) => bar.hand)).toEqual(['right', 'left']);
  });

  it('marks where each octave starts, at its C, but not at the left edge', () => {
    const wide = { ...VIEW, keys: layoutKeyboard(48, 83) };
    // C3–B5 is 21 white keys; C4 and C5 start the second and third octaves.
    expect(layoutWaterfall([], at(0), wide).octaveXs).toEqual([(7 * 700) / 21, (14 * 700) / 21]);
  });

  it('falls notes in toward a recording’s start while it counts in', () => {
    const bar = layoutWaterfall([note(64, 0, 500)], at(-1000), VIEW).bars[0];
    expect(bar?.bottom).toBeCloseTo(200);
  });

  describe('round a loop', () => {
    const LOOP = { startMs: 1000, endMs: 2000 };

    it('cuts the take at the loop’s end and shows the passage again above it', () => {
      const notes = [note(60, 1200, 300), note(62, 1800, 600), note(64, 2100, 300)];
      const scene = layoutWaterfall(notes, at(1500, 3000, LOOP), VIEW);
      const first = scene.bars.filter((bar) => bar.pass === 0);
      // The note past the loop's end is never reached; the one across it lets go there.
      expect(first.map((bar) => bar.note.midi)).toEqual([62]);
      expect(first[0]?.top).toBeCloseTo(300 - 500 * 0.1 + STRIKE_GAP_PX);
      // Pass 1 starts again at the loop's end: C4 at 2200, D4 at 2800.
      const second = scene.bars.filter((bar) => bar.pass === 1);
      expect(second.map((bar) => [bar.note.midi, Math.round(bar.bottom)])).toEqual([
        [60, 230],
        [62, 170],
      ]);
      expect(scene.restartYs.map(Math.round)).toEqual([250, 150, 50]);
    });

    it('cuts a note held across the loop’s start at the restart line, with no onset there', () => {
      const notes = [note(60, 800, 400)];
      const scene = layoutWaterfall(notes, at(1500, 3000, LOOP), VIEW);
      const pass = scene.bars.find((bar) => bar.pass === 1);
      expect(pass?.onset).toBe(false);
      expect(pass?.bottom).toBeCloseTo(250);
    });

    it('draws no more than its cap of passes, however short the loop', () => {
      const tiny = { startMs: 0, endMs: 100 };
      const scene = layoutWaterfall([note(60, 0, 50)], at(0, 60_000, tiny), VIEW);
      expect(scene.restartYs).toHaveLength(MAX_LOOP_PASSES);
    });

    it('stops folding once the playhead is past the loop’s end', () => {
      const scene = layoutWaterfall([note(60, 2500, 300)], at(2100, 3000, LOOP), VIEW);
      expect(scene.restartYs).toEqual([]);
      expect(scene.bars.map((bar) => bar.pass)).toEqual([0]);
    });
  });
});

describe('noteReach and firstReaching', () => {
  it('find the first note still sounding, past an early note that holds on', () => {
    const notes = [note(36, 0, 120_000), note(60, 1000, 200), note(62, 2000, 200)];
    const reach = noteReach(notes);
    expect([...reach]).toEqual([120_000, 120_000, 120_000]);
    expect(firstReaching(reach, 60_000)).toBe(0);
    expect(firstReaching(reach, 130_000)).toBe(3);
  });

  it('skip notes that ended before the moment', () => {
    const reach = noteReach([note(60, 0, 100), note(62, 100, 100), note(64, 200, 100)]);
    expect(firstReaching(reach, 150)).toBe(1);
    expect(firstReaching(reach, 300)).toBe(3);
  });

  it('keep one answer per notes array', () => {
    const notes = [note(60, 0, 100)];
    expect(noteReach(notes)).toBe(noteReach(notes));
  });

  it('lay out a 20,000-note take for 600 frames well inside a frame budget', () => {
    const notes = Array.from({ length: 20_000 }, (_, i) => note(60 + (i % 12), i * 50, 120));
    const keys = layoutKeyboard(48, 83);
    const view = { widthPx: 1340, heightPx: 374, keys };
    const started = performance.now();
    let bars = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      bars += layoutWaterfall(notes, at(frame * 1000), view).bars.length;
    }
    expect(bars).toBeGreaterThan(0);
    // ~16 ms a frame at 60 Hz; this asks for well under 1 ms each.
    expect(performance.now() - started).toBeLessThan(600);
  });
});
