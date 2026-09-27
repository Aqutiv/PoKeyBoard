import { describe, expect, it } from 'vitest';
import {
  GLYPH_CLOSE,
  GLYPH_CURVE,
  GLYPH_LINE,
  GLYPH_MOVE,
  GLYPH_OP_PAIRS,
  decodeGlyphOutline,
  type GlyphOp,
  type GlyphOutline,
} from '@/features/notation/glyphs/glyphOutline';
import { MUSIC_GLYPH_NAMES } from '@/features/notation/glyphs/musicGlyphMetrics';
import { MUSIC_GLYPH_OUTLINES } from '@/features/notation/glyphs/musicGlyphOutlines';
import {
  decodeOutline,
  encodeOutline,
  type OutlineCommand,
} from '../../../scripts/lib/musicGlyphCodec.mjs';

/**
 * The outline text is written by the generator's codec and read by the app's
 * decoder: both sides have to agree on every glyph.
 */

const LETTER: Record<GlyphOp, OutlineCommand['type']> = {
  [GLYPH_MOVE]: 'M',
  [GLYPH_LINE]: 'L',
  [GLYPH_CURVE]: 'C',
  [GLYPH_CLOSE]: 'Z',
};

/** The app's decoded outline, as the generator's command list. */
function commandsOf(outline: GlyphOutline): OutlineCommand[] {
  const commands: OutlineCommand[] = [];
  let p = 0;
  for (const op of outline.ops) {
    const at = (k: number): number => outline.xy[p + k]!;
    const type = LETTER[op as GlyphOp];
    if (type === 'Z') commands.push({ type });
    else if (type === 'C') {
      commands.push({ type, x1: at(0), y1: at(1), x2: at(2), y2: at(3), x: at(4), y: at(5) });
    } else commands.push({ type, x: at(0), y: at(1) });
    p += GLYPH_OP_PAIRS[op as GlyphOp] * 2;
  }
  expect(p).toBe(outline.xy.length);
  return commands;
}

const SAMPLE: OutlineCommand[] = [
  { type: 'M', x: 125, y: -250 },
  { type: 'L', x: 125, y: -220 },
  { type: 'C', x1: 120, y1: -210, x2: 127, y2: -213, x: 131, y: -209 },
  { type: 'L', x: 131, y: -209 },
  { type: 'Z' },
  { type: 'M', x: -40, y: 0 },
  { type: 'L', x: 0, y: 1000 },
  { type: 'Z' },
];

describe('the glyph outline codec', () => {
  it('writes integer deltas, each pair from the one before, as compactly as it reads', () => {
    const text = encodeOutline(SAMPLE);
    expect(text).toBe('m125-250l0 30c-5 10 7-3 4 4l0 0zm-171 209l40 1000z');
    expect(decodeOutline(text)).toEqual(SAMPLE);
    expect(commandsOf(decodeGlyphOutline(text))).toEqual(SAMPLE);
  });

  it('reads every generated glyph the same on both sides', () => {
    for (const name of MUSIC_GLYPH_NAMES) {
      const text = MUSIC_GLYPH_OUTLINES[name];
      const commands = decodeOutline(text);
      expect(encodeOutline(commands), name).toBe(text);
      expect(commandsOf(decodeGlyphOutline(text)), name).toEqual(commands);
      expect(commands[0]?.type, name).toBe('M');
      expect(commands.at(-1)?.type, name).toBe('Z');
    }
  });

  it('refuses what it cannot write', () => {
    expect(() => encodeOutline([{ type: 'M', x: 0.5, y: 0 }])).toThrow(/integer/);
    expect(() => encodeOutline([{ type: 'Q', x: 0, y: 0 } as unknown as OutlineCommand])).toThrow(
      /Q/,
    );
  });

  it('refuses text it cannot read, rather than drawing the wrong shape', () => {
    for (const bad of ['m1', 'm1 2 3', 'l', 'q1 2', '5 5', 'm1-', 'c1 2 3 4 5']) {
      expect(() => decodeGlyphOutline(bad), bad).toThrow();
    }
    expect(() => decodeGlyphOutline('m40000 0')).toThrow(RangeError);
    const empty = decodeGlyphOutline('');
    expect(empty.ops).toHaveLength(0);
    expect(empty.xy).toHaveLength(0);
  });
});
