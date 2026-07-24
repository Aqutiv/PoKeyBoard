/**
 * i18n contracts. This module is a dependency-free leaf: it imports nothing,
 * so both the UI catalogs and the non-React error/domain modules can share the
 * `ErrorMessageKey` / `RepairCode` unions without creating an import cycle.
 */

export type SupportedLanguage = 'en' | 'es' | 'fr' | 'mg';

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['en', 'es', 'fr', 'mg'];

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly unknown[]).includes(value);
}

/** Stable ids for user-facing error messages, translated at the render site. */
export type ErrorMessageKey =
  | 'generic'
  | 'notValidTake'
  | 'notValidScore'
  | 'storageFailed'
  | 'storageFull'
  | 'audioUnavailable'
  | 'exportFailed'
  | 'exportCancelled'
  | 'exportEncodingInvalid'
  | 'exportEmpty'
  | 'exportTooLong'
  | 'exportPianoLoading'
  | 'sheetExportFailed';

/** A structured repair record produced by take import, translated for display. */
export type RepairCode =
  | 'takeId'
  | 'title'
  | 'timestamp'
  | 'samplePackVersion'
  | 'tempoDefaulted'
  | 'bpmClamped'
  | 'countInClamped'
  | 'instrumentDefaulted'
  | 'noteTimingRounded'
  | 'noteIdsAssigned'
  | 'displayReset';

export interface Repair {
  code: RepairCode;
  /** For 'timestamp': the offending field name (createdAt/updatedAt). */
  field?: string;
  /** For 'noteIdsAssigned': how many ids were generated. */
  count?: number;
}

/**
 * The full message catalog. Static entries are strings; dynamic entries are
 * typed functions so each locale owns its own interpolation and pluralization.
 * Declaring this as an interface makes every locale object compile-time-checked
 * for completeness and signature match — a missing key fails `tsc`.
 */
