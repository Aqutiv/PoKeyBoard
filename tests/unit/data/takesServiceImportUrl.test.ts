import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { RemoteImportError } from '@/utils/errors';
import type { ImportPreview } from '@/features/takes/takesService';

const SCORE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<score-partwise version="3.1"><part-list>' +
  '<score-part id="P1"><part-name>P1</part-name></score-part></part-list>' +
  '<part id="P1"><measure number="1">' +
  '<attributes><divisions>1</divisions>' +
  '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
  '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>' +
  '<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>' +
  '</measure></part></score-partwise>';

function takeJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: 'b2ce1f0e-45c1-4b3a-8a4e-3b1936b25c01',
    title: 'Linked Take',
    createdAt: '2026-07-17T10:00:00.000Z',
    updatedAt: '2026-07-17T10:05:00.000Z',
    durationMs: 900,
    samplePackVersion: 'grand-piano-v1',
    tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 },
    instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
    notes: [{ id: 'n-1', midi: 60, startMs: 0, durationMs: 420, velocity: 0.78 }],
    pedalEvents: [],
    display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
  });
}

/** A Response whose body streams `bytes` in one chunk, as a real fetch would. */
function streamingResponse(
  bytes: Uint8Array,
  init: { status?: number; url?: string; headers?: Record<string, string> } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const headers = new Headers(init.headers ?? {});
  const response = {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? '',
    headers,
    body,
    arrayBuffer: vi.fn(async () => bytes.buffer),
  };
  return response as unknown as Response;
}

function textResponse(
  text: string,
  init?: { status?: number; url?: string; headers?: Record<string, string> },
): Response {
  return streamingResponse(new TextEncoder().encode(text), init);
}

async function loadService() {
  vi.doMock('@/data/takeRepository', () => ({
    deleteTake: vi.fn(),
    duplicateTake: vi.fn(),
    getAllTakesForBackup: vi.fn(),
    getTake: vi.fn(async () => null),
    renameTake: vi.fn(),
    saveTake: vi.fn(async () => undefined),
    takeExists: vi.fn(async () => false),
  }));
  vi.doMock('@/data/metadataRepository', () => ({
    META_LAST_OPEN_TAKE: 'lastOpenTakeId',
    META_PERSIST_REQUESTED: 'persistentStorageRequested',
    getMetadata: vi.fn(async () => undefined),
    setMetadata: vi.fn(async () => undefined),
  }));
  vi.doMock('@/data/audioCacheRepository', () => ({
    invalidateCachedAudio: vi.fn(async () => undefined),
  }));
  vi.doMock('@/audio/AudioEngine', () => ({
    audioEngine: { allNotesOff: vi.fn(), setMasterVolume: vi.fn(), setReverbMix: vi.fn() },
  }));
  vi.doMock('@/features/transport/transportController', () => ({
    transportController: { handleInterruption: vi.fn(), restorePlayhead: vi.fn() },
  }));
  vi.doMock('@/features/notation/scrubController', () => ({
    scrubController: { isActive: false, end: vi.fn() },
  }));
  // resetModules gives each test a fresh registry, so the error classes must
  // come from the same graph as the service or `instanceof` will not match.
  const [service, errors] = await Promise.all([
    import('@/features/takes/takesService'),
    import('@/utils/errors'),
  ]);
  return { ...service, ...errors };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/features/transport/transportController');
  vi.doUnmock('@/features/notation/scrubController');
  vi.resetModules();
});

async function expectRemoteFailure(promise: Promise<ImportPreview>, ctor: unknown, kind: string) {
  await expect(promise).rejects.toBeInstanceOf(ctor);
  await promise.catch((error: unknown) => {
    expect((error as RemoteImportError).kind).toBe(kind);
  });
}

