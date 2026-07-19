/**
 * Explicit transport state machine (spec §13). All transport behavior flows
 * through `transition`; invalid events return null and change nothing.
 */
export type TransportState =
  | 'idle'
  | 'countIn'
  | 'recording'
  | 'playing'
  | 'paused'
  | 'scrubbing'
  | 'renderingSheet'
  | 'renderingAudio'
  | 'encodingAudio'
  | 'audioReady'
  | 'error';

export type TransportEvent =
  | 'RECORD'
  | 'COUNT_IN_DONE'
  | 'PLAY'
  | 'PAUSE'
  | 'STOP'
  | 'SCRUB_START'
  | 'SCRUB_END'
  | 'SHEET_EXPORT_START'
  | 'SHEET_EXPORT_DONE'
  | 'SHEET_EXPORT_CANCEL'
  | 'EXPORT_START'
  | 'RENDER_DONE'
  | 'ENCODE_DONE'
  | 'DISMISS_AUDIO'
  | 'EXPORT_CANCEL'
  | 'FAIL'
  | 'RESET';

const TRANSITIONS: Record<TransportState, Partial<Record<TransportEvent, TransportState>>> = {
  idle: {
    RECORD: 'countIn',
    PLAY: 'playing',
    SCRUB_START: 'scrubbing',
    SHEET_EXPORT_START: 'renderingSheet',
    EXPORT_START: 'renderingAudio',
    FAIL: 'error',
  },
  countIn: {
    COUNT_IN_DONE: 'recording',
    STOP: 'idle',
    FAIL: 'error',
  },
  recording: {
    STOP: 'idle',
    FAIL: 'error',
  },
  playing: {
    PAUSE: 'paused',
    STOP: 'idle',
    FAIL: 'error',
  },
  paused: {
    PLAY: 'playing',
    RECORD: 'countIn',
    STOP: 'idle',
    SCRUB_START: 'scrubbing',
    SHEET_EXPORT_START: 'renderingSheet',
    EXPORT_START: 'renderingAudio',
    FAIL: 'error',
  },
  scrubbing: {
    SCRUB_END: 'paused',
    STOP: 'idle',
    FAIL: 'error',
  },
  renderingSheet: {
    SHEET_EXPORT_DONE: 'idle',
    SHEET_EXPORT_CANCEL: 'idle',
    FAIL: 'error',
  },
  renderingAudio: {
    RENDER_DONE: 'encodingAudio',
    EXPORT_CANCEL: 'idle',
    FAIL: 'error',
  },
  encodingAudio: {
    ENCODE_DONE: 'audioReady',
    EXPORT_CANCEL: 'idle',
    FAIL: 'error',
  },
  audioReady: {
    DISMISS_AUDIO: 'idle',
    FAIL: 'error',
  },
  error: {
    RESET: 'idle',
  },
};

/** Next state for (state, event), or null when the transition is invalid. */
export function transition(state: TransportState, event: TransportEvent): TransportState | null {
  return TRANSITIONS[state][event] ?? null;
}

export function canTransition(state: TransportState, event: TransportEvent): boolean {
  return transition(state, event) !== null;
}

/** States during which a service-worker update must not be offered/applied. */
export function isBusyState(state: TransportState): boolean {
  return (
    state === 'countIn' ||
    state === 'recording' ||
    state === 'playing' ||
    state === 'scrubbing' ||
    state === 'renderingSheet' ||
    state === 'renderingAudio' ||
    state === 'encodingAudio'
  );
}
