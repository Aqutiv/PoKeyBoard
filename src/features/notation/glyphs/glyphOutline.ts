/**
 * A music glyph's outline as the app draws it: decoded once from the text the
 * generated `musicGlyphOutlines.ts` stores (the form
 * `scripts/lib/musicGlyphCodec.mjs` writes) into two typed arrays.
 *
 * `ops` holds one command per entry and `xy` the coordinate pairs they take,
 * in order — one pair for a move or a line, three for a curve (two control
 * points, then the end), none for a close. Coordinates are absolute font units,
 * y up, from the glyph's SMuFL origin: `GLYPH_UNITS_PER_SPACE` to the staff
 * space.
 */

export const GLYPH_MOVE = 0;
export const GLYPH_LINE = 1;
export const GLYPH_CURVE = 2;
export const GLYPH_CLOSE = 3;

export type GlyphOp =
  typeof GLYPH_MOVE | typeof GLYPH_LINE | typeof GLYPH_CURVE | typeof GLYPH_CLOSE;

export interface GlyphOutline {
  /** One `GlyphOp` per command. */
  readonly ops: Uint8Array;
  /** The commands' coordinate pairs, x then y, in font units, y up. */
  readonly xy: Int16Array;
}

/** Coordinate pairs each command takes, by op. */
export const GLYPH_OP_PAIRS: Readonly<Record<GlyphOp, number>> = {
  [GLYPH_MOVE]: 1,
  [GLYPH_LINE]: 1,
  [GLYPH_CURVE]: 3,
  [GLYPH_CLOSE]: 0,
};

const OPS: Readonly<Record<string, GlyphOp>> = {
  m: GLYPH_MOVE,
  l: GLYPH_LINE,
  c: GLYPH_CURVE,
  z: GLYPH_CLOSE,
};

const MINUS = 45; // '-'
const SPACE = 32; // ' '
const ZERO = 48; // '0'
const NINE = 57; // '9'

/**
 * Read outline text: command letters, each followed by its coordinate pairs as
 * integer deltas from the pair before. Throws on anything else: a glyph drawn
 * from misread text would silently be the wrong shape.
 */
export function decodeGlyphOutline(text: string): GlyphOutline {
  const ops: GlyphOp[] = [];
  const numbers: number[] = [];
  /** How many numbers the commands read so far still expect. */
  let owed = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const op = OPS[text[index]!];
    if (op !== undefined) {
      if (owed !== 0) throw new SyntaxError(`Outline text: a command cut short before ${index}`);
      ops.push(op);
      owed = GLYPH_OP_PAIRS[op] * 2;
      index += 1;
      continue;
    }
    if (code === SPACE) {
      index += 1;
      continue;
    }
    const start = index;
    if (code === MINUS) index += 1;
    const digits = index;
    while (
      index < text.length &&
      text.charCodeAt(index) >= ZERO &&
      text.charCodeAt(index) <= NINE
    ) {
      index += 1;
    }
    if (index === digits)
      throw new SyntaxError(`Outline text: unexpected "${text[start]}" at ${start}`);
    if (owed === 0) throw new SyntaxError(`Outline text: a number with no command at ${start}`);
    numbers.push(Number(text.slice(start, index)));
    owed -= 1;
  }
  if (owed !== 0) throw new SyntaxError('Outline text: it ends inside a command');

  const xy = new Int16Array(numbers.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < numbers.length; i += 2) {
    x += numbers[i]!;
    y += numbers[i + 1]!;
    if (x < -32768 || x > 32767 || y < -32768 || y > 32767) {
      throw new RangeError(`Outline text: (${x}, ${y}) is outside the font's coordinate range`);
    }
    xy[i] = x;
    xy[i + 1] = y;
  }
  return { ops: Uint8Array.from(ops), xy };
}

/** `[left, bottom, right, top]` of every point, control points included, in font units. */
export function glyphControlBox(outline: GlyphOutline): [number, number, number, number] {
  const { xy } = outline;
  if (xy.length === 0) return [0, 0, 0, 0];
  let left = Infinity;
  let bottom = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    left = Math.min(left, xy[i]!);
    right = Math.max(right, xy[i]!);
    bottom = Math.min(bottom, xy[i + 1]!);
    top = Math.max(top, xy[i + 1]!);
  }
  return [left, bottom, right, top];
}