describe('previewImportUrl', () => {
  it('imports a MusicXML score and titles it from the link', async () => {
    const { previewImportUrl } = await loadService();
    fetchMock.mockResolvedValue(
      textResponse(SCORE_XML, { headers: { 'content-type': 'application/xml' } }),
    );

    const preview = await previewImportUrl('https://x.test/scores/Fur%20Elise.musicxml');

    expect(preview.parsed.take.notes).toHaveLength(2);
    expect(preview.parsed.take.title).toBe('Fur Elise'); // extension stripped by the importer
    expect(preview.collision).toBe(false);
  });

  it('imports an MXL archive sniffed from its zip magic alone', async () => {
    const { previewImportUrl } = await loadService();
    const mxl = zipSync({ 'score.xml': strToU8(SCORE_XML) });
    fetchMock.mockResolvedValue(
      streamingResponse(mxl, { headers: { 'content-type': 'application/octet-stream' } }),
    );

    // No usable extension and a useless Content-Type: only the byte sniff saves this.
    const preview = await previewImportUrl('https://x.test/download');
    expect(preview.parsed.take.notes).toHaveLength(2);
  });

  it('imports a take JSON served as text/plain', async () => {
    const { previewImportUrl } = await loadService();
    fetchMock.mockResolvedValue(
      textResponse(takeJson(), { headers: { 'content-type': 'text/plain' } }),
    );

    const preview = await previewImportUrl('https://x.test/download');
    expect(preview.parsed.take.title).toBe('Linked Take');
  });

  it('follows the redirected URL when deciding the file kind', async () => {
    const { previewImportUrl } = await loadService();
    fetchMock.mockResolvedValue(
      textResponse(SCORE_XML, {
        url: 'https://cdn.x.test/final/song.mxl',
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const preview = await previewImportUrl('https://x.test/share/abc123');
    expect(preview.parsed.take.title).toBe('song');
  });

  it('sends the request with cookies omitted and CORS mode', async () => {
    const { previewImportUrl } = await loadService();
    fetchMock.mockResolvedValue(
      textResponse(SCORE_XML, { headers: { 'content-type': 'application/xml' } }),
    );

    await previewImportUrl('https://x.test/a.musicxml');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect(init.mode).toBe('cors');
  });

  it('reports the status when the host answers with an error', async () => {
    const { previewImportUrl, RemoteImportError } = await loadService();
    fetchMock.mockResolvedValue(textResponse('nope', { status: 404 }));

    const promise = previewImportUrl('https://x.test/missing.mxl');
    await expect(promise).rejects.toBeInstanceOf(RemoteImportError);
    await promise.catch((error: unknown) => {
      expect((error as RemoteImportError).kind).toBe('http');
      expect((error as RemoteImportError).status).toBe(404);
    });
  });

  it('treats an opaque fetch TypeError as blocked', async () => {
    const { previewImportUrl, RemoteImportError } = await loadService();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expectRemoteFailure(
      previewImportUrl('https://x.test/a.mxl'),
      RemoteImportError,
      'blocked',
    );
  });

  it('prefers the offline message when the browser knows it is offline', async () => {
    const { previewImportUrl, RemoteImportError } = await loadService();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await expectRemoteFailure(
      previewImportUrl('https://x.test/a.mxl'),
      RemoteImportError,
      'offline',
    );
    onLine.mockRestore();
  });

  it('rejects an over-large Content-Length without reading the body', async () => {
    const { previewImportUrl, ImportValidationError } = await loadService();
    const response = textResponse(SCORE_XML, {
      headers: { 'content-length': String(60 * 1024 * 1024) },
    });
    const getReader = vi.spyOn(response.body as ReadableStream<Uint8Array>, 'getReader');
    fetchMock.mockResolvedValue(response);

    await expect(previewImportUrl('https://x.test/huge.json')).rejects.toBeInstanceOf(
      ImportValidationError,
    );
    expect(getReader).not.toHaveBeenCalled();
  });

  it('still rejects an over-large body when Content-Length lies', async () => {
    const { previewImportUrl, ImportValidationError } = await loadService();
    const oversized = new Uint8Array(51 * 1024 * 1024);
    oversized[0] = 0x7b; // '{' — would otherwise be routed to the take path
    fetchMock.mockResolvedValue(
      streamingResponse(oversized, { headers: { 'content-length': '10' } }),
    );

    await expect(previewImportUrl('https://x.test/liar')).rejects.toBeInstanceOf(
      ImportValidationError,
    );
  });

  it('does not fetch at all when the link is not http(s)', async () => {
    const { previewImportUrl, RemoteImportError } = await loadService();
    await expectRemoteFailure(
      previewImportUrl('javascript:alert(1)'),
      RemoteImportError,
      'invalidUrl',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never starts a request the caller already gave up on', async () => {
    const { previewImportUrl, RemoteImportCancelled } = await loadService();
    const controller = new AbortController();
    controller.abort();

    // An already-aborted signal emits no further `abort` event, so this must be
    // caught up front rather than left to a listener that will never fire.
    await expect(
      previewImportUrl('https://x.test/a.mxl', controller.signal),
    ).rejects.toBeInstanceOf(RemoteImportCancelled);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tears down an in-flight request when the caller aborts', async () => {
    const { previewImportUrl, RemoteImportCancelled } = await loadService();
    const controller = new AbortController();
    let sentSignal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_input: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          sentSignal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );

    const promise = previewImportUrl('https://x.test/a.mxl', controller.signal);
    await vi.waitFor(() => expect(sentSignal).toBeDefined());
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(RemoteImportCancelled);
    expect(sentSignal?.aborted).toBe(true); // the abort really reached fetch
  });
});
