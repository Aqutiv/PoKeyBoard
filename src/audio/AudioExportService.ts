import { getCachedAudio, invalidateCachedAudio, putCachedAudio } from '@/data/audioCacheRepository';
import { persistenceService } from '@/data/persistence';
import { useTakeStore } from '@/state/useTakeStore';
import { computeExportHash } from '@/domain/takeHash';
import type { Take } from '@/domain/takeTypes';
import { libraryTrackSummary } from '@/features/library/catalog';
import { ExportError } from '@/utils/errors';
import { takeAudioFileName } from '@/utils/filenames';
import type { EncodeRequest, EncoderResponse } from '@/workers/audioEncoder.worker';
import { audioEngine } from './AudioEngine';
import { finishExportOnMainThread, type ExportPcm } from './exportEncode';
import {
  FORMAT_EXTENSION,
  FORMAT_MIME_TYPE,
  type ExportEncoding,
  type ExportFormat,
} from './exportFormats';
import { readFlacStreamInfo } from './flacEncode';
import { tagFlac } from './flacTags';
import { id3v2Tag, type AudioTags } from './id3';
import { instrumentForPackVersion } from './instruments';
import type { LoudnessMode } from './loudness';
import { renderTakeForExport, type RenderedTake } from './OfflineTakeRenderer';
import { effectivePlaybackDurationMs } from '@/features/transport/sustainPedal';

/**
 * Part of every cached MP3's key: bump it whenever rendering itself changes,
 * so a cached file made the old way is rendered again. 3: voices start at the
 * sample's onset, re-struck keys damp their string, the top octaves ring on.
 * 4: level set by loudness and held by a true-peak limiter, not by the live
 * graph's compressor. 5: voices made as the render reaches them rather than
 * all before it starts — the same voices, rendered in seconds, not minutes.
 * 6: every recording of the grands calibrated to one velocity curve, so notes
 * play at new levels. 7: of two copies of a key struck together the louder is
 * heard, whatever order they were stored in, and a velocity-0 note is silent.
 * 8: the reverb rebuilt as rooms — pre-delay, early reflections, a tail whose
 * treble dies first, normalised by the app rather than the browser — rendered
 * in the take's own room, with a longer room's tail given time to ring out.
 * 9: a grand's tone follows the touch through each velocity layer, a lowpass
 * per voice, so notes play brighter or darker than they did.
 */
export const AUDIO_EXPORTER_VERSION = 9;

export interface ExportOptions {
  encoding: ExportEncoding;
  includeMetronome: boolean;
  metronomeVolume: number;
  loudness: LoudnessMode;
  /**
   * The Tone follows touch setting, taken once for the export so its hash and
   * its render agree.
   */
  toneFollowsTouch: boolean;
}

export type ExportStage = 'saving' | 'rendering' | 'encoding';

export interface ExportProgress {
  stage: ExportStage;
  /**
   * 0..1, or -1 while the stage cannot tell how far it has got: saving, and
   * rendering until its first pause (throughout, where an offline render cannot
   * pause; see `scheduleVoicesAhead`).
   */
  fraction: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  format: ExportFormat;
  durationMs: number;
  sizeBytes: number;
  fromCache: boolean;
  /** Whether the take's export cache now holds this file; only MP3s are kept. */
  cached: boolean;
}

export class ExportCancelledError extends ExportError {
  constructor() {
    super('Export cancelled', 'Export cancelled.', 'exportCancelled');
  }
}

interface ActiveExportJob {
  cancelled: boolean;
  controller: AbortController;
  cancellation: Promise<never>;
  rejectCancellation: ((error: ExportCancelledError) => void) | null;
  worker: Worker | null;
  rejectWorker: ((error: ExportCancelledError) => void) | null;
}

/**
 * The full export pipeline: snapshot+save → offline render → worker mastering
 * and encode (MP3 or FLAC) → validate → tag. An MP3 is cached under a
 * deterministic hash and reused only while the hash still matches; the cache
 * holds the bare MP3 and the tag is written on the way out, so a renamed take
 * never carries its old title. A FLAC is several times the size and renders
 * again in seconds, so it is never cached — and never takes the place of the
 * take's cached MP3, the cache holding one file a take.
 */
class AudioExportService {
  private activeJob: ActiveExportJob | null = null;

