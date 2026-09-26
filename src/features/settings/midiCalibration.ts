import { calibratedRange, type MidiVelocityRange } from '@/features/keyboard/velocityResponse';

/**
 * The inline MIDI velocity calibration, as a pure state machine: Calibrate,
 * then the softest note, then the loudest, then saved — or turned down, when
 * the loudest was not clearly the louder. Kept out of MidiSection so it can
 * be tested without a MIDI device, which no test browser has.
 */
export type CalibrationState =
  | { step: 'idle'; outcome: CalibrationOutcome | null }
  | { step: 'softest' }
  | { step: 'loudest'; softest: number; softestAtMs: number };

export type CalibrationOutcome = { kind: 'saved'; range: MidiVelocityRange } | { kind: 'rejected' };

export type CalibrationAction =
  { type: 'start' } | { type: 'cancel' } | { type: 'note'; raw: number; atMs: number };

export const CALIBRATION_IDLE: CalibrationState = { step: 'idle', outcome: null };

/**
 * Notes this soon after the softest still belong to it. Two fingers landing
 * together, or a chord, would otherwise have the second note taken for the
 * loudest and the attempt turned down before the player had struck it; and
 * nobody reads the next prompt and strikes hard within a quarter second.
 */
export const SAME_GESTURE_MS = 250;

export function calibrationReducer(
  state: CalibrationState,
  action: CalibrationAction,
): CalibrationState {
  switch (action.type) {
    case 'start':
      return { step: 'softest' };
    case 'cancel':
      return CALIBRATION_IDLE;
    case 'note': {
      if (state.step === 'softest') {
        return { step: 'loudest', softest: action.raw, softestAtMs: action.atMs };
      }
      if (state.step !== 'loudest') return state;
      if (action.atMs - state.softestAtMs < SAME_GESTURE_MS) {
        return action.raw < state.softest ? { ...state, softest: action.raw } : state;
      }
      const range = calibratedRange(state.softest, action.raw);
      return { step: 'idle', outcome: range ? { kind: 'saved', range } : { kind: 'rejected' } };
    }
  }
}
