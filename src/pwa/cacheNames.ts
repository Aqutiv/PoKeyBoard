/**
 * Cache Storage names shared between the service worker's runtime caching
 * and the explicit "Download piano for offline use" flow, so both write to
 * the same store and neither duplicates sample bytes.
 */
export const PIANO_SAMPLE_CACHE = 'pokeyboard-piano-samples-v3';

/**
 * Vendored library scores. Kept apart from the samples so the two can be
 * evicted independently — a purge of ~53 MB of audio should not also throw away
 * a megabyte of scores.
 */
export const LIBRARY_SCORE_CACHE = 'pokeyboard-library-scores-v1';

/**
 * Superseded cache generations, deleted on service worker activation.
 *
 * v1 held `.mp3`-keyed entries from before the samples were renamed to
 * `.sample` (download-manager evasion). v2 held the mono 128kbps MP3 packs that
 * the stereo FLAC generation replaced.
 *
 * Both are dead weight rather than merely stale: the new packs live at new URLs,
 * so nothing evicts the old entries (two generations is 364 entries against an
 * ExpirationPlugin cap of 512), and a user who had downloaded a piano for
 * offline use would otherwise carry ~25 MB of unreachable audio forever — on a
 * device where sample bytes are exactly the eviction pressure that
 * `purgeOnQuotaError` exists to keep off their takes.
 */
export const STALE_PIANO_SAMPLE_CACHES = [
  'pokeyboard-piano-samples-v1',
  'pokeyboard-piano-samples-v2',
];
