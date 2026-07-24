import { create } from 'zustand';
import { audioEngine } from '@/audio/AudioEngine';
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  type QuantizationSetting,
} from '@/domain/takeTypes';
import { DEFAULT_ANCHOR_MIDI } from '@/features/keyboard/keyboardGeometry';
import type { PaperSize } from '@/features/notation/sheetLayout';
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/i18n/types';

export type VelocityMode = 'touch' | 'fixed';

/** UI theme preference; resolved to dark/light by src/app/theme.ts. */
export type ThemePreference = 'dark' | 'light' | 'system';

export interface SettingsState {
  language: SupportedLanguage;
  theme: ThemePreference;
  masterVolume: number;
  reverbMix: number;
  velocityMode: VelocityMode;
  fixedVelocity: number;
  showNoteLabels: boolean;
  scrubAudition: boolean;
  metronomeVolume: number;
  displayQuantization: QuantizationSetting;
  keyboardAnchorMidi: number;
  sheetPaperSize: PaperSize;

  setLanguage(language: SupportedLanguage): void;
  setTheme(theme: ThemePreference): void;
  setMasterVolume(value: number): void;
  setReverbMix(value: number): void;
  setVelocityMode(mode: VelocityMode): void;
  setFixedVelocity(value: number): void;
  setShowNoteLabels(show: boolean): void;
  setScrubAudition(enabled: boolean): void;
  setMetronomeVolume(value: number): void;
  setDisplayQuantization(value: QuantizationSetting): void;
  setKeyboardAnchorMidi(midi: number): void;
  setSheetPaperSize(size: PaperSize): void;
  resetSettings(): void;
}

export const SETTINGS_DEFAULTS = {
  language: DEFAULT_LANGUAGE as SupportedLanguage,
  theme: 'dark' as ThemePreference,
  masterVolume: DEFAULT_MASTER_VOLUME,
  reverbMix: DEFAULT_REVERB_MIX,
  velocityMode: 'touch' as VelocityMode,
  fixedVelocity: 0.75,
  showNoteLabels: true,
  scrubAudition: true,
  metronomeVolume: 0.6,
  displayQuantization: '1/16' as QuantizationSetting,
  keyboardAnchorMidi: DEFAULT_ANCHOR_MIDI,
  sheetPaperSize: 'a4' as PaperSize,
};

/**
 * App settings. Persistence to Dexie is layered on by the data slice; the
 * store itself stays synchronous for render use. Volume/reverb setters also
 * push straight into the audio engine.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  ...SETTINGS_DEFAULTS,

  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setMasterVolume: (value) => {
    audioEngine.setMasterVolume(value);
    set({ masterVolume: value });
  },
  setReverbMix: (value) => {
    audioEngine.setReverbMix(value);
    set({ reverbMix: value });
  },
  setVelocityMode: (velocityMode) => set({ velocityMode }),
  setFixedVelocity: (fixedVelocity) => set({ fixedVelocity }),
  setShowNoteLabels: (showNoteLabels) => set({ showNoteLabels }),
  setScrubAudition: (scrubAudition) => set({ scrubAudition }),
  setMetronomeVolume: (metronomeVolume) => set({ metronomeVolume }),
  setDisplayQuantization: (displayQuantization) => set({ displayQuantization }),
  setKeyboardAnchorMidi: (keyboardAnchorMidi) => set({ keyboardAnchorMidi }),
  setSheetPaperSize: (sheetPaperSize) => set({ sheetPaperSize }),
  resetSettings: () => {
    audioEngine.setMasterVolume(SETTINGS_DEFAULTS.masterVolume);
    audioEngine.setReverbMix(SETTINGS_DEFAULTS.reverbMix);
    set({ ...SETTINGS_DEFAULTS });
  },
}));
