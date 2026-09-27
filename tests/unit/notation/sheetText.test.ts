import { describe, expect, it } from 'vitest';
import type { DrawSurface } from '@/features/notation/drawSurface';
import { metricsFor, type SheetPage } from '@/features/notation/sheetLayout';
import { drawSheetPage } from '@/features/notation/sheetRenderer';
import {
  accidentalRunWidth,
  ellipsizeRich,
  fillRich,
  measureRich,
  splitRich,
} from '@/features/notation/sheetText';

/** Width the fake gives every UTF-16 code unit, so surrogate pairs count double. */
const UNIT_W = 5;

interface TextCall {
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
}

/**
 * A surface that records what is drawn. Text measures `UNIT_W` per code unit;
 * path points are kept so an accidental's ink can be located.
 */
class RecordingSurface implements DrawSurface {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  font = '10px serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  texts: TextCall[] = [];
  /** On-curve path points, in call order: move/line targets and curve ends. */
  points: { x: number; y: number }[] = [];
  paints = 0;
  private saved: { textAlign: CanvasTextAlign; lineWidth: number }[] = [];

  save(): void {
    this.saved.push({ textAlign: this.textAlign, lineWidth: this.lineWidth });
  }
  restore(): void {
    const state = this.saved.pop();
    if (state) Object.assign(this, state);
  }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  moveTo(x: number, y: number): void {
    this.points.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.points.push({ x, y });
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number): void {
    this.points.push({ x, y });
  }
  quadraticCurveTo(_a: number, _b: number, x: number, y: number): void {
    this.points.push({ x, y });
  }
  arc(x: number, y: number): void {
    this.points.push({ x, y });
  }
  ellipse(x: number, y: number): void {
    this.points.push({ x, y });
  }
  closePath(): void {}
  fill(): void {
    this.paints += 1;
  }
  stroke(): void {
    this.paints += 1;
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.points.push({ x, y }, { x: x + w, y: y + h });
    this.paints += 1;
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, align: this.textAlign });
  }
  measureText(text: string): { readonly width: number } {
    return { width: text.length * UNIT_W };
  }
  setLineDash(): void {}
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe('splitRich', () => {
  it('splits the accidental signs out of a title', () => {
    expect(splitRich('Golden Study in B♭ — “8va”')).toEqual([
      { kind: 'text', text: 'Golden Study in B' },
      { kind: 'accidental', accidental: 'b' },
      { kind: 'text', text: ' — “8va”' },
    ]);
    expect(splitRich('F𝄪 and B𝄫, C♯ D♮')).toEqual([
      { kind: 'text', text: 'F' },
      { kind: 'accidental', accidental: 'x' },
      { kind: 'text', text: ' and B' },
      { kind: 'accidental', accidental: 'bb' },
      { kind: 'text', text: ', C' },
      { kind: 'accidental', accidental: '#' },
      { kind: 'text', text: ' D' },
      { kind: 'accidental', accidental: 'natural' },
    ]);
  });

  it('leaves plain text whole, and nothing as nothing', () => {
    expect(splitRich('Moonlight Sonata')).toEqual([{ kind: 'text', text: 'Moonlight Sonata' }]);
    expect(splitRich('')).toEqual([]);
  });

  it('drops a presentation selector riding on a sign it replaces', () => {
    expect(splitRich('E♭\ufe0f major')).toEqual([
      { kind: 'text', text: 'E' },
      { kind: 'accidental', accidental: 'b' },
      { kind: 'text', text: ' major' },
    ]);
  });
});

describe('measureRich', () => {
  it('adds the text runs as measured to the accidentals as drawn', () => {
    const surface = new RecordingSurface();
    expect(measureRich(surface, 'B♭ minor', 20)).toBeCloseTo(
      UNIT_W + accidentalRunWidth('b', 20) + ' minor'.length * UNIT_W,
      10,
    );
    expect(measureRich(surface, 'no signs', 20)).toBe('no signs'.length * UNIT_W);
  });

  it('sizes each accidental from the font, a sharp wider than a flat', () => {
    for (const kind of ['#', 'b', 'natural', 'x', 'bb'] as const) {
      expect(accidentalRunWidth(kind, 20)).toBeGreaterThan(0);
      expect(accidentalRunWidth(kind, 40)).toBeCloseTo(2 * accidentalRunWidth(kind, 20), 10);
    }
    expect(accidentalRunWidth('#', 20)).toBeGreaterThan(accidentalRunWidth('b', 20));
    expect(accidentalRunWidth('bb', 20)).toBeGreaterThan(accidentalRunWidth('b', 20));
  });
});

