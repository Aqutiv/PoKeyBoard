import { create } from 'zustand';
import { audioEngine } from '@/audio/AudioEngine';
import { DEFAULT_PIANO_INSTRUMENT_ID, type PianoInstrumentId } from '@/audio/instruments';
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  DEFAULT_REVERB_ROOM,
  type ReverbRoom,
} from '@/domain/takeTypes';
import { DEFAULT_ANCHOR_MIDI } from '@/features/keyboard/keyboardGeometry';
import type {
  MidiVelocityCurve,
  MidiVelocityRange,
  TouchSensitivity,
} from '@/features/keyboard/velocityResponse';
import { DEFAULT_LEARN_LEVEL, type LearnLevelId } from '@/features/learn/levels';
import { DEFAULT_LIBRARY_FOLDER, type LibraryFolderId } from '@/features/library/folders';
import type { PlaybackMode, RecordMode } from '@/features/transport/modes';
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
  /** The room the reverb models; see src/audio/reverbImpulse.ts. */
  reverbRoom: ReverbRoom;
  velocityMode: VelocityMode;
  fixedVelocity: number;
  /** How far down a key a touch has to land to play loud; see velocityResponse.ts. */
  touchSensitivity: TouchSensitivity;
  /** How a MIDI keyboard's own velocity is bent before it plays. */
  midiVelocityCurve: MidiVelocityCurve;
  /** The MIDI keyboard's calibrated softest and loudest, or null to read it as sent. */
  midiVelocityRange: MidiVelocityRange | null;
  showNoteLabels: boolean;
  /** Slide the Play keyboard to where playback is playing. */
  keyboardFollowsPlayback: boolean;
  scrubAudition: boolean;
  /** Keep recorded-take playback running while the page is hidden. */
  backgroundPlayback: boolean;
  /** Let a connected game controller play the piano. */
  gamepadInput: boolean;
  /** Let a connected MIDI keyboard play the piano. Off by default: turning it
   *  on is what raises the browser's MIDI permission prompt. */
  midiInput: boolean;
  metronomeVolume: number;
  keyboardAnchorMidi: number;
  sheetPaperSize: PaperSize;
  /** The library folder last opened, restored on the next visit. */
  libraryFolder: LibraryFolderId;
  /** The Learn level last browsed, restored on the next visit. */
  learnLevel: LearnLevelId;
  /** What a recording pass does to what is already there. */
  recordMode: RecordMode;
  /** Straight-through playback, or training on one hand (or both). */
  playbackMode: PlaybackMode;

  setLanguage(language: SupportedLanguage): void;
  setTheme(theme: ThemePreference): void;
  setPianoInstrument(id: PianoInstrumentId): void;
  setMasterVolume(value: number): void;
  setReverbMix(value: number): void;
  setReverbRoom(room: ReverbRoom): void;
  setVelocityMode(mode: VelocityMode): void;
  setFixedVelocity(value: number): void;
  setTouchSensitivity(sensitivity: TouchSensitivity): void;
  setMidiVelocityCurve(curve: MidiVelocityCurve): void;
  setMidiVelocityRange(range: MidiVelocityRange | null): void;
  setShowNoteLabels(show: boolean): void;
  setKeyboardFollowsPlayback(follow: boolean): void;
  setScrubAudition(enabled: boolean): void;
  setBackgroundPlayback(enabled: boolean): void;
  setGamepadInput(enabled: boolean): void;
  setMidiInput(enabled: boolean): void;
  setMetronomeVolume(value: number): void;
  setKeyboardAnchorMidi(midi: number): void;
  setSheetPaperSize(size: PaperSize): void;
  setLibraryFolder(folder: LibraryFolderId): void;
  setLearnLevel(level: LearnLevelId): void;
  setRecordMode(mode: RecordMode): void;
  setPlaybackMode(mode: PlaybackMode): void;
  resetSettings(): void;
}

export const SETTINGS_DEFAULTS = {
  language: DEFAULT_LANGUAGE as SupportedLanguage,
  theme: 'dark' as ThemePreference,
  pianoInstrument: DEFAULT_PIANO_INSTRUMENT_ID as PianoInstrumentId,
  masterVolume: DEFAULT_MASTER_VOLUME,
  reverbMix: DEFAULT_REVERB_MIX,
  reverbRoom: DEFAULT_REVERB_ROOM,
  velocityMode: 'touch' as VelocityMode,
  fixedVelocity: 0.75,
  touchSensitivity: 'normal' as TouchSensitivity,
  midiVelocityCurve: 'normal' as MidiVelocityCurve,
  midiVelocityRange: null as MidiVelocityRange | null,
  showNoteLabels: true,
  keyboardFollowsPlayback: true,
  scrubAudition: true,
  backgroundPlayback: false,
  gamepadInput: true,
  midiInput: false,
  metronomeVolume: 0.6,
  keyboardAnchorMidi: DEFAULT_ANCHOR_MIDI,
  sheetPaperSize: 'a4' as PaperSize,
  libraryFolder: DEFAULT_LIBRARY_FOLDER,
  learnLevel: DEFAULT_LEARN_LEVEL,
  recordMode: 'overdub' as RecordMode,
  playbackMode: 'simple' as PlaybackMode,
};

/**
 * App settings. Persistence to Dexie is layered on by the data slice; the
 * store itself stays synchronous for render use. Nothing here talks to the
 * audio engine for the levels or the room — src/data/persistence.ts subscribes
 * and pushes them, so a restored backup (which writes the store with setState)
 * is carried over too.
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
  setReverbRoom: (reverbRoom) => set({ reverbRoom }),
  setVelocityMode: (velocityMode) => set({ velocityMode }),
  setFixedVelocity: (fixedVelocity) => set({ fixedVelocity }),
  setTouchSensitivity: (touchSensitivity) => set({ touchSensitivity }),
  setMidiVelocityCurve: (midiVelocityCurve) => set({ midiVelocityCurve }),
  setMidiVelocityRange: (midiVelocityRange) => set({ midiVelocityRange }),
  setShowNoteLabels: (showNoteLabels) => set({ showNoteLabels }),
  setKeyboardFollowsPlayback: (keyboardFollowsPlayback) => set({ keyboardFollowsPlayback }),
  setScrubAudition: (scrubAudition) => set({ scrubAudition }),
  setBackgroundPlayback: (backgroundPlayback) => set({ backgroundPlayback }),
  setGamepadInput: (gamepadInput) => set({ gamepadInput }),
  setMidiInput: (midiInput) => set({ midiInput }),
  setMetronomeVolume: (metronomeVolume) => set({ metronomeVolume }),
  setKeyboardAnchorMidi: (keyboardAnchorMidi) => set({ keyboardAnchorMidi }),
  setSheetPaperSize: (sheetPaperSize) => set({ sheetPaperSize }),
  setLibraryFolder: (libraryFolder) => set({ libraryFolder }),
  setLearnLevel: (learnLevel) => set({ learnLevel }),
  setRecordMode: (recordMode) => set({ recordMode }),
  setPlaybackMode: (playbackMode) => set({ playbackMode }),
  resetSettings: () => {
    void audioEngine.setInstrument(SETTINGS_DEFAULTS.pianoInstrument);
    set({ ...SETTINGS_DEFAULTS });
  },
}));
