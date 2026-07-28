import { audioEngine } from '@/audio/AudioEngine';
import { persistenceService } from '@/data/persistence';
import { META_LAST_OPEN_TAKE, setMetadata } from '@/data/metadataRepository';
import { getAllSettingsForBackup, restoreSettingsFromBackup } from '@/data/settingsRepository';
import {
  deleteTake as repoDeleteTake,
  duplicateTake as repoDuplicateTake,
  getAllTakesForBackup,
  getTake,
  renameTake as repoRenameTake,
  saveTake,
  takeExists,
} from '@/data/takeRepository';
import { ensureNotLibraryTake } from '@/domain/libraryTakes';
import { extractMusicXmlText, isScoreFileName } from '@/domain/mxlContainer';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { createEmptyTake } from '@/domain/noteEvents';
import { parseTakeJson, parseTakeJsonString, type ParsedTake } from '@/domain/takeSchema';
import { CURRENT_SCHEMA_VERSION, type Take } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { scrubController } from '@/features/notation/scrubController';
import { pinLanguage } from '@/i18n/languagePreference';
import { useTakeStore } from '@/state/useTakeStore';
import { loadSettings } from '@/data/settingsRepository';
import { useSettingsStore } from '@/state/useSettingsStore';
import {
  AppError,
  ImportValidationError,
  RemoteImportCancelled,
  RemoteImportError,
  ScoreImportError,
} from '@/utils/errors';
import { backupFileName, takeJsonFileName } from '@/utils/filenames';
import { fileNameFromImportUrl, parseImportUrl } from '@/utils/importUrl';
import { newId } from '@/utils/ids';

const MAX_TAKE_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_SCORE_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_BACKUP_IMPORT_BYTES = 100 * 1024 * 1024;

function rejectOversizedBytes(byteLength: number, maximumBytes: number, kind: string): void {
  if (byteLength > maximumBytes) {
    throw new ImportValidationError([
      `${kind} is too large (${Math.ceil(byteLength / 1_048_576)} MB; maximum ${Math.floor(maximumBytes / 1_048_576)} MB).`,
    ]);
  }
}

function rejectOversizedFile(file: File, maximumBytes: number, kind: string): void {
  rejectOversizedBytes(file.size, maximumBytes, kind);
}

/** Stop any transport activity before swapping the active take. */
function settleTransport(): void {
  if (scrubController.isActive) scrubController.end();
  transportController.handleInterruption();
  audioEngine.allNotesOff();
}

function emptyTakeWithDefaults(): Take {
  const settings = useSettingsStore.getState();
  return createEmptyTake({
    instrument: {
      id: useTakeStore.getState().take.instrument.id,
      masterVolume: settings.masterVolume,
      reverbMix: settings.reverbMix,
    },
  });
}

async function prepareActiveOperation(): Promise<void> {
  settleTransport();
  await persistenceService.flushSaveOrThrow();
}

/**
 * Prep for a destructive/storage-recovery edit (delete, clear). Settles the
 * transport and cancels the pending autosave, but — unlike prepareActiveOperation
 * — never throws: a failing write (e.g. quota exceeded) must not block the very
 * action that would free storage.
 */
async function settleForDestructiveEdit(): Promise<void> {
  settleTransport();
  await persistenceService.flushSave();
}

async function activatePrepared(take: Take): Promise<void> {
  useTakeStore.getState().setTake(take);
  audioEngine.setMasterVolume(take.instrument.masterVolume);
  audioEngine.setReverbMix(take.instrument.reverbMix);
  transportController.restorePlayhead(take.display.playheadMs);
  await setMetadata(META_LAST_OPEN_TAKE, take.id);
}

async function activate(take: Take): Promise<void> {
  await prepareActiveOperation();
  await activatePrepared(take);
}

export async function createNewTake(): Promise<void> {
  await activate(emptyTakeWithDefaults());
}

/** Make `take` the active take on the Play screen (the library open flow). */
export async function activateTake(take: Take): Promise<void> {
  await activate(take);
}

