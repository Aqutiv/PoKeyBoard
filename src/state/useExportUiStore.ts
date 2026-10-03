import { create } from 'zustand';

interface ExportUiState {
  /** Take id the audio export dialog is open for, or null. */
  requestedTakeId: string | null;
  /** Take id the sheet-music export dialog is open for, or null. */
  sheetRequestedTakeId: string | null;
  /** Take id the share link dialog is open for, or null. */
  linkRequestedTakeId: string | null;
  openExport(takeId: string): void;
  closeExport(): void;
  openSheetExport(takeId: string): void;
  closeSheetExport(): void;
  openLinkShare(takeId: string): void;
  closeLinkShare(): void;
}

/** No dialog open: what opening one starts from, so only one modal shows at a time. */
const NONE = { requestedTakeId: null, sheetRequestedTakeId: null, linkRequestedTakeId: null };

export const useExportUiStore = create<ExportUiState>()((set) => ({
  ...NONE,
  openExport: (takeId) => set({ ...NONE, requestedTakeId: takeId }),
  closeExport: () => set({ requestedTakeId: null }),
  openSheetExport: (takeId) => set({ ...NONE, sheetRequestedTakeId: takeId }),
  closeSheetExport: () => set({ sheetRequestedTakeId: null }),
  openLinkShare: (takeId) => set({ ...NONE, linkRequestedTakeId: takeId }),
  closeLinkShare: () => set({ linkRequestedTakeId: null }),
}));
