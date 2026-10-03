/**
 * `load`, run once and shared: the first call starts it, later ones get the
 * same promise. A failure is forgotten, so the next call tries again.
 */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    }));
}
