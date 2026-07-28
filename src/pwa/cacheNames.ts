/**
 * Cache Storage names shared between the service worker's runtime caching
 * and the explicit "Download piano for offline use" flow, so both write to
 * the same store and neither duplicates sample bytes.
 */
export const PIANO_SAMPLE_CACHE = 'pokeyboard-piano-samples-v2';

/**
 * Vendored library scores. Kept apart from the samples so the two can be
 * evicted independently — a purge of 24 MB of audio should not also throw away
 * a megabyte of scores.
 */
export const LIBRARY_SCORE_CACHE = 'pokeyboard-library-scores-v1';

/**
 * Superseded cache generations, deleted on service worker activation.
 * v1 held `.mp3`-keyed entries from before the samples were renamed to
 * `.sample` (download-manager evasion); its entries can never match again.
 */
export const STALE_PIANO_SAMPLE_CACHES = ['pokeyboard-piano-samples-v1'];