export interface Messages {
  nav: {
    play: string;
    library: string;
    takes: string;
    settings: string;
    about: string;
    mainLabel: string;
  };
  save: {
    failed: string;
    retry: string;
    saving: string;
    savedLocally: string;
  };
  play: {
    pageLabel: string;
    viewLabel: string;
    notationView: string;
    keyboardView: string;
    dismiss: string;
    loadingPiano: (p: { percent: number }) => string;
    audioUnavailable: string;
    recordingInterrupted: string;
  };
  share: {
    trigger: string;
    menuLabel: string;
    audio: string;
    sheet: string;
  };
  transport: {
    groupLabel: string;
    returnToStart: string;
    recordActive: string;
    recordInactive: string;
    pause: string;
    play: string;
    stop: string;
    undoLastPass: string;
    undoPass: string;
    recordingMode: string;
    overdub: string;
    replace: string;
    replaceConfirm: string;
    countIn: string;
    recording: string;
    emptyHint: string;
    seekPosition: string;
  };
  metronome: {
    groupLabel: string;
    on: (p: { bpm: number }) => string;
    off: string;
    decreaseTempo: string;
    increaseTempo: string;
    bpmLabel: string;
    tap: string;
    timeSignatureLabel: string;
    countInLabel: string;
    noCountIn: string;
    oneBar: string;
    twoBars: string;
    volumeLabel: string;
  };
  piano: {
    shiftDown: string;
    shiftUp: string;
    sustain: string;
    keyLabel: (p: { note: string }) => string;
  };
  score: {
    label: (p: { count: number }) => string;
    displayQuantization: string;
    noGrid: string;
    grid8: string;
    grid16: string;
    emptyHint: string;
  };
  takes: {
    title: string;
    newTake: string;
    importJson: string;
    importMxl: string;
    loading: string;
    empty: string;
    draft: string;
    currentlyOpen: string;
    openLabel: (p: { title: string }) => string;
    moreActionsLabel: (p: { title: string }) => string;
    meta: (p: { notes: number; duration: string; bpm: number; updated: string }) => string;
    newTitle: string;
    rename: string;
    duplicate: string;
    exportJson: string;
    shareJson: string;
    clearNotes: string;
    delete: string;
    backupAll: string;
    restoreBackup: string;
    importFileLabel: string;
    importMxlFileLabel: string;
    restoreFileLabel: string;
    removeNotesConfirm: (p: { title: string }) => string;
    deleteConfirm: (p: { title: string }) => string;
    duplicated: string;
    shared: string;
    downloaded: string;
    notesCleared: string;
    deleted: string;
    backupDownloaded: string;
    takeImported: string;
    backupRestored: (p: { imported: number; skipped: number; settingsRestored: boolean }) => string;
  };
  library: {
    title: string;
    hint: string;
    chip: string;
    byline: (p: { composer: string }) => string;
    openLabel: (p: { title: string }) => string;
    meta: (p: { notes: number; duration: string; bpm: number }) => string;
    forkHint: string;
    descriptions: {
      aBeautifulDay: string;
      furElise: string;
      gymnopedie1: string;
      bluesInC: string;
      goodNight: string;
      moonlightSonata: string;
    };
  };
  importDialog: {
    title: string;
    titleLabel: string;
    duration: string;
    notes: string;
    tempo: string;
    tempoValue: (p: { bpm: number; numerator: number; denominator: number }) => string;
    repairsHeading: string;
    collisionLegend: string;
    importAsCopy: string;
    replaceExisting: string;
    cancel: string;
    import: string;
  };
  exportDialog: {
    title: string;
    quality: string;
    shareable: (p: { kbps: number }) => string;
    high: (p: { kbps: number }) => string;
    includeMetronome: string;
    reverbNote: string;
    longTakeWarning: (p: { mb: number }) => string;
    cancel: string;
    renderAudio: string;
    stageSaving: string;
    stageRendering: string;
    stageEncoding: string;
    summary: (p: { title: string; duration: string }) => string;
    ready: (p: { fromCache: boolean; size: string; duration: string }) => string;
    playPreview: string;
    deleteCached: string;
    downloadMp3: string;
    shareAudio: string;
    close: string;
    back: string;
    cachedDeleted: string;
    delivered: string;
    deliveredNoShare: string;
    errorCouldNotLoad: string;
    errorStopPlayback: string;
  };
  sheetDialog: {
    title: string;
    summary: (p: { title: string; measures: number }) => string;
    paperSize: string;
    paperA4: string;
    paperLetter: string;
    grid: string;
    grid8: string;
    grid16: string;
    gridHint: string;
    previewLabel: string;
    pageEstimate: (p: { pages: number }) => string;
    generate: string;
    workingLayout: string;
    workingPage: (p: { page: number; pages: number }) => string;
    workingAssemble: string;
    ready: (p: { pages: number; size: string }) => string;
    downloadPdf: string;
    sharePdf: string;
    cancel: string;
    close: string;
    back: string;
    delivered: string;
    deliveredNoShare: string;
    errorCouldNotLoad: string;
    tooManyPages: (p: { pages: number; max: number }) => string;
  };
  settings: {
    title: string;
    language: string;
    sound: string;
    playing: string;
    offlinePiano: string;
    storage: string;
    install: string;
    updates: string;
    diagnostics: string;
    reset: string;
    pianoVolume: string;
    reverb: string;
    velocity: string;
    velocityTouch: string;
    velocityFixed: string;
    fixedVelocity: string;
    noteLabels: string;
    scrubAudition: string;
    checking: string;
    downloadPrompt: (p: { size: string }) => string;
    downloadButton: string;
    deleteSamples: string;
    tryAgain: string;
    couldNotCheck: string;
    downloadFailed: string;
    downloading: (p: { loaded: string; total: string }) => string;
    fullOffline: (p: { size: string }) => string;
    persistGranted: string;
    persistNotGranted: string;
    persistUnknown: string;
    storageUsing: (p: { usage: string; quota: string }) => string;
    takesLocalHint: string;
    runningInstalled: string;
    installApp: string;
    installHintPre: string;
    addToHomeScreen: string;
    installHintPost: string;
    updateReady: string;
    finishPlaying: string;
    applyUpdate: string;
    upToDate: (p: { version: string }) => string;
    outputLatency: (p: { ms: number }) => string;
    iphoneHint: string;
    resetSettings: string;
    deleteSamplesConfirm: string;
    resetConfirm: string;
    capabilities: {
      standaloneDisplayMode: string;
      beforeInstallPrompt: string;
      share: string;
      shareFiles: string;
      storagePersist: string;
      storageEstimate: string;
      fileSystemAccess: string;
      wakeLock: string;
      audioWorklet: string;
      webCodecsAudioEncoder: string;
      pointerEvents: string;
      touch: string;
    };
  };
  about: {
    title: string;
    intro: string;
    online: string;
    offline: string;
    swReady: string;
    swNotReady: string;
    backgroundHint: string;
    credits: string;
    creditLine: string;
    attribution: string;
    version: (p: { version: string }) => string;
  };
  errors: Record<ErrorMessageKey, string>;
  repairs: {
    takeId: string;
    title: string;
    timestamp: (p: { field: string }) => string;
    samplePackVersion: string;
    tempoDefaulted: string;
    bpmClamped: string;
    countInClamped: string;
    instrumentDefaulted: string;
    noteTimingRounded: string;
    noteIdsAssigned: (p: { count: number }) => string;
    displayReset: string;
  };
  /** Native language names shown in the Language dropdown. */
  languageNames: Record<SupportedLanguage, string>;
}
