import { audioEngine } from '@/audio/AudioEngine';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import { getLibraryTake } from '@/features/library/catalog';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { QuotaExceededStorageError, toErrorMessageKey } from '@/utils/errors';
import type { ErrorMessageKey } from '@/i18n/types';
import { invalidateCachedAudio } from './audioCacheRepository';
import {
  getMetadata,
  META_LAST_OPEN_TAKE,
  META_PERSIST_REQUESTED,
  setMetadata,
} from './metadataRepository';
import { loadSettings, saveSettings } from './settingsRepository';
import { getTake, saveTake } from './takeRepository';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveStatusSnapshot {
  status: SaveStatus;
  /** Translation key for the error message; null unless status is 'error'. */
  messageKey: ErrorMessageKey | null;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
const SETTINGS_DEBOUNCE_MS = 500;

/**
 * Autosave and restore glue: watches the stores, debounces writes, forces
 * immediate saves at the moments the spec calls out (recording stops, page
 * hides, before export), restores the last open take and its playhead, and
 * requests persistent storage after the first meaningful save.
 */
class PersistenceService {
  private snapshot: SaveStatusSnapshot = { status: 'idle', messageKey: null };
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedContentRevision = 0;
  private persistRequestDone = false;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const stored = await loadSettings();
      useSettingsStore.setState(stored);
      const settings = useSettingsStore.getState();
      audioEngine.setMasterVolume(settings.masterVolume);
      audioEngine.setReverbMix(settings.reverbMix);
    } catch (error) {
      console.error('Settings restore failed:', error);
    }

    try {
      const lastId = await getMetadata<string>(META_LAST_OPEN_TAKE);
      if (lastId) {
        // Library takes have no stored row — rebuild pristine from the
        // bundled catalog (in-session tweaks to them are ephemeral).
        const take = isLibraryTakeId(lastId) ? getLibraryTake(lastId) : await getTake(lastId);
        if (take) {
          useTakeStore.getState().setTake(take);
          transportController.restorePlayhead(take.display.playheadMs);
          this.lastSavedContentRevision = useTakeStore.getState().contentRevision;
        }
      }
    } catch (error) {
      console.error('Take restore failed:', error);
    }

    useTakeStore.subscribe((state, previous) => {
      if (state.take !== previous.take && state.dirty) this.scheduleSave();
    });
    useSettingsStore.subscribe(() => this.scheduleSettingsSave());
    transportController.onRecordingFinalized.add(() => {
      void this.flushSave();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushSave();
    });
    window.addEventListener('pagehide', () => {
      void this.flushSave();
    });
  }

  getStatus(): SaveStatusSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** Save now (recording stop, page hide, export start, retry button). */
  async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const { take, dirty, contentRevision } = useTakeStore.getState();
    if (!dirty) return;
    // Library tracks are never persisted: scrubs and tempo tweaks on them
    // are deliberately ephemeral, and recording forks to a fresh id first.
    if (isLibraryTakeId(take.id)) return;

    this.setStatus('saving', null);
    try {
      await saveTake(take);
      await setMetadata(META_LAST_OPEN_TAKE, take.id);
      if (contentRevision !== this.lastSavedContentRevision) {
        await invalidateCachedAudio(take.id);
        this.lastSavedContentRevision = contentRevision;
      }
      useTakeStore.getState().markSaved();
      this.setStatus('saved', null);
      void this.maybeRequestPersistentStorage(take.notes.length);
    } catch (error) {
      const messageKey: ErrorMessageKey =
        error instanceof QuotaExceededStorageError ? 'storageFull' : toErrorMessageKey(error);
      this.setStatus('error', messageKey);
    }
  }

  retry(): void {
    void this.flushSave();
  }

  private scheduleSettingsSave(): void {
    if (this.settingsTimer !== null) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      saveSettings(useSettingsStore.getState()).catch((error: unknown) => {
        console.error('Settings save failed:', error);
      });
    }, SETTINGS_DEBOUNCE_MS);
  }

  /** Spec §9: after the first meaningful take, ask to persist storage. */
  private async maybeRequestPersistentStorage(noteCount: number): Promise<void> {
    if (this.persistRequestDone || noteCount === 0) return;
    this.persistRequestDone = true;
    try {
      const alreadyAsked = await getMetadata<boolean>(META_PERSIST_REQUESTED);
      if (alreadyAsked) return;
      await setMetadata(META_PERSIST_REQUESTED, true);
      if (typeof navigator.storage?.persist === 'function') {
        const granted = await navigator.storage.persist();
        await setMetadata('persistentStorageGranted', granted);
      }
    } catch (error) {
      console.error('Persistent-storage request failed:', error);
    }
  }

  private setStatus(status: SaveStatus, messageKey: ErrorMessageKey | null): void {
    this.snapshot = { status, messageKey };
    for (const listener of this.listeners) listener();
  }
}

export const persistenceService = new PersistenceService();
