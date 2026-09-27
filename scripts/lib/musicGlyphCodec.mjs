/**
 * The text the music-glyph outlines are stored as in
 * `src/features/notation/glyphs/musicGlyphOutlines.ts`: short, so the table
 * stays small, and trivial to read back without a parser.
 *
 * An outline is a list of commands — `m` (move), `l` (line), `c` (cubic
 * Bézier, two control points then the end point) and `z` (close) — in font
 * units (250 to the staff space), y up, measured from the glyph's SMuFL
 * origin. Every coordinate pair is an integer written as its delta from the
 * pair before it, control points included; the first pair is measured from the
 * origin, and `z` leaves the running position where the last pair put it.
 *
 * Numbers follow their command letter directly and are separated by one space,
 * or by nothing where the next one starts with its minus sign:
 *
 *   m125-250l0 30c-5 10 7-3 4 4z
 *
 * The app reads this with `decodeGlyphOutline` (glyphs/glyphOutline.ts); the
 * decoder here is the generator's own, used to check what it wrote.
 */

/** How many coordinate pairs each command carries. */
const PAIRS = { M: 1, L: 1, C: 3, Z: 0 };

function pairsOf(command) {
  switch (command.type) {
    case 'M':
    case 'L':
      return [[command.x, command.y]];
    case 'C':
      return [
        [command.x1, command.y1],
        [command.x2, command.y2],
        [command.x, command.y],
      ];
    case 'Z':
      return [];
    default:
      throw new Error(`Cannot encode a "${command.type}" command: only M, L, C and Z are allowed`);
  }
}

/** `commands` — `{ type: 'M' | 'L' | 'C' | 'Z', … }` in absolute font units — as outline text. */
export function encodeOutline(commands) {
  let text = '';
  let x = 0;
  let y = 0;
  for (const command of commands) {
    text += command.type.toLowerCase();
    let first = true;
    for (const [px, py] of pairsOf(command)) {
      if (!Number.isInteger(px) || !Number.isInteger(py)) {
        throw new Error(`Cannot encode (${px}, ${py}): outline coordinates must be integers`);
      }
      for (const value of [px - x, py - y]) {
        if (!first && value >= 0) text += ' ';
        text += String(value);
        first = false;
      }
      x = px;
      y = py;
    }
  }
  return text;
}

/** Outline text back to absolute commands, as `encodeOutline` took them. */
export function decodeOutline(text) {
  const tokens = text.match(/[mlcz]|-?\d+/g) ?? [];
  if (tokens.join('').length !== text.replace(/ /g, '').length) {
    throw new Error(`Unreadable outline text: ${JSON.stringify(text.slice(0, 40))}`);
  }
  const commands = [];
  let x = 0;
  let y = 0;
  let index = 0;
  const nextPair = () => {
    const dx = Number(tokens[index]);
    const dy = Number(tokens[index + 1]);
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
      throw new Error(`Outline text ends inside a coordinate pair at token ${index}`);
    }
    index += 2;
    x += dx;
    y += dy;
    return [x, y];
  };
  while (index < tokens.length) {
    const type = tokens[index].toUpperCase();
    index += 1;
    if (!(type in PAIRS)) throw new Error(`Expected a command letter, found "${type}"`);
    if (type === 'Z') {
      commands.push({ type });
    } else if (type === 'C') {
      const [x1, y1] = nextPair();
      const [x2, y2] = nextPair();
      const [cx, cy] = nextPair();
      commands.push({ type, x1, y1, x2, y2, x: cx, y: cy });
    } else {
      const [px, py] = nextPair();
      commands.push({ type, x: px, y: py });
    }
  }
  return commands;
}

/** The smallest box holding every point of `commands`, control points included. */
export function controlBox(commands) {
  let left = Infinity;
  let bottom = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  for (const command of commands) {
    for (const [px, py] of pairsOf(command)) {
      left = Math.min(left, px);
      right = Math.max(right, px);
      bottom = Math.min(bottom, py);
      top = Math.max(top, py);
    }
  }
  return { left, bottom, right, top };
}
