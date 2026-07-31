import { create } from 'zustand';
import { audioEngine } from '@/audio/AudioEngine';
import { DEFAULT_PIANO_INSTRUMENT_ID, type PianoInstrumentId } from '@/audio/instruments';
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  type QuantizationSetting,
} from '@/domain/takeTypes';
import { DEFAULT_ANCHOR_MIDI } from '@/features/keyboard/keyboardGeometry';
import { DEFAULT_LIBRARY_FOLDER, type LibraryFolderId } from '@/features/library/folders';
import type { PaperSize } from '@/features/notation/sheetLayout';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/i18n/types';

export type VelocityMode = 'touch' | 'fixed';

/** UI theme preference; resolved to dark/light by src/app/theme.ts. */
export type ThemePreference = 'dark' | 'light' | 'system';

export interface SettingsState {
  language: SupportedLanguage;
  theme: ThemePreference;
  /** Which sampled piano plays; see src/audio/instruments.ts. */
  pianoInstrument: PianoInstrumentId;
  masterVolume: number;
  reverbMix: number;
  velocityMode: VelocityMode;
  fixedVelocity: number;
  showNoteLabels: boolean;
  scrubAudition: boolean;
  /** Keep recorded-take playback running while the page is hidden. */
  backgroundPlayback: boolean;
  metronomeVolume: number;
  displayQuantization: QuantizationSetting;
  keyboardAnchorMidi: number;
  sheetPaperSize: PaperSize;
  /** The library folder last opened, restored on the next visit. */
  libraryFolder: LibraryFolderId;

  setLanguage(language: SupportedLanguage): void;
  setTheme(theme: ThemePreference): void;
  setPianoInstrument(id: PianoInstrumentId): void;
  setMasterVolume(value: number): void;
  setReverbMix(value: number): void;
  setVelocityMode(mode: VelocityMode): void;
  setFixedVelocity(value: number): void;
  setShowNoteLabels(show: boolean): void;
  setScrubAudition(enabled: boolean): void;
  setBackgroundPlayback(enabled: boolean): void;
  setMetronomeVolume(value: number): void;
  setDisplayQuantization(value: QuantizationSetting): void;
  setKeyboardAnchorMidi(midi: number): void;
  setSheetPaperSize(size: PaperSize): void;
  setLibraryFolder(folder: LibraryFolderId): void;
  resetSettings(): void;
}

export const SETTINGS_DEFAULTS = {
  language: DEFAULT_LANGUAGE as SupportedLanguage,
  theme: 'dark' as ThemePreference,
  pianoInstrument: DEFAULT_PIANO_INSTRUMENT_ID as PianoInstrumentId,
  masterVolume: DEFAULT_MASTER_VOLUME,
  reverbMix: DEFAULT_REVERB_MIX,
  velocityMode: 'touch' as VelocityMode,
  fixedVelocity: 0.75,
  showNoteLabels: true,
  scrubAudition: true,
  backgroundPlayback: false,
  metronomeVolume: 0.6,
  displayQuantization: '1/16' as QuantizationSetting,
  keyboardAnchorMidi: DEFAULT_ANCHOR_MIDI,
  sheetPaperSize: 'a4' as PaperSize,
  libraryFolder: DEFAULT_LIBRARY_FOLDER,
};

/**
 * App settings. Persistence to Dexie is layered on by the data slice; the
 * store itself stays synchronous for render use. Nothing here talks to the
 * audio engine for the levels — src/data/persistence.ts subscribes and pushes
 * them, so a restored backup (which writes the store with setState) is carried
 * over too.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  ...SETTINGS_DEFAULTS,

  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setPianoInstrument: (pianoInstrument) => {
    set({ pianoInstrument });
    void audioEngine.setInstrument(pianoInstrument);
  },
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  setReverbMix: (reverbMix) => set({ reverbMix }),
  setVelocityMode: (velocityMode) => set({ velocityMode }),
  setFixedVelocity: (fixedVelocity) => set({ fixedVelocity }),
  setShowNoteLabels: (showNoteLabels) => set({ showNoteLabels }),
  setScrubAudition: (scrubAudition) => set({ scrubAudition }),
  setBackgroundPlayback: (backgroundPlayback) => set({ backgroundPlayback }),
  setMetronomeVolume: (metronomeVolume) => set({ metronomeVolume }),
  setDisplayQuantization: (displayQuantization) => set({ displayQuantization }),
  setKeyboardAnchorMidi: (keyboardAnchorMidi) => set({ keyboardAnchorMidi }),
  setSheetPaperSize: (sheetPaperSize) => set({ sheetPaperSize }),
  setLibraryFolder: (libraryFolder) => set({ libraryFolder }),
  resetSettings: () => {
    void audioEngine.setInstrument(SETTINGS_DEFAULTS.pianoInstrument);
    set({ ...SETTINGS_DEFAULTS });
  },
}));
