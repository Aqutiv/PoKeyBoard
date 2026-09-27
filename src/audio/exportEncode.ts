import { runInSlices, runToEnd, stepProgress } from '@/utils/steps';
import type { ExportEncoding } from './exportFormats';
import { encodeFlacSteps, flacFrameCount } from './flacEncode';
import { masterExport, masterExportInSlices, type ClickTrack, type LoudnessMode } from './loudness';
import { encodePcmToMp3 } from './mp3Encode';

/** A rendered take as the encoder receives it; see `RenderedTake`. */
export interface ExportPcm {
  sampleRate: number;
  /** Each channel owns its buffer, so it can be transferred to the worker. */
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  /** The metronome, or null; see `ClickTrack`. */
  clicks: ClickTrack | null;
  loudness: LoudnessMode;
}

/**
 * How much of the compress stage's bar mastering fills before the encoder
 * starts: the share of the stage it takes in desktop Chrome. For MP3, 15 to
 * 16% alike on the 11-minute Chopin Ballade, La Campanella and A Beautiful
 * Day. FLAC codes two to three times faster than LAME, and slower at 24 bits
 * than at 16, their bottom eight bits being noise to code: on those three and
 * Arabesque No. 1, mastering took 35 to 39% of the stage at 16 bits, and 21
 * to 36% at 24.
 */
export function masteringShare(encoding: ExportEncoding): number {
  if (encoding.format === 'mp3') return 0.15;
  return encoding.bits === 16 ? 0.38 : 0.28;
}

/**
 * How far the compress stage has got, mastering and then encoding, told to
 * `onProgress` in whole percents and only as they rise. Mastering a long take
 * is tens of thousands of steps, and from the worker every report is a message
 * and a render of the dialog. It starts past 0, which the export says itself.
 */
function compressProgress(share: number, onProgress?: (fraction: number) => void) {
  let percent = 0;
  const report = (fraction: number) => {
    const next = Math.round(fraction * 100);
    if (next <= percent) return;
    percent = next;
    onProgress?.(next / 100);
  };
  return {
    mastering: (fraction: number) => report(fraction * share),
    encoding: (fraction: number) => report(share + fraction * (1 - share)),
  };
}

/**
 * Everything after the render, in the worker: set the level and hold the peaks
 * (`masterExport`, in place), then encode. It runs straight through, since
 * nothing waits on a worker's thread. The file comes back in parts, each
 * owning its whole buffer, so they can be transferred as they are.
 */
export async function finishExport(
  pcm: ExportPcm,
  encoding: ExportEncoding,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>[]> {
  const progress = compressProgress(masteringShare(encoding), onProgress);
  masterExport(pcm.left, pcm.right, pcm.clicks, pcm.loudness, pcm.sampleRate, progress.mastering);
  if (encoding.format === 'mp3') {
    return [
      await encodePcmToMp3(pcm.sampleRate, encoding.kbps, pcm.left, pcm.right, progress.encoding),
    ];
  }
  const frames = stepProgress(flacFrameCount(pcm.left.length), progress.encoding);
  return runToEnd(
    frames.count(encodeFlacSteps(pcm.left, pcm.right, pcm.sampleRate, encoding.bits)),
  );
}

/**
 * The same on the main thread, for when the worker cannot run. Straight
 * through, a long take would freeze the page for seconds and leave a click on
 * Cancel waiting until it was done; so it runs a slice at a time, and a
 * cancelled export stops at the next slice. The file comes out exactly as the
 * worker's would.
 */
export async function finishExportOnMainThread(
  pcm: ExportPcm,
  encoding: ExportEncoding,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>[]> {
  const progress = compressProgress(masteringShare(encoding), onProgress);
  await masterExportInSlices(pcm.left, pcm.right, pcm.clicks, pcm.loudness, pcm.sampleRate, {
    signal,
    onProgress: progress.mastering,
  });
  if (encoding.format === 'mp3') {
    return [
      await encodePcmToMp3(
        pcm.sampleRate,
        encoding.kbps,
        pcm.left,
        pcm.right,
        progress.encoding,
        signal,
      ),
    ];
  }
  const frames = stepProgress(flacFrameCount(pcm.left.length), progress.encoding);
  return runInSlices(
    frames.count(encodeFlacSteps(pcm.left, pcm.right, pcm.sampleRate, encoding.bits)),
    { signal },
  );
}
