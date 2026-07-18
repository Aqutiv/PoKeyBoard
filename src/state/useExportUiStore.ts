import { create } from 'zustand';

interface ExportUiState {
  /** Take id the audio export dialog is open for, or null. */
  requestedTakeId: string | null;
  /** Take id the sheet-music export dialog is open for, or null. */
  sheetRequestedTakeId: string | null;
  openExport(takeId: string): void;
  closeExport(): void;
  openSheetExport(takeId: string): void;
  closeSheetExport(): void;
}

export const useExportUiStore = create<ExportUiState>()((set) => ({
  requestedTakeId: null,
  sheetRequestedTakeId: null,
  // Opening either dialog closes the other so only one modal shows at a time.
  openExport: (takeId) => set({ requestedTakeId: takeId, sheetRequestedTakeId: null }),
  closeExport: () => set({ requestedTakeId: null }),
  openSheetExport: (takeId) => set({ sheetRequestedTakeId: takeId, requestedTakeId: null }),
  closeSheetExport: () => set({ sheetRequestedTakeId: null }),
}));
