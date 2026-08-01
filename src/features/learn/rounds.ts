/**
 * Deterministic round order, shared by the quiz and the drill.
 *
 * Rounds are chosen by walking the pool with a stride rather than at random:
 * every entry gets asked before any repeats, the e2e can assert exact answers,
 * and repeating a chapter repeats the lesson instead of rerolling it.
 */

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * How far to step through the pool between rounds.
 *
 * Asking in plain order would put the answer to round *n* on button *n*, so a
 * whole quiz could be passed left-to-right without looking at the keyboard. A
 * stride coprime with the pool size scatters the questions while still
 * visiting every entry before repeating.
 *
 * Prefers 3, then 2, then keeps searching upward. The search matters: a pool
 * of 12 shares a factor with both 3 and 2, and giving up there would fall back
 * to a stride of 1 — the plain order this whole mechanism exists to avoid.
 */
export function strideFor(size: number): number {
  if (size <= 2) return 1;
  for (const stride of [3, 2]) if (gcd(stride, size) === 1) return stride;
  for (let stride = 4; stride < size; stride += 1) {
    if (gcd(stride, size) === 1) return stride;
  }
  return 1;
}

/** The pool entry round `round` asks about. */
export function roundEntryAt<T>(pool: readonly T[], round: number): T | undefined {
  if (pool.length === 0) return undefined;
  return pool[(round * strideFor(pool.length)) % pool.length];
}
