import { audioEngine } from '@/audio/AudioEngine';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import { createEmptyTake } from '@/domain/noteEvents';
import { getLibraryTake } from '@/features/library/catalog';
import { transportController } from '@/features/transport/transportController';
import { applySystemLanguageIfUnpinned } from '@/i18n/languagePreference';
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
  private readonly lastSavedContentRevisionByTake = new Map<string, number>();
  private flushPromise: Promise<void> | null = null;
  private persistRequestDone = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    let restoredTake = false;

    try {
      const stored = await loadSettings();
      useSettingsStore.setState(stored);
      const settings = useSettingsStore.getState();
      audioEngine.setMasterVolume(settings.masterVolume);
      audioEngine.setReverbMix(settings.reverbMix);
      // Default to the OS language unless the user has pinned one. Runs before
      // the autosave subscription below so an unpinned language isn't written
      // back — it stays re-derived from the OS on each launch.
      await applySystemLanguageIfUnpinned();
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
          audioEngine.setMasterVolume(take.instrument.masterVolume);
          audioEngine.setReverbMix(take.instrument.reverbMix);
          this.lastSavedContentRevisionByTake.set(take.id, useTakeStore.getState().contentRevision);
          restoredTake = true;
        }
      }
    } catch (error) {
      console.error('Take restore failed:', error);
    }

    if (!restoredTake) {
      const settings = useSettingsStore.getState();
      const take = createEmptyTake({
        instrument: {
          id: useTakeStore.getState().take.instrument.id,
          masterVolume: settings.masterVolume,
          reverbMix: settings.reverbMix,
        },
      });
      useTakeStore.getState().setTake(take);
      transportController.restorePlayhead(0);
    }

    useTakeStore.subscribe((state, previous) => {
      if (state.take !== previous.take && state.dirty) this.scheduleSave();
    });
    useSettingsStore.subscribe(() => this.scheduleSettingsSave());
    transportController.onRecordingFinalized.add(() => {
      void this.flushSave();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.flushSave();
        void this.flushSettingsSave();
      }
    });
    window.addEventListener('pagehide', () => {
      void this.flushSave();
      void this.flushSettingsSave();
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
    try {
      await this.ensureFlush();
    } catch {
      // Autosave callers surface the error through SaveStatus. Operations
      // that must not continue after a failed write use flushSaveOrThrow().
    }
  }

  /** Flush the active take and reject if its write failed. */
  async flushSaveOrThrow(): Promise<void> {
    await this.ensureFlush();
  }

  private ensureFlush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.flushPromise) {
      const pending = this.drainSaveQueue();
      this.flushPromise = pending;
      pending.then(
        () => {
          if (this.flushPromise === pending) this.flushPromise = null;
        },
        () => {
          if (this.flushPromise === pending) this.flushPromise = null;
        },
      );
    }
    return this.flushPromise;
  }

  private async drainSaveQueue(): Promise<void> {
    for (;;) {
      const { take, dirty, contentRevision, mutationGeneration } = useTakeStore.getState();
      if (!dirty || isLibraryTakeId(take.id)) return;

      this.setStatus('saving', null);
      try {
        await saveTake(take);
        await setMetadata(META_LAST_OPEN_TAKE, take.id);
        if (contentRevision !== this.lastSavedContentRevisionByTake.get(take.id)) {
          await invalidateCachedAudio(take.id);
          this.lastSavedContentRevisionByTake.set(take.id, contentRevision);
        }
        useTakeStore.getState().markSaved(take.id, mutationGeneration);
        void this.maybeRequestPersistentStorage(take.notes.length);
      } catch (error) {
        const messageKey: ErrorMessageKey =
          error instanceof QuotaExceededStorageError ? 'storageFull' : toErrorMessageKey(error);
        this.setStatus('error', messageKey);
        throw error;
      }

      const current = useTakeStore.getState();
      if (current.dirty && !isLibraryTakeId(current.take.id)) continue;
      this.setStatus('saved', null);
      return;
    }
  }

  retry(): void {
    void this.flushSave();
  }

  private scheduleSettingsSave(): void {
    if (this.settingsTimer !== null) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      void this.flushSettingsSave();
    }, SETTINGS_DEBOUNCE_MS);
  }

  private async flushSettingsSave(): Promise<void> {
    if (this.settingsTimer !== null) {
      clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    try {
      await saveSettings(useSettingsStore.getState());
    } catch (error) {
      console.error('Settings save failed:', error);
    }
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
