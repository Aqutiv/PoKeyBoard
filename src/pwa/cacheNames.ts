/**
 * Cache Storage names shared between the service worker's runtime caching
 * and the explicit "Download piano for offline use" flow, so both write to
 * the same store and neither duplicates sample bytes.
 */
export const PIANO_SAMPLE_CACHE = 'pokeyboard-piano-samples-v1';
