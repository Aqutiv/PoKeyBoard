import { create } from 'zustand';
import { computeTakeDurationMs, createEmptyTake, removeNotesByIds, sortNotes } from '@/domain/noteEvents';
import type { NoteEvent, PedalEvent, Take, TempoSettings } from '@/domain/takeTypes';

export interface TakeStoreState {
  take: Take;
  /** Note ids added by the most recent recording pass (undo target). */
  lastPassNoteIds: string[];
  /** Unsaved changes exist (autosave layer watches this). */
  dirty: boolean;
  /**
   * Bumps only when the audible content changes (notes, pedals, tempo,
   * instrument) — the autosave layer invalidates cached export audio when
   * this moves. Title and playhead changes do not bump it.
   */
  contentRevision: number;

  setTake(take: Take, options?: { dirty?: boolean }): void;
  updateTake(mutate: (take: Take) => Take): void;
  appendRecordedNotes(notes: NoteEvent[], pedals: PedalEvent[], passNoteIds: string[]): void;
  undoLastPass(): void;
  clearNotes(): void;
  setTitle(title: string): void;
  setTempo(tempo: TempoSettings): void;
  setPlayheadMs(playheadMs: number): void;
  markSaved(): void;
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
  dirty: false,
  contentRevision: 0,

  setTake: (take, options) => set({ take, lastPassNoteIds: [], dirty: options?.dirty ?? false }),

  updateTake: (mutate) =>
    set((state) => ({
      take: touched(mutate(state.take)),
      dirty: true,
      contentRevision: state.contentRevision + 1,
    })),

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
        dirty: true,
        contentRevision: state.contentRevision + 1,
      };
    }),

  undoLastPass: () =>
    set((state) => {
      if (state.lastPassNoteIds.length === 0) return state;
      const notes = removeNotesByIds(state.take.notes, new Set(state.lastPassNoteIds));
      return {
        take: touched({ ...state.take, notes, durationMs: computeTakeDurationMs(notes) }),
        lastPassNoteIds: [],
        dirty: true,
        contentRevision: state.contentRevision + 1,
      };
    }),

  clearNotes: () =>
    set((state) => ({
      take: touched({ ...state.take, notes: [], pedalEvents: [], durationMs: 0 }),
      lastPassNoteIds: [],
      dirty: true,
      contentRevision: state.contentRevision + 1,
    })),

  setTitle: (title) => set((state) => ({ take: touched({ ...state.take, title }), dirty: true })),

  setTempo: (tempo) =>
    set((state) => ({
      take: touched({ ...state.take, tempo }),
      dirty: true,
      contentRevision: state.contentRevision + 1,
    })),

  setPlayheadMs: (playheadMs) =>
    set((state) => ({
      take: { ...state.take, display: { ...state.take.display, playheadMs } },
      // An empty take's playhead isn't worth creating a draft row for.
      dirty: state.dirty || state.take.notes.length > 0,
    })),

  markSaved: () => set({ dirty: false }),
}));
