/**
 * xorshift32: numbers in [0, 1) that come out the same from the same seed on
 * every platform and every build — for noise that has to be the same noise
 * every time, like a reverb's impulse or an export's dither.
 */
export function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