export async function openTake(id: string): Promise<boolean> {
  if (useTakeStore.getState().take.id === id) {
    await prepareActiveOperation();
    return true;
  }
  await prepareActiveOperation();
  const take = await getTake(id);
  if (!take) return false;
  await activatePrepared(take);
  return true;
}

export async function renameTake(id: string, title: string): Promise<void> {
  const trimmed = title.trim().slice(0, 200);
  if (trimmed.length === 0) return;
  const active = useTakeStore.getState().take;
  if (active.id === id) {
    useTakeStore.getState().setTitle(trimmed);
    await persistenceService.flushSaveOrThrow();
    return;
  }
  await repoRenameTake(id, trimmed);
}

export async function duplicateTake(id: string): Promise<void> {
  if (useTakeStore.getState().take.id === id) {
    await prepareActiveOperation();
  }
  await repoDuplicateTake(id);
}

export async function deleteTake(id: string): Promise<void> {
  const active = useTakeStore.getState().take.id === id;
  if (active) await settleForDestructiveEdit();
  await repoDeleteTake(id);
  if (active) await activatePrepared(emptyTakeWithDefaults());
}

/** Remove all notes/pedals from a take, keeping the take itself. */
export async function clearTakeNotes(id: string): Promise<void> {
  if (useTakeStore.getState().take.id === id) {
    await settleForDestructiveEdit();
    useTakeStore.getState().clearNotes();
    transportController.restorePlayhead(0);
    await persistenceService.flushSaveOrThrow();
    return;
  }
  const take = await getTake(id);
  if (!take) return;
  await saveTake({
    ...take,
    notes: [],
    pedalEvents: [],
    durationMs: 0,
    display: { ...take.display, playheadMs: 0 },
    updatedAt: new Date().toISOString(),
  });
}

/** The freshest form of a take: the in-memory copy when it is active. */
async function resolveTake(id: string): Promise<Take | null> {
  const active = useTakeStore.getState().take;
  if (active.id === id) {
    await prepareActiveOperation();
    return useTakeStore.getState().take;
  }
  return getTake(id);
}

/** Freshest take content for audio export (flushes the active take first). */
export async function getTakeForExport(id: string): Promise<Take | null> {
  return resolveTake(id);
}

export async function takeJsonFile(id: string): Promise<File | null> {
  const take = await resolveTake(id);
  if (!take) return null;
  const json = JSON.stringify(take, null, 2);
  return new File([json], takeJsonFileName(take.title), { type: 'application/json' });
}

// ------------------------------------------------------------- import --

export interface ImportPreview {
  parsed: ParsedTake;
  /** A take with the same id already exists locally. */
  collision: boolean;
  fileName: string;
}

