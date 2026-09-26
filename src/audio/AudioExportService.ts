import { getCachedAudio, invalidateCachedAudio, putCachedAudio } from '@/data/audioCacheRepository';
import { persistenceService } from '@/data/persistence';
import { computeExportHash } from '@/domain/takeHash';
import type { Take } from '@/domain/takeTypes';
import { libraryTrackSummary } from '@/features/library/catalog';
import { ExportError } from '@/utils/errors';
import { takeAudioFileName } from '@/utils/filenames';
import type { EncoderResponse } from '@/workers/mp3Encoder.worker';
import { id3v2Tag } from './id3';
import { instrumentForPackVersion } from './instruments';
import type { LoudnessMode } from './loudness';
import { finishMp3OnMainThread, type ExportBitrateKbps, type ExportPcm } from './mp3Encode';
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
 */
export const AUDIO_EXPORTER_VERSION = 7;

export type ExportQuality = 'share' | 'high';

export const QUALITY_BITRATE: Record<ExportQuality, ExportBitrateKbps> = {
  share: 128,
  high: 192,
};

export interface ExportOptions {
  quality: ExportQuality;
  includeMetronome: boolean;
  metronomeVolume: number;
  loudness: LoudnessMode;
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
  hash: string;
  durationMs: number;
  sizeBytes: number;
  fromCache: boolean;
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
 * and MP3 encode → validate → cache under a deterministic hash → tag. Cached
 * results are reused only while the hash still matches. The cache holds the
 * bare MP3 and the tag is written on the way out, so a renamed take never
 * carries its old title.
 */
class AudioExportService {
  private activeJob: ActiveExportJob | null = null;

  async exportTake(
    take: Take,
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
      const bitrateKbps = QUALITY_BITRATE[options.quality];
      const hash = await this.awaitJob(
        job,
        computeExportHash({
          take,
          exporterVersion: AUDIO_EXPORTER_VERSION,
          bitrateKbps,
          includeMetronome: options.includeMetronome,
          metronomeVolume: options.metronomeVolume,
          loudness: options.loudness,
        }),
      );
      // Every export names the piano it was rendered with; a library track is
      // credited to its composer as well.
      const composer = libraryTrackSummary(take.id)?.composer;
      const piano = instrumentForPackVersion(take.samplePackVersion).name;
      const fileName = takeAudioFileName(take.title, { composer, piano });
      const tag = id3v2Tag({
        title: take.title,
        artist: composer,
        composer,
        album: 'PoKeyBoard',
        encodedWith: `PoKeyBoard (${piano})`,
      });
      const tagged = (mp3: Blob) => new Blob([tag, mp3], { type: 'audio/mpeg' });

      const cached = await this.awaitJob(job, getCachedAudio(take.id));
      if (cached && cached.hash === hash) {
        const blob = tagged(cached.blob);
        return {
          blob,
          fileName,
          hash,
          durationMs: effectivePlaybackDurationMs(take),
          sizeBytes: blob.size,
          fromCache: true,
        };
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
      const mp3 = await this.awaitJob(
        job,
        this.encode(job, rendered, options.loudness, bitrateKbps, (fraction) => {
          if (fraction <= compressed) return;
          compressed = fraction;
          report({ stage: 'encoding', fraction });
        }),
      );

      const bare = new Blob([mp3], { type: 'audio/mpeg' });
      const minimumPlausible = Math.max(
        2_000,
        (rendered.piano.duration * bitrateKbps * 1000 * 0.3) / 8,
      );
      if (bare.size < minimumPlausible) {
        throw new ExportError(
          `Encoded MP3 implausibly small (${bare.size} bytes)`,
          'Encoding produced an invalid file. Please try again.',
          'exportEncodingInvalid',
        );
      }

      await this.awaitJob(
        job,
        putCachedAudio({
          takeId: take.id,
          hash,
          blob: bare,
          mimeType: 'audio/mpeg',
          fileName,
          createdAt: new Date().toISOString(),
        }),
      );

      const blob = tagged(bare);
      return {
        blob,
        fileName,
        hash,
        durationMs: effectivePlaybackDurationMs(take),
        sizeBytes: blob.size,
        fromCache: false,
      };
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
    bitrateKbps: ExportBitrateKbps,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer> {
    try {
      return await this.encodeViaWorker(job, rendered, loudness, bitrateKbps, onFraction);
    } catch (workerError) {
      if (job.cancelled) throw new ExportCancelledError();
      console.error('[export] MP3 worker failed, falling back to main thread:', workerError);
      try {
        // Worker transfers detach the PCM buffers; re-extract from the render.
        const out = await finishMp3OnMainThread(
          extractPcm(rendered, loudness),
          bitrateKbps,
          onFraction,
          job.controller.signal,
        );
        return out.buffer as ArrayBuffer;
      } catch (fallbackError) {
        if (job.cancelled || job.controller.signal.aborted) throw new ExportCancelledError();
        const reason =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new ExportError(
          `MP3 encode failed on worker and main thread: ${reason}`,
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
    bitrateKbps: ExportBitrateKbps,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer> {
    // Transfer channel copies; the render itself stays untouched.
    const pcm = extractPcm(rendered, loudness);

    return new Promise<ArrayBuffer>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../workers/mp3Encoder.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (constructError) {
        reject(
          new Error(
            `MP3 worker could not be created: ${
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
          resolve(message.mp3);
        } else {
          cleanup();
          reject(new Error(`MP3 encoder reported: ${message.message}`));
        }
      };
      worker.onerror = (event) => {
        if (job.cancelled || job.worker !== worker) return;
        cleanup();
        reject(new Error(`MP3 worker crashed: ${event.message || 'unknown error'}`));
      };
      worker.postMessage(
        {
          type: 'encode',
          sampleRate: pcm.sampleRate,
          bitrateKbps,
          left: pcm.left.buffer,
          right: pcm.right.buffer,
          clicks: pcm.clicks,
          loudness,
        },
        [pcm.left.buffer, pcm.right.buffer],
      );
    });
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