describe('fillRich', () => {
  it('lays the runs out left to right from where the alignment puts the whole', () => {
    const surface = new RecordingSurface();
    surface.textAlign = 'center';
    const text = 'Nocturne in E♭ major';
    const fontPx = 21;
    const width = measureRich(surface, text, fontPx);
    fillRich(surface, text, 300, 100, fontPx);

    const start = 300 - width / 2;
    expect(surface.texts).toEqual([
      { text: 'Nocturne in E', x: start, y: 100, align: 'left' },
      {
        text: ' major',
        x: start + 'Nocturne in E'.length * UNIT_W + accidentalRunWidth('b', fontPx),
        y: 100,
        align: 'left',
      },
    ]);
    // The alignment the caller set is back.
    expect(surface.textAlign).toBe('center');

    // The flat is drawn between the two runs, sitting on the baseline.
    const signLeft = start + 'Nocturne in E'.length * UNIT_W;
    const signRight = signLeft + accidentalRunWidth('b', fontPx);
    expect(surface.points.length).toBeGreaterThan(0);
    for (const point of surface.points) {
      expect(point.x).toBeGreaterThan(signLeft);
      expect(point.x).toBeLessThan(signRight);
      expect(point.y).toBeLessThanOrEqual(100 + 1e-9);
    }
    expect(Math.max(...surface.points.map((p) => p.y))).toBeCloseTo(100, 10);
    expect(surface.paints).toBeGreaterThan(0);
  });

  it('keeps right and start alignment and leaves the line width alone', () => {
    const surface = new RecordingSurface();
    surface.lineWidth = 3;
    surface.textAlign = 'right';
    fillRich(surface, 'C♯', 200, 50, 10);
    expect(surface.texts[0]!.x).toBeCloseTo(200 - measureRich(surface, 'C♯', 10), 10);
    expect(surface.textAlign).toBe('right');
    expect(surface.lineWidth).toBe(3);

    const plain = new RecordingSurface();
    fillRich(plain, 'Gymnopédie', 40, 50, 10);
    expect(plain.texts).toEqual([{ text: 'Gymnopédie', x: 40, y: 50, align: 'left' }]);
    expect(plain.textAlign).toBe('start');
  });
});

describe('ellipsizeRich', () => {
  const surface = new RecordingSurface();
  const ellipsis = '…'.length * UNIT_W;

  it('leaves a title that fits alone', () => {
    expect(ellipsizeRich(surface, 'Short', 100, 10)).toBe('Short');
  });

  it('cuts between whole emoji, never through a surrogate pair', () => {
    const text = '😀😀😀😀😀';
    // Room for two emoji (four code units) and the ellipsis, not three.
    const out = ellipsizeRich(surface, text, 4 * UNIT_W + ellipsis, 10);
    expect(out).toBe('😀😀…');
    expect(out).not.toMatch(LONE_SURROGATE);
  });

  it('keeps a joined emoji sequence whole', () => {
    const family = '👨\u200d👩\u200d👧';
    const out = ellipsizeRich(surface, `${family}${family}${family}`, 10 * UNIT_W, 10);
    expect(out).toBe(`${family}…`);
    expect(out).not.toMatch(LONE_SURROGATE);
  });

  it('cuts around an accidental rather than through it', () => {
    const text = 'B𝄫 B𝄫 B𝄫 B𝄫';
    for (let max = 5; max < measureRich(surface, text, 20); max += 3) {
      const out = ellipsizeRich(surface, text, max, 20);
      expect(out).not.toMatch(LONE_SURROGATE);
      expect(out.endsWith('…')).toBe(true);
    }
    const flat = ellipsizeRich(surface, 'Sonata in B♭ minor, Op. 35', 60, 20);
    expect(flat).not.toMatch(LONE_SURROGATE);
    expect(measureRich(surface, flat, 20)).toBeLessThanOrEqual(60);
  });

  it('keeps at least one character', () => {
    expect(ellipsizeRich(surface, '😀😀😀', 1, 10)).toBe('😀…');
  });
});

describe('the sheet title', () => {
  it('draws its accidentals as glyphs and not as text', () => {
    const metrics = metricsFor('a4');
    const page: SheetPage = {
      pageNumber: 1,
      metrics,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: 0,
      titleBlock: {
        title: 'Nocturne in E♭ major',
        subtitle: 'After F𝄪 and B𝄫',
        bpm: 60,
        credit: 'PoKeyBoard',
      },
      systems: [],
    };
    const surface = new RecordingSurface();
    drawSheetPage(surface, page);
    const drawn = surface.texts.map((call) => call.text).join('|');
    expect(drawn).toContain('Nocturne in E');
    expect(drawn).toContain(' major');
    expect(drawn).not.toMatch(/[♭♯♮𝄪𝄫]/u);
  });
});
