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
import { extractMusicXmlText } from '@/domain/mxlContainer';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { createEmptyTake } from '@/domain/noteEvents';
import { parseTakeJson, parseTakeJsonString, type ParsedTake } from '@/domain/takeSchema';
import { CURRENT_SCHEMA_VERSION, type Take } from '@/domain/takeTypes';
import { transportController } from '@/features/transport/transportController';
import { useTakeStore } from '@/state/useTakeStore';
import { loadSettings } from '@/data/settingsRepository';
import { useSettingsStore } from '@/state/useSettingsStore';
import { ImportValidationError, ScoreImportError } from '@/utils/errors';
import { backupFileName, takeJsonFileName } from '@/utils/filenames';
import { newId } from '@/utils/ids';

/** Stop any transport activity before swapping the active take. */
function settleTransport(): void {
  const state = transportController.getState();
  if (state === 'recording' || state === 'countIn' || state === 'playing') {
    transportController.stop();
  }
}

async function activate(take: Take): Promise<void> {
  settleTransport();
  await persistenceService.flushSave();
  useTakeStore.getState().setTake(take);
  transportController.restorePlayhead(take.display.playheadMs);
  await setMetadata(META_LAST_OPEN_TAKE, take.id);
}

export async function createNewTake(): Promise<void> {
  await activate(createEmptyTake());
}

/** Make `take` the active take on the Play screen (the library open flow). */
export async function activateTake(take: Take): Promise<void> {
  await activate(take);
}

export async function openTake(id: string): Promise<boolean> {
  const take = await getTake(id);
  if (!take) return false;
  await activate(take);
  return true;
}

export async function renameTake(id: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (trimmed.length === 0) return;
  const active = useTakeStore.getState().take;
  if (active.id === id) {
    useTakeStore.getState().setTitle(trimmed);
    await persistenceService.flushSave();
    return;
  }
  await repoRenameTake(id, trimmed);
}

export async function duplicateTake(id: string): Promise<void> {
  if (useTakeStore.getState().take.id === id) {
    await persistenceService.flushSave();
  }
  await repoDuplicateTake(id);
}

export async function deleteTake(id: string): Promise<void> {
  await repoDeleteTake(id);
  if (useTakeStore.getState().take.id === id) {
    await activate(createEmptyTake());
  }
}

/** Remove all notes/pedals from a take, keeping the take itself. */
export async function clearTakeNotes(id: string): Promise<void> {
  if (useTakeStore.getState().take.id === id) {
    useTakeStore.getState().clearNotes();
    await persistenceService.flushSave();
    return;
  }
  const take = await getTake(id);
  if (!take) return;
  await saveTake({
    ...take,
    notes: [],
    pedalEvents: [],
    durationMs: 0,
    updatedAt: new Date().toISOString(),
  });
}

/** The freshest form of a take: the in-memory copy when it is active. */
async function resolveTake(id: string): Promise<Take | null> {
  const active = useTakeStore.getState().take;
  if (active.id === id) {
    await persistenceService.flushSave();
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

export async function previewImportFile(file: File): Promise<ImportPreview> {
  const text = await file.text();
  const parsed = parseTakeJsonString(text);
  const collision = await takeExists(parsed.take.id);
  return { parsed, collision, fileName: file.name };
}

/** Preview an MXL/MusicXML score file as a freshly converted take. */
export async function previewImportScoreFile(file: File): Promise<ImportPreview> {
  let parsed: ParsedTake;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const take = musicXmlToTake(extractMusicXmlText(bytes), file.name);
    parsed = parseTakeJson(take); // defense-in-depth: the uniform import pipeline
  } catch (error) {
    if (error instanceof ScoreImportError) throw error;
    if (error instanceof ImportValidationError) throw new ScoreImportError(error.issues);
    throw new ScoreImportError([error instanceof Error ? error.message : String(error)]);
  }
  const collision = await takeExists(parsed.take.id); // fresh id — effectively always false
  return { parsed, collision, fileName: file.name };
}

/**
 * Commit a previewed import. Collisions default to a fresh local id; the
 * user must explicitly choose replacement.
 */
export async function commitImport(
  preview: ImportPreview,
  strategy: 'copy' | 'replace',
): Promise<Take> {
  let take = preview.parsed.take;
  if (preview.collision && strategy === 'copy') {
    take = { ...take, id: newId() };
  }
  take = ensureNotLibraryTake(take);
  await saveTake(take);
  await activate(take);
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
  await persistenceService.flushSave();
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
    settingsRestored = true;
  }
  return { imported, skipped, settingsRestored };
}
