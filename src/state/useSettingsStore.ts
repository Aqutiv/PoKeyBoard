import { create } from 'zustand';
import { audioEngine } from '@/audio/AudioEngine';
import type { ExportBitrateKbps, ExportFormat, FlacBitDepth } from '@/audio/exportFormats';
import { DEFAULT_PIANO_INSTRUMENT_ID, type PianoInstrumentId } from '@/audio/instruments';
import type { LoudnessMode } from '@/audio/loudness';
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
import { DEFAULT_PLAY_VIEW, type PlayView } from '@/features/play/playView';
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
  /**
   * A grand's tone follows the touch through each velocity layer, live and in
   * exports, rather than stepping where one recording hands over to the next;
   * see SampleBank.getSample.
   */
  toneFollowsTouch: boolean;
  velocityMode: VelocityMode;
  fixedVelocity: number;
  /** How far down a key a touch has to land to play loud; see velocityResponse.ts. */
  touchSensitivity: TouchSensitivity;
  /** How a MIDI keyboard's own velocity is bent before it plays. */
  midiVelocityCurve: MidiVelocityCurve;
  /** The MIDI keyboard's calibrated softest and loudest, or null to read it as sent. */
  midiVelocityRange: MidiVelocityRange | null;
  showNoteLabels: boolean;
  /**
   * Lit keys are shaded by how hard their note is played, live and in
   * playback, rather than all alike; see keyShading.ts.
   */
  velocityShading: boolean;
  /** Slide the Play keyboard to where playback is playing. */
  keyboardFollowsPlayback: boolean;
  /** What the Play page shows above the keys: the score, or the falling notes. */
  playView: PlayView;
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
  /** The audio export's format, and each format's quality, as last chosen. */
  audioExportFormat: ExportFormat;
  audioExportMp3Kbps: ExportBitrateKbps;
  audioExportFlacBits: FlacBitDepth;
  /** The audio export's level, as last chosen; see src/audio/loudness.ts. */
  audioExportLoudness: LoudnessMode;
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
  setToneFollowsTouch(enabled: boolean): void;
  setVelocityMode(mode: VelocityMode): void;
  setFixedVelocity(value: number): void;
  setTouchSensitivity(sensitivity: TouchSensitivity): void;
  setMidiVelocityCurve(curve: MidiVelocityCurve): void;
  setMidiVelocityRange(range: MidiVelocityRange | null): void;
  setShowNoteLabels(show: boolean): void;
  setVelocityShading(enabled: boolean): void;
  setKeyboardFollowsPlayback(follow: boolean): void;
  setPlayView(view: PlayView): void;
  setScrubAudition(enabled: boolean): void;
  setBackgroundPlayback(enabled: boolean): void;
  setGamepadInput(enabled: boolean): void;
  setMidiInput(enabled: boolean): void;
  setMetronomeVolume(value: number): void;
  setKeyboardAnchorMidi(midi: number): void;
  setSheetPaperSize(size: PaperSize): void;
  setAudioExportFormat(format: ExportFormat): void;
  setAudioExportMp3Kbps(kbps: ExportBitrateKbps): void;
  setAudioExportFlacBits(bits: FlacBitDepth): void;
  setAudioExportLoudness(loudness: LoudnessMode): void;
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
  toneFollowsTouch: true,
  velocityMode: 'touch' as VelocityMode,
  fixedVelocity: 0.75,
  touchSensitivity: 'normal' as TouchSensitivity,
  midiVelocityCurve: 'normal' as MidiVelocityCurve,
  midiVelocityRange: null as MidiVelocityRange | null,
  showNoteLabels: true,
  velocityShading: true,
  keyboardFollowsPlayback: true,
  playView: DEFAULT_PLAY_VIEW,
  scrubAudition: true,
  backgroundPlayback: false,
  gamepadInput: true,
  midiInput: false,
  metronomeVolume: 0.6,
  keyboardAnchorMidi: DEFAULT_ANCHOR_MIDI,
  sheetPaperSize: 'a4' as PaperSize,
  audioExportFormat: 'mp3' as ExportFormat,
  audioExportMp3Kbps: 128 as ExportBitrateKbps,
  audioExportFlacBits: 16 as FlacBitDepth,
  audioExportLoudness: 'normalized' as LoudnessMode,
  libraryFolder: DEFAULT_LIBRARY_FOLDER,
  learnLevel: DEFAULT_LEARN_LEVEL,
  recordMode: 'overdub' as RecordMode,
  playbackMode: 'simple' as PlaybackMode,
};

/**
 * App settings. Persistence to Dexie is layered on by the data slice; the
 * store itself stays synchronous for render use. Nothing here talks to the
 * audio engine for the levels, the room or the tone — src/data/persistence.ts
 * subscribes and pushes them, so a restored backup (which writes the store
 * with setState) is carried over too.
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
  setToneFollowsTouch: (toneFollowsTouch) => set({ toneFollowsTouch }),
  setVelocityMode: (velocityMode) => set({ velocityMode }),
  setFixedVelocity: (fixedVelocity) => set({ fixedVelocity }),
  setTouchSensitivity: (touchSensitivity) => set({ touchSensitivity }),
  setMidiVelocityCurve: (midiVelocityCurve) => set({ midiVelocityCurve }),
  setMidiVelocityRange: (midiVelocityRange) => set({ midiVelocityRange }),
  setShowNoteLabels: (showNoteLabels) => set({ showNoteLabels }),
  setVelocityShading: (velocityShading) => set({ velocityShading }),
  setKeyboardFollowsPlayback: (keyboardFollowsPlayback) => set({ keyboardFollowsPlayback }),
  setPlayView: (playView) => set({ playView }),
  setScrubAudition: (scrubAudition) => set({ scrubAudition }),
  setBackgroundPlayback: (backgroundPlayback) => set({ backgroundPlayback }),
  setGamepadInput: (gamepadInput) => set({ gamepadInput }),
  setMidiInput: (midiInput) => set({ midiInput }),
  setMetronomeVolume: (metronomeVolume) => set({ metronomeVolume }),
  setKeyboardAnchorMidi: (keyboardAnchorMidi) => set({ keyboardAnchorMidi }),
  setSheetPaperSize: (sheetPaperSize) => set({ sheetPaperSize }),
  setAudioExportFormat: (audioExportFormat) => set({ audioExportFormat }),
  setAudioExportMp3Kbps: (audioExportMp3Kbps) => set({ audioExportMp3Kbps }),
  setAudioExportFlacBits: (audioExportFlacBits) => set({ audioExportFlacBits }),
  setAudioExportLoudness: (audioExportLoudness) => set({ audioExportLoudness }),
  setLibraryFolder: (libraryFolder) => set({ libraryFolder }),
  setLearnLevel: (learnLevel) => set({ learnLevel }),
  setRecordMode: (recordMode) => set({ recordMode }),
  setPlaybackMode: (playbackMode) => set({ playbackMode }),
  resetSettings: () => {
    void audioEngine.setInstrument(SETTINGS_DEFAULTS.pianoInstrument);
    set({ ...SETTINGS_DEFAULTS });
  },
}));