/** Preview take JSON already read into memory, whatever carried it here. */
export async function previewImportTakeText(
  text: string,
  fileName: string,
): Promise<ImportPreview> {
  const parsed = parseTakeJsonString(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const collision = await takeExists(parsed.take.id);
  return { parsed, collision, fileName };
}

/** Preview MXL/MusicXML bytes already in memory as a freshly converted take. */
export async function previewImportScoreBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<ImportPreview> {
  let parsed: ParsedTake;
  try {
    rejectOversizedBytes(bytes.byteLength, MAX_SCORE_IMPORT_BYTES, 'The score file');
    const take = musicXmlToTake(extractMusicXmlText(bytes), fileName);
    parsed = parseTakeJson(take); // defense-in-depth: the uniform import pipeline
  } catch (error) {
    if (error instanceof ScoreImportError) throw error;
    if (error instanceof ImportValidationError) throw new ScoreImportError(error.issues);
    throw new ScoreImportError([error instanceof Error ? error.message : String(error)]);
  }
  const collision = await takeExists(parsed.take.id); // fresh id — effectively always false
  return { parsed, collision, fileName };
}

export async function previewImportFile(file: File): Promise<ImportPreview> {
  rejectOversizedFile(file, MAX_TAKE_IMPORT_BYTES, 'The take file');
  return previewImportTakeText(await file.text(), file.name);
}

/** Preview an MXL/MusicXML score file as a freshly converted take. */
export async function previewImportScoreFile(file: File): Promise<ImportPreview> {
  try {
    // Cheap early-out so an oversized pick is never buffered into memory.
    rejectOversizedFile(file, MAX_SCORE_IMPORT_BYTES, 'The score file');
  } catch (error) {
    if (error instanceof ImportValidationError) throw new ScoreImportError(error.issues);
    throw error;
  }
  return previewImportScoreBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

// --------------------------------------------------------- import by URL --

const REMOTE_IMPORT_TIMEOUT_MS = 30_000;

type RemoteImportKind = 'score' | 'take';

function kindFromContentType(header: string | null): RemoteImportKind | null {
  if (header === null) return null;
  const type = (header.split(';')[0] ?? '').trim().toLowerCase();
  if (type === 'application/json' || type === 'text/json') return 'take';
  if (type === 'application/xml' || type === 'text/xml' || type.endsWith('+xml')) return 'score';
  if (type.startsWith('application/vnd.recordare.musicxml')) return 'score';
  return null;
}

/** Last resort: hosts lie about Content-Type (raw GitHub serves MusicXML as text/plain). */
function kindFromBytes(bytes: Uint8Array): RemoteImportKind | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'score'; // MXL is a zip
  }
  const skippable = new Set([0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf]); // space, tabs, EOLs, BOM
  for (const byte of bytes.subarray(0, 64)) {
    if (skippable.has(byte)) continue;
    if (byte === 0x3c) return 'score'; // '<' — raw MusicXML
    if (byte === 0x7b) return 'take'; // '{' — take JSON
    return null;
  }
  return null;
}

/** The final URL after redirects is the truthful one; fall back to what was pasted. */
function remoteFileName(requested: URL, responseUrl: string): string {
  if (responseUrl !== '') {
    try {
      const fromResponse = fileNameFromImportUrl(new URL(responseUrl));
      if (fromResponse !== '') return fromResponse;
    } catch {
      // Not a parsable URL (some mocked responses): use the requested one.
    }
  }
  return fileNameFromImportUrl(requested);
}

/**
 * Buffer a response body, bailing the moment it exceeds `maximumBytes`. A
 * missing or dishonest Content-Length must not let a host stream unbounded
 * data into memory — the same posture as the archive limits in mxlContainer.
 */
