import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_IDLE,
  calibrationReducer,
  SAME_GESTURE_MS,
  type CalibrationAction,
  type CalibrationState,
} from '@/features/settings/midiCalibration';

const START: CalibrationAction = { type: 'start' };
const CANCEL: CalibrationAction = { type: 'cancel' };

function note(raw: number, atMs: number): CalibrationAction {
  return { type: 'note', raw, atMs };
}

function run(actions: CalibrationAction[], from: CalibrationState = CALIBRATION_IDLE) {
  return actions.reduce(calibrationReducer, from);
}

describe('MIDI velocity calibration', () => {
  it('takes the softest note, then the loudest, and saves the range between them', () => {
    const asking = calibrationReducer(CALIBRATION_IDLE, START);
    expect(asking).toEqual({ step: 'softest' });

    const softest = calibrationReducer(asking, note(23, 1000));
    expect(softest).toEqual({ step: 'loudest', softest: 23, softestAtMs: 1000 });

    expect(calibrationReducer(softest, note(118, 2400))).toEqual({
      step: 'idle',
      outcome: { kind: 'saved', range: { min: 23, max: 118 } },
    });
  });

  it('accepts a span of exactly sixteen', () => {
    expect(run([START, note(40, 0), note(56, 1000)])).toEqual({
      step: 'idle',
      outcome: { kind: 'saved', range: { min: 40, max: 56 } },
    });
  });

  it('turns down a loudest note that was no louder than the softest', () => {
    expect(run([START, note(80, 0), note(80, 1000)])).toEqual({
      step: 'idle',
      outcome: { kind: 'rejected' },
    });
    expect(run([START, note(80, 0), note(30, 1000)])).toEqual({
      step: 'idle',
      outcome: { kind: 'rejected' },
    });
  });

  it('turns down a span too narrow to stretch over the whole range', () => {
    expect(run([START, note(40, 0), note(55, 1000)])).toEqual({
      step: 'idle',
      outcome: { kind: 'rejected' },
    });
  });

  // Two fingers landing together, or a chord: without this the second note
  // would be taken for the loudest and the attempt thrown out.
  it('counts notes struck together with the softest as part of it', () => {
    const state = run([START, note(30, 1000), note(24, 1015), note(45, 1030)]);
    expect(state).toEqual({ step: 'loudest', softest: 24, softestAtMs: 1000 });

    expect(calibrationReducer(state, note(110, 1000 + SAME_GESTURE_MS))).toEqual({
      step: 'idle',
      outcome: { kind: 'saved', range: { min: 24, max: 110 } },
    });
  });

  it('ignores notes while it is not asking for one', () => {
    expect(calibrationReducer(CALIBRATION_IDLE, note(60, 0))).toBe(CALIBRATION_IDLE);

    const saved = run([START, note(20, 0), note(100, 1000)]);
    expect(calibrationReducer(saved, note(127, 1010))).toBe(saved);

    const rejected = run([START, note(90, 0), note(20, 1000)]);
    expect(calibrationReducer(rejected, note(127, 1010))).toBe(rejected);
  });

  it('cancels from either step back to idle, with nothing to report', () => {
    expect(run([START, CANCEL])).toBe(CALIBRATION_IDLE);
    expect(run([START, note(20, 0), CANCEL])).toBe(CALIBRATION_IDLE);
  });

  it('starts again from the softest note, forgetting the last outcome', () => {
    const rejected = run([START, note(90, 0), note(20, 1000)]);
    expect(calibrationReducer(rejected, START)).toEqual({ step: 'softest' });
  });
});