  async exportTake(
    requested: Take,
    options: ExportOptions,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> {
    if (this.activeJob) {
      throw new ExportError(
        'An audio export is already running',
        'Wait for the current export to finish or cancel it first.',
        'exportFailed',
      );
    }
    const job = this.createJob();
    this.activeJob = job;
    // Heard only while this export is the one under way: a cancelled render
    // still runs to its end, and its pauses would go on reporting onto the bar
    // of whatever export comes next.
    const report = (progress: ExportProgress) => {
      if (!job.cancelled && this.activeJob === job) onProgress(progress);
    };
    try {
      // A piano chosen a moment ago may still be decoding while the previous
      // one plays on. The export is rendered, named, tagged and cached as one
      // piano, so wait for it to settle; then read the open take again, whose
      // stamp follows the choice — back to the piano that plays on, if the new
      // one could not be loaded. `requested` was read before that happened.
      await this.awaitJob(job, audioEngine.whenSwitchSettled());
      const open = useTakeStore.getState().take;
      const take = open.id === requested.id ? open : requested;
      const { encoding } = options;
      const { format } = encoding;
      // Every export names the piano it was rendered with; a library track is
      // credited to its composer as well.
      const composer = libraryTrackSummary(take.id)?.composer;
      const piano = instrumentForPackVersion(take.samplePackVersion).name;
      const fileName = takeAudioFileName(take.title, {
        composer,
        piano,
        extension: FORMAT_EXTENSION[format],
      });
      const tags: AudioTags = {
        title: take.title,
        artist: composer,
        composer,
        album: 'PoKeyBoard',
        encodedWith: `PoKeyBoard (${piano})`,
      };
      const tagged = (bare: Blob) =>
        format === 'mp3'
          ? new Blob([id3v2Tag(tags), bare], { type: FORMAT_MIME_TYPE.mp3 })
          : tagFlac(bare, tags);
      const result = (blob: Blob, fromCache: boolean): ExportResult => ({
        blob,
        fileName,
        format,
        durationMs: effectivePlaybackDurationMs(take),
        sizeBytes: blob.size,
        fromCache,
        cached: format === 'mp3',
      });

      const hash =
        encoding.format === 'mp3'
          ? await this.awaitJob(
              job,
              computeExportHash({
                take,
                exporterVersion: AUDIO_EXPORTER_VERSION,
                bitrateKbps: encoding.kbps,
                includeMetronome: options.includeMetronome,
                metronomeVolume: options.metronomeVolume,
                loudness: options.loudness,
                toneFollowsTouch: options.toneFollowsTouch,
              }),
            )
          : null;
      if (hash !== null) {
        const cached = await this.awaitJob(job, getCachedAudio(take.id));
        if (cached && cached.hash === hash) return result(tagged(cached.blob), true);
      }

      report({ stage: 'saving', fraction: -1 });
      await this.awaitJob(job, persistenceService.flushSaveOrThrow());

      report({ stage: 'rendering', fraction: -1 });
      const rendered = await this.awaitJob(
        job,
        renderTakeForExport(
          take,
          {
            includeMetronome: options.includeMetronome,
            metronomeVolume: options.metronomeVolume,
            toneFollowsTouch: options.toneFollowsTouch,
          },
          (fraction) => report({ stage: 'rendering', fraction }),
        ),
      );
      // The render's last pause can fall up to a stretch short of its end, and a
      // render that cannot pause says nothing at all: done is done.
      report({ stage: 'rendering', fraction: 1 });

      report({ stage: 'encoding', fraction: 0 });
      // One bar however many tries it takes: where the worker fails, the main
      // thread masters over again, and its first percents must not pull the bar
      // back from where the worker left it.
      let compressed = 0;
      const parts = await this.awaitJob(
        job,
        this.encode(job, rendered, options.loudness, encoding, (fraction) => {
          if (fraction <= compressed) return;
          compressed = fraction;
          report({ stage: 'encoding', fraction });
        }),
      );

      const bare = new Blob(parts, { type: FORMAT_MIME_TYPE[format] });
      checkEncoded(encoding, parts, bare.size, rendered);

      if (hash !== null) {
        await this.awaitJob(
          job,
          putCachedAudio({
            takeId: take.id,
            hash,
            blob: bare,
            mimeType: FORMAT_MIME_TYPE.mp3,
            fileName,
            createdAt: new Date().toISOString(),
          }),
        );
      }
      return result(tagged(bare), false);
    } finally {
      if (this.activeJob === job) this.activeJob = null;
      job.rejectCancellation = null;
      job.rejectWorker = null;
      job.worker?.terminate();
      job.worker = null;
    }
  }

  cancel(): void {
    const job = this.activeJob;
    if (!job || job.cancelled) return;
    job.cancelled = true;
    job.controller.abort();
    const error = new ExportCancelledError();
    const rejectCancellation = job.rejectCancellation;
    job.rejectCancellation = null;
    rejectCancellation?.(error);
    const rejectWorker = job.rejectWorker;
    job.rejectWorker = null;
    rejectWorker?.(error);
    job.worker?.terminate();
    job.worker = null;
  }

  async deleteCachedExport(takeId: string): Promise<void> {
    await invalidateCachedAudio(takeId);
  }

  private createJob(): ActiveExportJob {
    let rejectCancellation: ((error: ExportCancelledError) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    return {
      cancelled: false,
      controller: new AbortController(),
      cancellation,
      rejectCancellation,
      worker: null,
      rejectWorker: null,
    };
  }

  private async awaitJob<T>(job: ActiveExportJob, operation: Promise<T>): Promise<T> {
    if (job.cancelled) throw new ExportCancelledError();
    return Promise.race([operation, job.cancellation]);
  }

  /**
   * Master and encode the rendered take. The Web Worker is the fast path (keeps
   * the UI responsive); if it can't be constructed, crashes, or errors — which
   * happens when a background/suspended tab kills the worker mid-compile, or on
   * browsers with flaky module-worker support — we fall back to the main
   * thread, where the same mastering and encoder run a slice at a time. The
   * worker is an optimization, not a requirement, so export never dies just
   * because the worker did.
   */
  private async encode(
    job: ActiveExportJob,
    rendered: RenderedTake,
    loudness: LoudnessMode,
    encoding: ExportEncoding,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer[]> {
    try {
      return await this.encodeViaWorker(job, rendered, loudness, encoding, onFraction);
    } catch (workerError) {
      if (job.cancelled) throw new ExportCancelledError();
      console.error('[export] Encoder worker failed, falling back to main thread:', workerError);
      try {
        // Worker transfers detach the PCM buffers; re-extract from the render.
        const parts = await finishExportOnMainThread(
          extractPcm(rendered, loudness),
          encoding,
          onFraction,
          job.controller.signal,
        );
        return parts.map((part) => part.buffer);
      } catch (fallbackError) {
        if (job.cancelled || job.controller.signal.aborted) throw new ExportCancelledError();
        const reason =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new ExportError(
          `Audio encode failed on worker and main thread: ${reason}`,
          `Audio export failed: ${reason}`,
          'exportFailed',
          { cause: fallbackError },
        );
      }
    }
  }

  /** Master and encode via the Web Worker; rejects on construction, crash, or error. */
  private encodeViaWorker(
    job: ActiveExportJob,
    rendered: RenderedTake,
    loudness: LoudnessMode,
    encoding: ExportEncoding,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer[]> {
    // Transfer channel copies; the render itself stays untouched.
    const pcm = extractPcm(rendered, loudness);

    return new Promise<ArrayBuffer[]>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../workers/audioEncoder.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (constructError) {
        reject(
          new Error(
            `Encoder worker could not be created: ${
              constructError instanceof Error ? constructError.message : String(constructError)
            }`,
          ),
        );
        return;
      }
      job.worker = worker;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        worker.terminate();
        if (job.worker === worker) job.worker = null;
        job.rejectWorker = null;
      };
      job.rejectWorker = (error) => {
        cleanup();
        reject(error);
      };
      worker.onmessage = (event: MessageEvent<EncoderResponse>) => {
        if (job.cancelled || job.worker !== worker) return;
        const message = event.data;
        if (message.type === 'progress') {
          onFraction(message.fraction);
        } else if (message.type === 'done') {
          cleanup();
          resolve(message.parts);
        } else {
          cleanup();
          reject(new Error(`Audio encoder reported: ${message.message}`));
        }
      };
      worker.onerror = (event) => {
        if (job.cancelled || job.worker !== worker) return;
        cleanup();
        reject(new Error(`Encoder worker crashed: ${event.message || 'unknown error'}`));
      };
      worker.postMessage(
        {
          type: 'encode',
          encoding,
          sampleRate: pcm.sampleRate,
          left: pcm.left.buffer,
          right: pcm.right.buffer,
          clicks: pcm.clicks,
          loudness,
        } satisfies EncodeRequest,
        [pcm.left.buffer, pcm.right.buffer],
      );
    });
  }
}

/**
 * Throw where the encoder's output cannot be the file it should be. An MP3
 * must be at least a plausible size for its length and bitrate. A FLAC stream
 * must start with its own header, saying it holds every sample of the render
 * at its rate and depth — which the encoder writes only once it has coded them
 * all.
 */
function checkEncoded(
  encoding: ExportEncoding,
  parts: readonly ArrayBuffer[],
  size: number,
  rendered: RenderedTake,
): void {
  const { piano } = rendered;
  let plausible: boolean;
  if (encoding.format === 'mp3') {
    plausible = size >= Math.max(2_000, (piano.duration * encoding.kbps * 1000 * 0.3) / 8);
  } else {
    const info = readFlacStreamInfo(new Uint8Array(parts[0] ?? new ArrayBuffer(0)));
    plausible =
      info !== null &&
      info.onlyBlock &&
      info.sampleRate === piano.sampleRate &&
      info.bits === encoding.bits &&
      info.channels === 2 &&
      info.totalSamples === piano.length;
  }
  if (!plausible) {
    throw new ExportError(
      `Encoded ${encoding.format} implausible (${size} bytes)`,
      'Encoding produced an invalid file. Please try again.',
      'exportEncodingInvalid',
    );
  }
}

/** Fresh copies of the render's channels, for the encoder to master in place. */
function extractPcm(rendered: RenderedTake, loudness: LoudnessMode): ExportPcm {
  const { piano, clicks } = rendered;
  const left = new Float32Array(piano.length);
  const right = new Float32Array(piano.length);
  piano.copyFromChannel(left, 0);
  piano.copyFromChannel(right, piano.numberOfChannels > 1 ? 1 : 0);
  return { sampleRate: piano.sampleRate, left, right, clicks, loudness };
}

export const audioExportService = new AudioExportService();
