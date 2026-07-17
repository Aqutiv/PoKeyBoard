import { create } from 'zustand';

interface ExportUiState {
  /** Take id an export dialog is open for, or null. */
  requestedTakeId: string | null;
  openExport(takeId: string): void;
  closeExport(): void;
}

export const useExportUiStore = create<ExportUiState>()((set) => ({
  requestedTakeId: null,
  openExport: (takeId) => set({ requestedTakeId: takeId }),
  closeExport: () => set({ requestedTakeId: null }),
}));
