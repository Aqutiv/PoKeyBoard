import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutKeyboard } from '@/features/keyboard/keyboardGeometry';
import { layoutWaterfall, type WaterfallScene } from '@/features/waterfall/waterfallLayout';
import { paintWaterfall, type WaterfallSurface } from '@/features/waterfall/waterfallPainter';
import { barColour, WATERFALL_PALETTES } from '@/features/waterfall/waterfallPalette';

interface Op {
  op: string;
  args: unknown[];
  fill: string;
  stroke: string;
  dash: number[];
}

/** A 2D context stand-in that records what is drawn, in what colour. */
function recorder(): { surface: WaterfallSurface; ops: Op[] } {
  const ops: Op[] = [];
  let state = { fillStyle: '', strokeStyle: '', lineWidth: 1, dash: [] as number[] };
  const stack: (typeof state)[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      ops.push({ op, args, fill: state.fillStyle, stroke: state.strokeStyle, dash: state.dash });
    };
  const surface = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    setLineDash: (dash: number[]) => {
      state.dash = dash;
    },
    save: () => {
      stack.push({ ...state });
    },
    restore: () => {
      state = stack.pop() ?? state;
    },
    fillRect: record('fillRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arcTo: record('arcTo'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
  };
  return { surface: surface as unknown as WaterfallSurface, ops };
}

let nextId = 0;
function note(midi: number, startMs: number, extra: Partial<NoteEvent> = {}): NoteEvent {
  nextId += 1;
  return { id: `p${nextId}`, midi, startMs, durationMs: 400, velocity: 0.7, ...extra };
}

const KEYS = layoutKeyboard(48, 71); // C3–B4: C4 starts the second octave
const PALETTE = WATERFALL_PALETTES.dark;
const PAINT = { widthPx: 1400, heightPx: 300, palette: PALETTE, followsVelocity: true };

function sceneOf(notes: NoteEvent[], loop = null as { startMs: number; endMs: number } | null) {
  return layoutWaterfall(
    notes,
    { nowMs: 0, spanMs: 3000, loop },
    { widthPx: 1400, heightPx: 300, keys: KEYS },
  );
}

function paint(scene: WaterfallScene, followsVelocity = true): Op[] {
  const { surface, ops } = recorder();
  paintWaterfall(surface, scene, { ...PAINT, followsVelocity });
  return ops;
}

describe('paintWaterfall', () => {
  it('fills the whole stage in the key bed’s colour first', () => {
    const ops = paint(sceneOf([]));
    expect(ops[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 1400, 300], fill: PALETTE.stage });
  });

  it('draws a faint guide where each octave starts', () => {
    const guides = paint(sceneOf([])).filter(
      (op) => op.op === 'fillRect' && op.fill === PALETTE.guide,
    );
    // C4 starts the second octave of C3–B4: 7 of 14 white keys across.
    expect(guides.map((op) => op.args)).toEqual([[700, 0, 1, 300]]);
  });

  it('fills each bar with its key’s colour at its note’s velocity, outlined in its hand’s edge', () => {
    const notes = [
      note(60, 500, { velocity: 0.2 }),
      note(62, 600, { velocity: 0.9, staff: 'bass' }),
      note(61, 700, { velocity: 0.5 }),
    ];
    const ops = paint(sceneOf(notes));
    expect(ops.filter((op) => op.op === 'fill').map((op) => op.fill)).toEqual([
      barColour(PALETTE, 'right', false, 0.2, true),
      barColour(PALETTE, 'left', false, 0.9, true),
      barColour(PALETTE, 'right', true, 0.5, true),
    ]);
    expect(ops.filter((op) => op.op === 'stroke').map((op) => op.stroke)).toEqual([
      PALETTE.right.edge,
      PALETTE.left.edge,
      PALETTE.right.edge,
    ]);
  });

  it('lights every bar alike when the shading does not follow velocity', () => {
    const notes = [note(60, 500, { velocity: 0.2 }), note(64, 600, { velocity: 0.9 })];
    const fills = paint(sceneOf(notes), false)
      .filter((op) => op.op === 'fill')
      .map((op) => op.fill);
    expect(new Set(fills).size).toBe(1);
  });

  it('draws a written-only note hollow, before the bars that are played', () => {
    const ops = paint(sceneOf([note(64, 500), note(60, 600, { velocity: 0 })]));
    const drawn = ops.filter((op) => op.op === 'fill' || op.op === 'stroke');
    // The hollow C is outlined only, and first; the E is filled and outlined.
    expect(drawn.map((op) => [op.op, op.op === 'fill' ? op.fill : op.stroke])).toEqual([
      ['stroke', PALETTE.right.edge],
      ['fill', barColour(PALETTE, 'right', false, 0.7, true)],
      ['stroke', PALETTE.right.edge],
    ]);
  });

  it('rounds a bar’s ends only where they are the note’s own', () => {
    const arcsOf = (scene: WaterfallScene) => paint(scene).filter((op) => op.op === 'arcTo').length;
    // Free in the air: four rounded corners on the fill, four on the outline.
    expect(arcsOf(sceneOf([note(64, 500)]))).toBe(8);
    // Sounding: the lower end runs into the keys, square.
    const sounding = layoutWaterfall(
      [note(64, 0, { durationMs: 1000 })],
      { nowMs: 500, spanMs: 3000, loop: null },
      { widthPx: 1400, heightPx: 300, keys: KEYS },
    );
    expect(arcsOf(sounding)).toBe(4);
  });

  it('marks a note off the key bed with a strip at that edge and a chevron', () => {
    const ops = paint(sceneOf([note(36, 500), note(84, 500, { durationMs: 40 })]));
    const strips = ops.filter((op) => op.op === 'fillRect' && op.args[2] === 4);
    expect(strips.map((op) => op.args[0])).toEqual([0, 1396]);
    // The long one has room for a chevron, the 4 px one does not.
    expect(ops.filter((op) => op.op === 'fill')).toHaveLength(1);
  });

  it('dashes a line where a looped passage starts again', () => {
    const scene = sceneOf([note(60, 100)], { startMs: 0, endMs: 1000 });
    const strokes = paint(scene).filter((op) => op.op === 'stroke' && op.dash.length > 0);
    expect(strokes.map((op) => op.stroke)).toEqual([PALETTE.restart, PALETTE.restart]);
  });

  it('paints the stage, guides and restart lines under the bars, and edge marks over them', () => {
    const scene = sceneOf([note(36, 200), note(60, 300, { velocity: 0 }), note(64, 400)], {
      startMs: 0,
      endMs: 2000,
    });
    const ops = paint(scene);
    const first = (match: (op: Op) => boolean) => ops.findIndex(match);
    const isBarInk = (op: Op) => (op.op === 'fill' || op.op === 'stroke') && op.dash.length === 0;
    const stage = first((op) => op.op === 'fillRect' && op.fill === PALETTE.stage);
    const guide = first((op) => op.op === 'fillRect' && op.fill === PALETTE.guide);
    const restart = first((op) => op.op === 'stroke' && op.dash.length > 0);
    const bar = first(isBarInk);
    const marker = first((op) => op.op === 'fillRect' && op.args[2] === 4);
    // Bars are outlined and marks never are, so the last outline is the last bar.
    const lastOutline = ops
      .map((op) => op.op === 'stroke' && op.dash.length === 0)
      .lastIndexOf(true);
    expect(stage).toBe(0);
    expect(guide).toBeGreaterThan(stage);
    expect(restart).toBeGreaterThan(guide);
    expect(bar).toBeGreaterThan(restart);
    expect(marker).toBeGreaterThan(lastOutline);
  });
});