async function readBodyWithLimit(
  response: Response,
  maximumBytes: number,
  kind: string,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    rejectOversizedBytes(buffer.byteLength, maximumBytes, kind);
    return new Uint8Array(buffer);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      rejectOversizedBytes(total, maximumBytes, kind);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Download a score or take from a pasted link and preview it exactly as a
 * picked file would be. Cross-origin success depends entirely on the host
 * sending CORS headers; there is no proxy, and there cannot be one on a
 * static deploy, so a rejection surfaces as `RemoteImportError('blocked')`.
 */
export async function previewImportUrl(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<ImportPreview> {
  const url = parseImportUrl(rawUrl);
  // An already-aborted signal never fires `abort` again, so nothing would
  // forward it — bail before a request the caller has already given up on.
  if (signal?.aborted === true) throw new RemoteImportCancelled();
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REMOTE_IMPORT_TIMEOUT_MS);
  const forwardAbort = () => {
    cancelled = true;
    controller.abort();
  };
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    // The service worker runtime-caches only /piano/ and this origin's own
    // /scores/classics-v1/, so this passes straight through to the network —
    // do not add a catch-all route without revisiting. A route matching
    // "/scores/" on any origin would swallow links to the upstream score
    // library, whose paths look exactly like ours.
    const response = await fetch(url, {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit', // never send cookies to a third-party host
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!response.ok) throw new RemoteImportError('http', { status: response.status });

    // Content-Length is CORS-safelisted, so this early-out works cross-origin.
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 0) {
      rejectOversizedBytes(declared, MAX_SCORE_IMPORT_BYTES, 'The linked file');
    }

    const fileName = remoteFileName(url, response.url);
    let kind: RemoteImportKind | null = null;
    if (fileName !== '') {
      if (isScoreFileName(fileName)) kind = 'score';
      else if (/\.json$/i.test(fileName)) kind = 'take';
    }
    kind ??= kindFromContentType(response.headers.get('content-type'));

    const bytes = await readBodyWithLimit(response, MAX_SCORE_IMPORT_BYTES, 'The linked file');
    kind ??= kindFromBytes(bytes) ?? 'take'; // unknown falls through to the friendlier message

    if (kind === 'score') {
      return await previewImportScoreBytes(bytes, fileName === '' ? 'score.musicxml' : fileName);
    }
    rejectOversizedBytes(bytes.byteLength, MAX_TAKE_IMPORT_BYTES, 'The take file');
    return await previewImportTakeText(
      new TextDecoder('utf-8').decode(bytes),
      fileName === '' ? 'take.json' : fileName,
    );
  } catch (error) {
    controller.abort();
    // Both a cancel and a timeout raise AbortError, so trust our own flags.
    if (cancelled) throw new RemoteImportCancelled();
    if (timedOut) throw new RemoteImportError('timeout', { cause: error });
    if (error instanceof AppError) throw error;
    // CORS, DNS, TLS and mixed-content all arrive as an opaque TypeError.
    // `navigator.onLine` is only trustworthy when it is false.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new RemoteImportError(offline ? 'offline' : 'blocked', { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Commit a previewed import. Collisions default to a fresh local id; the
 * user must explicitly choose replacement.
 */
export async function commitImport(
  preview: ImportPreview,
  strategy: 'copy' | 'replace',
): Promise<Take> {
  await prepareActiveOperation();
  let take = preview.parsed.take;
  if (preview.collision && strategy === 'copy') {
    take = { ...take, id: newId() };
  }
  take = ensureNotLibraryTake(take);
  await saveTake(take);
  await activatePrepared(take);
  return take;
}

// ------------------------------------------------------------- backup --

interface BackupFileShape {
  kind: 'pokeyboard-backup';
  schemaVersion: number;
  createdAt: string;
  takes: unknown[];
  settings: Record<string, unknown>;
}

export async function backupAllFile(): Promise<File> {
  await persistenceService.flushSaveOrThrow();
  const takes = await getAllTakesForBackup();
  const settings = await getAllSettingsForBackup();
  const backup: BackupFileShape = {
    kind: 'pokeyboard-backup',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    takes,
    settings,
  };
  return new File([JSON.stringify(backup, null, 2)], backupFileName(new Date()), {
    type: 'application/json',
  });
}

export interface RestoreResult {
  imported: number;
  skipped: number;
  settingsRestored: boolean;
}

/** Restore a full backup; colliding take ids get fresh local ids. */
export async function restoreBackupFile(file: File): Promise<RestoreResult> {
  rejectOversizedFile(file, MAX_BACKUP_IMPORT_BYTES, 'The backup file');
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new ImportValidationError(['The backup file is not valid JSON.']);
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { kind?: unknown }).kind !== 'pokeyboard-backup' ||
    !Array.isArray((raw as { takes?: unknown }).takes)
  ) {
    throw new ImportValidationError(['This file is not a PoKeyBoard backup.']);
  }
  const backup = raw as BackupFileShape;

  let imported = 0;
  let skipped = 0;
  for (const entry of backup.takes) {
    try {
      const { take } = parseTakeJsonString(JSON.stringify(entry));
      const finalTake = ensureNotLibraryTake(
        (await takeExists(take.id)) ? { ...take, id: newId() } : take,
      );
      await saveTake(finalTake);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  let settingsRestored = false;
  if (backup.settings && typeof backup.settings === 'object') {
    await restoreSettingsFromBackup(backup.settings);
    useSettingsStore.setState(await loadSettings());
    // A restored backup carries the user's chosen language; pin it so it
    // sticks instead of being overwritten by OS detection on the next launch.
    if (
      ['en', 'es', 'fr', 'mg'].includes(
        String((backup.settings as Record<string, unknown>).language),
      )
    ) {
      await pinLanguage();
    }
    settingsRestored = true;
  }
  return { imported, skipped, settingsRestored };
}
