import { ACCIDENTAL_GLYPHS } from './glyphs/engravingGlyphs';
import { MUSIC_GLYPH_METRICS } from './glyphs/musicGlyphMetrics';
import type { AccidentalKind } from './keySignature';

/**
 * Which column before a chord each of its accidentals stands in, from the
 * music font's own glyph boxes.
 *
 * Two accidentals share a column only where their ink cannot meet: the lower
 * one's top and the upper one's bottom have to fit between the lines they
 * stand on. How much room that takes depends on both of them — a sharp over a
 * sharp needs six steps, a flat under a sharp seven (the flat's stem rises
 * nearly two spaces, the sharp hangs a space and a half), two flats only five,
 * two double sharps three — which is why one step count for every pair cannot
 * be right.
 */

/** A note as the stacking sees it: where it sits, what it carries, and the column it gets. */
export interface StackedAccidental {
  step: number;
  accidental: AccidentalKind | null;
  /** Set here: 0 is nearest the heads. */
  accidentalColumn: number;
}

/**
 * How many column slots an accidental fills. A double flat is wider than a
 * column, so it takes two, and nothing else may stand in either beside it.
 */
export function accidentalSlots(kind: AccidentalKind): 1 | 2 {
  return kind === 'bb' ? 2 : 1;
}

/** How far a glyph reaches above and below the line it stands on, in staff spaces. */
function reachOf(kind: AccidentalKind): { above: number; below: number } {
  const [, bottom, , top] = MUSIC_GLYPH_METRICS[ACCIDENTAL_GLYPHS[kind]].bbox;
  return { above: top, below: -bottom };
}

interface Placed {
  step: number;
  kind: AccidentalKind;
}

/** Whether `lower` can stand in the same column as `upper`, below it, without touching. */
function clears(upper: Placed, lower: Placed): boolean {
  const between = (upper.step - lower.step) / 2;
  return between >= reachOf(lower.kind).above + reachOf(upper.kind).below;
}

/**
 * Give each note that carries an accidental its column, working down from the
 * top: the highest stands nearest the chord, and each one after it takes the
 * nearest column whose lowest accidental so far it clears. Only that lowest
 * one can be in the way: anything above it in the column cleared it, and so
 * ends higher still.
 */
export function assignAccidentalColumns(notes: readonly StackedAccidental[]): void {
  const marked = notes.filter((note) => note.accidental !== null).sort((a, b) => b.step - a.step);
  /** The lowest accidental placed so far in each column slot. */
  const lowest: (Placed | undefined)[] = [];
  for (const note of marked) {
    const placed: Placed = { step: note.step, kind: note.accidental! };
    const slots = accidentalSlots(placed.kind);
    const fits = (column: number): boolean => {
      for (let slot = column; slot < column + slots; slot += 1) {
        const upper = lowest[slot];
        if (upper && !clears(upper, placed)) return false;
      }
      return true;
    };
    let column = 0;
    while (!fits(column)) column += 1;
    for (let slot = column; slot < column + slots; slot += 1) lowest[slot] = placed;
    note.accidentalColumn = column;
  }
}
