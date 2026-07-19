import { create } from 'zustand';
import {
  computeTakeDurationMs,
  createEmptyTake,
  removeNotesByIds,
  sortNotes,
} from '@/domain/noteEvents';
import type {
  InstrumentSettings,
  NoteEvent,
  PedalEvent,
  Take,
  TempoSettings,
} from '@/domain/takeTypes';

export interface TakeStoreState {
  take: Take;
  /** Note ids added by the most recent recording pass (undo target). */
  lastPassNoteIds: string[];
  /** Pedal events added by the most recent recording pass (undo target). */
  lastPassPedalEvents: PedalEvent[];
  /** Unsaved changes exist (autosave layer watches this). */
  dirty: boolean;
  /** Monotonic identity for the active take snapshot. */
  mutationGeneration: number;
  /** Last generation confirmed written for the active take. */
  savedGeneration: number;
  /**
   * Bumps only when the audible content changes (notes, pedals, tempo,
   * instrument) — the autosave layer invalidates cached export audio when
   * this moves. Title and playhead changes do not bump it.
   */
  contentRevision: number;

  setTake(take: Take, options?: { dirty?: boolean }): void;
  updateTake(mutate: (take: Take) => Take): void;
  beginRecordingPass(): void;
  appendRecordedNotes(notes: NoteEvent[], pedals: PedalEvent[], passNoteIds: string[]): void;
  undoLastPass(): void;
  clearNotes(): void;
  setTitle(title: string): void;
  setTempo(tempo: TempoSettings): void;
  setInstrumentSettings(instrument: InstrumentSettings): void;
  setPlayheadMs(playheadMs: number): void;
  setDisplayQuantization(quantization: Take['display']['quantization']): void;
  markSaved(takeId: string, generation: number): void;
}

function touched(take: Take): Take {
  return { ...take, updatedAt: new Date().toISOString() };
}

/**
 * The active take being edited. Timing-critical playback never reads React
 * state; this store is the source of truth for *musical content* only.
 */
export const useTakeStore = create<TakeStoreState>()((set) => ({
  take: createEmptyTake(),
  lastPassNoteIds: [],
  lastPassPedalEvents: [],
  dirty: false,
  mutationGeneration: 0,
  savedGeneration: 0,
  contentRevision: 0,

  setTake: (take, options) =>
    set((state) => {
      const mutationGeneration = state.mutationGeneration + 1;
      const dirty = options?.dirty ?? false;
      return {
        take,
        lastPassNoteIds: [],
        lastPassPedalEvents: [],
        dirty,
        mutationGeneration,
        savedGeneration: dirty ? state.savedGeneration : mutationGeneration,
        contentRevision: state.contentRevision + 1,
      };
    }),

  updateTake: (mutate) =>
    set((state) => ({
      take: touched(mutate(state.take)),
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
      contentRevision: state.contentRevision + 1,
    })),

  beginRecordingPass: () => set({ lastPassNoteIds: [], lastPassPedalEvents: [] }),

  appendRecordedNotes: (notes, pedals, passNoteIds) =>
    set((state) => {
      const mergedNotes = sortNotes([...state.take.notes, ...notes]);
      const mergedPedals = [...state.take.pedalEvents, ...pedals].sort(
        (a, b) => a.atMs - b.atMs || Number(a.down) - Number(b.down),
      );
      return {
        take: touched({
          ...state.take,
          notes: mergedNotes,
          pedalEvents: mergedPedals,
          durationMs: computeTakeDurationMs(mergedNotes),
        }),
        lastPassNoteIds: passNoteIds,
        lastPassPedalEvents: [...state.lastPassPedalEvents, ...pedals],
        dirty: true,
        mutationGeneration: state.mutationGeneration + 1,
        contentRevision: state.contentRevision + 1,
      };
    }),

  undoLastPass: () =>
    set((state) => {
      if (state.lastPassNoteIds.length === 0 && state.lastPassPedalEvents.length === 0)
        return state;
      const notes = removeNotesByIds(state.take.notes, new Set(state.lastPassNoteIds));
      const passPedals = new Set(state.lastPassPedalEvents);
      const pedalEvents = state.take.pedalEvents.filter((event) => !passPedals.has(event));
      const durationMs = computeTakeDurationMs(notes);
      return {
        take: touched({
          ...state.take,
          notes,
          pedalEvents,
          durationMs,
          display: {
            ...state.take.display,
            playheadMs: Math.min(state.take.display.playheadMs, durationMs),
          },
        }),
        lastPassNoteIds: [],
        lastPassPedalEvents: [],
        dirty: true,
        mutationGeneration: state.mutationGeneration + 1,
        contentRevision: state.contentRevision + 1,
      };
    }),

  clearNotes: () =>
    set((state) => ({
      take: touched({
        ...state.take,
        notes: [],
        pedalEvents: [],
        durationMs: 0,
        display: { ...state.take.display, playheadMs: 0 },
      }),
      lastPassNoteIds: [],
      lastPassPedalEvents: [],
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
      contentRevision: state.contentRevision + 1,
    })),

  setTitle: (title) =>
    set((state) => ({
      take: touched({ ...state.take, title }),
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
    })),

  setTempo: (tempo) =>
    set((state) => ({
      take: touched({ ...state.take, tempo }),
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
      contentRevision: state.contentRevision + 1,
    })),

  setInstrumentSettings: (instrument) =>
    set((state) => ({
      take: touched({ ...state.take, instrument }),
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
      contentRevision: state.contentRevision + 1,
    })),

  setPlayheadMs: (playheadMs) =>
    set((state) => ({
      take: { ...state.take, display: { ...state.take.display, playheadMs } },
      // An empty take's playhead isn't worth creating a draft row for.
      dirty: state.dirty || state.take.notes.length > 0,
      mutationGeneration: state.mutationGeneration + 1,
    })),

  setDisplayQuantization: (quantization) =>
    set((state) => ({
      // Display-only change: saves, but never invalidates cached audio.
      take: { ...state.take, display: { ...state.take.display, quantization } },
      dirty: true,
      mutationGeneration: state.mutationGeneration + 1,
    })),

  markSaved: (takeId, generation) =>
    set((state) => {
      if (state.take.id !== takeId || state.mutationGeneration !== generation) return state;
      return { dirty: false, savedGeneration: generation };
    }),
}));
