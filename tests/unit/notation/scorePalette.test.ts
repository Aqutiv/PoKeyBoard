import { describe, expect, it } from 'vitest';
import { SCORE_PALETTES } from '@/features/notation/scoreRenderer';

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\))$/i;

describe('score palettes', () => {
  it('dark and light expose exactly the same keys', () => {
    expect(Object.keys(SCORE_PALETTES.light).sort()).toEqual(
      Object.keys(SCORE_PALETTES.dark).sort(),
    );
  });

  it('every entry is a parseable color string', () => {
    for (const [theme, palette] of Object.entries(SCORE_PALETTES)) {
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${theme}.${key}`).toMatch(COLOR_PATTERN);
      }
    }
  });

  it('themes actually differ where it matters', () => {
    expect(SCORE_PALETTES.dark.note).not.toBe(SCORE_PALETTES.light.note);
    expect(SCORE_PALETTES.dark.gutterBg).not.toBe(SCORE_PALETTES.light.gutterBg);
  });
});
