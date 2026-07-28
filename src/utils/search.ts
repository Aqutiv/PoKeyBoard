/**
 * Text matching for the library filter.
 *
 * Nobody types the accents: the catalog is full of Für, Prélude, Gymnopédie,
 * Ständchen and Frédéric, and a filter that only matched them exactly would
 * hide most of the repertoire from anyone using a plain keyboard.
 */

/** Lowercased and stripped of combining accents, so "fur" matches "Für". */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * True when every whitespace-separated token of `query` appears in `haystack`.
 * Order-independent, so "chopin nocturne" finds a nocturne credited to Chopin
 * even though the title comes before the composer. A single-word query is
 * therefore plain substring matching.
 *
 * An empty or whitespace-only query matches everything.
 */
export function matchesSearch(haystack: string, query: string): boolean {
  const tokens = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const folded = foldForSearch(haystack);
  return tokens.every((token) => folded.includes(token));
}
