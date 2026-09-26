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
  | 'sheetExportFailed'
  | 'importUrlInvalid'
  | 'importUrlOffline'
  | 'importUrlBlocked'
  | 'importUrlTimedOut'
  | 'importUrlFailed';

/** A structured repair record produced by take import, translated for display. */
export type RepairCode =
  | 'takeId'
  | 'title'
  | 'timestamp'
  | 'samplePackVersion'
  | 'tempoDefaulted'
  | 'bpmClamped'
  | 'countInClamped'
  | 'tempoChangesRepaired'
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
 * One entry per Learn chapter, keyed by chapter id. Declaring the keys here
 * rather than as a `Record<string, string>` is what makes a missing chapter
 * title a compile error in all four locales — the same trick
 * `library.descriptions` uses. Chapters are listed in curriculum order.
 */
export interface LearnChapterMessages {
  // Beginner
  meetTheKeyboard: string;
  musicalAlphabet: string;
  halfStepsWholeSteps: string;
  trebleStaff: string;
  bassAndGrandStaff: string;
  rhythmAndBeat: string;
  firstMelody: string;
  cMajorScale: string;
  triads: string;
  chordsPedalAndHands: string;
  // Intermediate
  howToPractise: string;
  keySignatures: string;
  scalesBeyondC: string;
  minorKeys: string;
  intervals: string;
  inversions: string;
  rhythmBeyondFourFour: string;
  arpeggios: string;
  accompanimentPatterns: string;
  dynamicsAndArticulation: string;
  // Advanced
  seventhChords: string;
  functionalHarmony: string;
  modes: string;
  twoHandIndependence: string;
  ornaments: string;
  sightReading: string;
  playingByEar: string;
  songForm: string;
  leadSheets: string;
  improvising: string;
}

/**
 * The three named parts each level is divided into, so ten chapters read as a
 * journey rather than a list. Same compile-enforced-keys trick as above.
 */
export interface LearnPartMessages {
  // Beginner
  theInstrument: string;
  readingMusic: string;
  playing: string;
  // Intermediate
  gettingSerious: string;
  harmonyBuildingBlocks: string;
  playingWithStyle: string;
  // Advanced
  richerHarmony: string;
  independenceAndControl: string;
  makingItYourOwn: string;
}

/**
 * The full message catalog. Static entries are strings; dynamic entries are
 * typed functions so each locale owns its own interpolation and pluralization.
 * Declaring this as an interface makes every locale object compile-time-checked
 * for completeness and signature match — a missing key fails `tsc`.
 */
