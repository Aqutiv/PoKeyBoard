import { describe, expectTypeOf, it } from 'vitest';
import type { DrawSurface } from '@/features/notation/drawSurface';

describe('DrawSurface', () => {
  it('is satisfied by a real canvas context, so the preview can draw a sheet page', () => {
    expectTypeOf<CanvasRenderingContext2D>().toExtend<DrawSurface>();
    // The same thing as an assignment, which is how the dialog uses it.
    const asSurface = (ctx: CanvasRenderingContext2D): DrawSurface => ctx;
    expectTypeOf(asSurface).returns.toEqualTypeOf<DrawSurface>();
  });

  it('asks for no more of the canvas than the sheet draws with', () => {
    // A surface that is not a canvas has to implement every member, so the
    // interface stays exactly the subset the renderer calls.
    expectTypeOf<DrawSurface>().not.toHaveProperty('clearRect');
    expectTypeOf<DrawSurface>().not.toHaveProperty('setTransform');
    expectTypeOf<DrawSurface>().not.toHaveProperty('drawImage');
    expectTypeOf<keyof DrawSurface>().toEqualTypeOf<
      | 'fillStyle'
      | 'strokeStyle'
      | 'lineWidth'
      | 'lineCap'
      | 'font'
      | 'textAlign'
      | 'textBaseline'
      | 'save'
      | 'restore'
      | 'translate'
      | 'rotate'
      | 'scale'
      | 'beginPath'
      | 'moveTo'
      | 'lineTo'
      | 'bezierCurveTo'
      | 'quadraticCurveTo'
      | 'arc'
      | 'ellipse'
      | 'closePath'
      | 'fill'
      | 'stroke'
      | 'fillRect'
      | 'fillText'
      | 'measureText'
      | 'setLineDash'
    >();
    expectTypeOf<ReturnType<DrawSurface['measureText']>>().toEqualTypeOf<{
      readonly width: number;
    }>();
  });
});
