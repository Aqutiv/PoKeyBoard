/**
 * Cache Storage names shared between the service worker's runtime caching
 * and the explicit "Download piano for offline use" flow, so both write to
 * the same store and neither duplicates sample bytes.
 */
export const PIANO_SAMPLE_CACHE = 'pokeyboard-piano-samples-v2';

/**
 * Superseded cache generations, deleted on service worker activation.
 * v1 held `.mp3`-keyed entries from before the samples were renamed to
 * `.sample` (download-manager evasion); its entries can never match again.
 */
export const STALE_PIANO_SAMPLE_CACHES = ['pokeyboard-piano-samples-v1'];