export interface Messages {
  workflow: {
    listen: string;
    practiceLeft: string;
    practiceRight: string;
    practiceBoth: string;
    practiceHint: string;
    returnToPractice: string;
    recording: string;
    clickVolume: string;
    tempoHint: string;
    searchTakes: string;
    noTakesMatch: string;
    clearSearch: string;
    upcoming: string;
    updateAvailable: string;
    availableLessons: (p: { count: number }) => string;
  };
  nav: {
    play: string;
    learn: string;
    library: string;
    takes: string;
    settings: string;
    about: string;
    mainLabel: string;
    nowPlaying: string;
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
    retryLoadingPiano: string;
    audioUnavailable: string;
    recordingInterrupted: string;
  };
  share: {
    trigger: string;
    menuLabel: string;
    audio: string;
    sheet: string;
    midi: string;
    /** Names of a MIDI file's two tracks, which a sequencer shows. */
    rightHandTrack: string;
    leftHandTrack: string;
  };
  transport: {
    groupLabel: string;
    returnToStart: string;
    recordActive: string;
    recordInactive: string;
    pause: string;
    resume: string;
    play: string;
    stop: string;
    undoLastPass: string;
    undoPass: string;
    modes: string;
    modesMenu: string;
    recordingMode: string;
    overdub: string;
    replace: string;
    replaceConfirm: string;
    playbackMode: string;
    simple: string;
    trainingLeft: string;
    trainingRight: string;
    trainingBoth: string;
    waitingForYou: string;
    countIn: string;
    recording: string;
    emptyHint: string;
    seekPosition: string;
    speed: string;
    /** The speed menu's accessible name, with the speed in use. */
    speedLabel: (p: { percent: number }) => string;
    speedChoice: (p: { percent: number }) => string;
    loopStart: string;
    loopEnd: (p: { from: string }) => string;
    loopClear: (p: { from: string; to: string }) => string;
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
    moreControls: string;
    /** Shown when the tempo field will change the tempo from a bar onward. */
    tempoFromBar: (p: { bar: number }) => string;
  };
  piano: {
    shiftDown: string;
    shiftUp: string;
    shiftDownKey: string;
    shiftUpKey: string;
    sustain: string;
    keyLabel: (p: { note: string }) => string;
  };
  score: {
    label: (p: { count: number }) => string;
    displayQuantization: string;
    noGrid: string;
    grid8: string;
    grid16: string;
    grid32: string;
    grid64: string;
    emptyHint: string;
    zoom: string;
    zoomIn: string;
    zoomOut: string;
  };
  takes: {
    title: string;
    newTake: string;
    importTrigger: string;
    importMenuLabel: string;
    importJson: string;
    importMxl: string;
    importUrl: string;
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
    folderLabel: string;
    folders: {
      originals: string;
      classics: string;
    };
    byline: (p: { composer: string }) => string;
    openLabel: (p: { title: string }) => string;
    meta: (p: { notes: number; duration: string; bpm: number }) => string;
    groupCount: (p: { count: number }) => string;
    filterLabel: string;
    filterPlaceholder: string;
    filterClear: string;
    filterEmpty: (p: { query: string }) => string;
    forkHint: string;
    opening: string;
    openFailed: string;
    descriptions: {
      aBeautifulDay: string;
      eveningTide: string;
      forwardGently: string;
      crookedLanternWaltz: string;
      furElise: string;
      odeToJoyFirstSteps: string;
      gymnopedie1: string;
      bluesInC: string;
      goodNight: string;
      moonlightSonata: string;
      whereStarlightLingers: string;
      silverwoodTale: string;
    };
  };
  learn: {
    title: string;
    hint: string;
    levelLabel: string;
    levels: {
      beginner: string;
      intermediate: string;
      advanced: string;
    };
    chapterNumber: (p: { order: number }) => string;
    openLabel: (p: { title: string }) => string;
    lockedLabel: (p: { title: string }) => string;
    comingSoon: string;
    completed: string;
    resumeAt: (p: { step: number }) => string;
    stepOf: (p: { step: number; steps: number }) => string;
    progress: (p: { done: number; total: number }) => string;
    exerciseDone: string;
    listen: string;
    showMe: string;
    skipStep: string;
    tryAgain: string;
    next: string;
    back: string;
    finish: string;
    close: string;
    /** Shown when the exercise still needs notes but none are on screen. */
    shiftHint: string;
    /** A chord is in and the pedal is due: pressed for the first time, or changed. */
    pedalPress: string;
    pedalChange: string;
    /** A step needs more keys than a phone held upright can show. */
    rotateHint: string;
    loadingPiano: string;
    loadingChapter: string;
    diagramLabel: string;
    staffLabel: string;
    tryOnPlay: string;
    /** A chapter's closing hand-off: open its piece on Play, in Training. */
    practiseOnPlay: (p: { title: string }) => string;
    practiseOnPlayHint: string;
    /** The same, for a hand-off that also slows the piece and loops the bars practised. */
    practiseOnPlayToolsHint: (p: { speed: number }) => string;
    backToChapters: string;
    /** Recognition steps: a key lights up and the user names it. */
    quizPrompt: string;
    quizCorrect: string;
    quizWrong: (p: { answer: string }) => string;
    quizAnswerLabel: (p: { note: string }) => string;
    /** Drill steps: the app names a note and the user finds it. */
    playNote: (p: { note: string }) => string;
    /** A drill round that names a scale degree rather than a note. */
    playDegree: (p: { degree: number }) => string;
    /** The same, in a key the round names: `key` is already words, from `majorKey`. */
    playDegreeInKey: (p: { key: string; degree: number }) => string;
    /** Reading rounds, where the question is a staff rather than a name. */
    readNotePrompt: string;
    playWhatYouSee: string;
    /** A triad's quality as a word inside a sentence: the "minor" of "A minor". */
    chordQuality: { major: string; minor: string };
    /** The same, standing alone on an answer button. */
    chordQualityAnswer: { major: string; minor: string };
    /** A triad's name from its root and quality words, in the locale's order. */
    chordName: (p: { note: string; quality: string }) => string;
    /** A drill round that names a chord. */
    playChord: (p: { chord: string }) => string;
    /** Ear rounds: the button that plays the chord in question. */
    hearIt: string;
    chordQualityPrompt: string;
    chordQualityWrong: (p: { answer: string }) => string;
    /** Key-signature rounds: a signature is drawn and the user names its major key. */
    keySignaturePrompt: string;
    /**
     * A major key by its home note, in the words the locale uses for a key —
     * not always the ones it uses for a chord.
     */
    majorKey: (p: { note: string }) => string;
    keySignatureWrong: (p: { key: string }) => string;
    /**
     * What a signature drawn alone shows, for a screen reader: sharps positive,
     * flats negative. Saying "two sharps" states the question, not its answer.
     */
    keySignatureLabel: (p: { fifths: number }) => string;
    /** A drill round that draws a signature and asks for its key's home note. */
    playTonic: string;
    circleLabel: string;
    chapterTitles: LearnChapterMessages;
    chapterBlurbs: LearnChapterMessages;
    partTitles: LearnPartMessages;
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
  importUrlDialog: {
    title: string;
    urlLabel: string;
    placeholder: string;
    hint: string;
    loading: string;
    httpError: (p: { status: number }) => string;
    useFilePicker: string;
    cancel: string;
    fetch: string;
  };
  exportDialog: {
    title: string;
    quality: string;
    shareable: (p: { kbps: number }) => string;
    high: (p: { kbps: number }) => string;
    loudness: string;
    loudnessNormalized: string;
    loudnessAsPlayed: string;
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
    grid32: string;
    grid64: string;
    gridHint: string;
    keySignature: string;
    /** Both tonics already carry their own accidental signs, e.g. "E♭". */
    keyName: (p: { major: string; minor: string }) => string;
    keyHint: string;
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
    appearance: string;
    theme: string;
    themeDark: string;
    themeLight: string;
    themeSystem: string;
    playing: string;
    storage: string;
    app: string;
    diagnostics: string;
    reset: string;
    piano: string;
    pianoHint: string;
    pianoSalamanderDesc: string;
    pianoHeadroomDesc: string;
    pianoBitklavierDesc: string;
    pianoWurlitzerDesc: string;
    pianoSwitching: string;
    pianoVolume: string;
    reverb: string;
    velocity: string;
    velocityTouch: string;
    velocityFixed: string;
    fixedVelocity: string;
    touchSensitivity: string;
    touchSensitivityLight: string;
    touchSensitivityNormal: string;
    touchSensitivityFirm: string;
    touchSensitivityHint: string;
    accentHint: string;
    midiVelocityCurve: string;
    midiCurveLight: string;
    midiCurveNormal: string;
    midiCurveHeavy: string;
    midiCurveHint: string;
    midiVelocityRange: string;
    midiRangeNone: string;
    midiRangeSet: (p: { min: number; max: number }) => string;
    midiCalibrate: string;
    midiCalibrateReset: string;
    midiCalibrateCancel: string;
    midiCalibrateSoftest: string;
    midiCalibrateLoudest: (p: { softest: number }) => string;
    midiCalibrateRejected: string;
    noteLabels: string;
    followPlayback: string;
    scrubAudition: string;
    backgroundPlayback: string;
    backgroundPlaybackHint: string;
    gamepad: string;
    gamepadHint: string;
    midi: string;
    midiHint: string;
    midiConnect: string;
    midiConnecting: string;
    midiDenied: string;
    midiUnsupported: string;
    midiNoDevices: string;
    midiDevices: (p: { names: string }) => string;
    midiError: string;
    checking: string;
    downloadPiano: (p: { piano: string; size: string }) => string;
    deletePiano: (p: { piano: string }) => string;
    retryPiano: (p: { piano: string }) => string;
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
      gamepad: string;
      webMidi: string;
    };
  };
  about: {
    title: string;
    intro: string;
    online: string;
    offline: string;
    swReady: string;
    swNotReady: string;
    featuresTitle: string;
    features: readonly { title: string; body: string }[];
    privacyTitle: string;
    privacyBody: string;
    backgroundHint: string;
    installTitle: string;
    installBody: string;
    credits: string;
    creditLine: string;
    attribution: string;
    /** Followed by links to the dataset's DOI and to the licence. */
    bitklavierAttribution: string;
    wurlitzerAttribution: string;
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
    tempoChangesRepaired: string;
    instrumentDefaulted: string;
    noteTimingRounded: string;
    noteIdsAssigned: (p: { count: number }) => string;
    displayReset: string;
  };
  /** Native language names shown in the Language dropdown. */
  languageNames: Record<SupportedLanguage, string>;
}
