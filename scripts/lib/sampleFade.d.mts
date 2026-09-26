export const FADE_S: number;
export const END_WINDOW_S: number;
export const DITHER_FLOOR: number;
export function fadeOut(trimS: number, sourceS: number): { startS: number; lengthS: number };
export function endsFaded(
  channels: ArrayLike<number>[],
  sampleRate: number,
  fadeS: number,
): { faded: boolean; last: number; fade: number; ceiling: number };
