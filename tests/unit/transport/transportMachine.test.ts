import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isBusyState,
  transition,
  type TransportState,
} from '@/features/transport/transportMachine';

describe('transport state machine', () => {
  it('follows the recording flow', () => {
    expect(transition('idle', 'RECORD')).toBe('countIn');
    expect(transition('countIn', 'COUNT_IN_DONE')).toBe('recording');
    expect(transition('recording', 'STOP')).toBe('idle');
  });

  it('follows the playback flow with pause and resume', () => {
    expect(transition('idle', 'PLAY')).toBe('playing');
    expect(transition('playing', 'PAUSE')).toBe('paused');
    expect(transition('paused', 'PLAY')).toBe('playing');
    expect(transition('playing', 'STOP')).toBe('idle');
  });

  it('allows scrubbing only from paused or idle', () => {
    expect(transition('idle', 'SCRUB_START')).toBe('scrubbing');
    expect(transition('paused', 'SCRUB_START')).toBe('scrubbing');
    expect(transition('scrubbing', 'SCRUB_END')).toBe('paused');
    expect(transition('playing', 'SCRUB_START')).toBeNull();
    expect(transition('recording', 'SCRUB_START')).toBeNull();
  });

  it('follows the export pipeline', () => {
    expect(transition('idle', 'EXPORT_START')).toBe('renderingAudio');
    expect(transition('renderingAudio', 'RENDER_DONE')).toBe('encodingAudio');
    expect(transition('encodingAudio', 'ENCODE_DONE')).toBe('audioReady');
    expect(transition('audioReady', 'DISMISS_AUDIO')).toBe('idle');
    expect(transition('renderingAudio', 'EXPORT_CANCEL')).toBe('idle');
  });

  it('coordinates sheet rendering as a busy transport state', () => {
    expect(transition('idle', 'SHEET_EXPORT_START')).toBe('renderingSheet');
    expect(transition('renderingSheet', 'SHEET_EXPORT_DONE')).toBe('idle');
    expect(transition('paused', 'SHEET_EXPORT_START')).toBe('renderingSheet');
    expect(transition('renderingSheet', 'SHEET_EXPORT_CANCEL')).toBe('idle');
    expect(isBusyState('renderingSheet')).toBe(true);
  });

  it('prevents invalid transitions', () => {
    expect(transition('idle', 'PAUSE')).toBeNull();
    expect(transition('recording', 'PLAY')).toBeNull();
    expect(transition('recording', 'RECORD')).toBeNull();
    expect(transition('playing', 'RECORD')).toBeNull();
    expect(transition('playing', 'EXPORT_START')).toBeNull();
    expect(transition('countIn', 'PLAY')).toBeNull();
  });

  it('recovers from error only via RESET', () => {
    expect(transition('error', 'PLAY')).toBeNull();
    expect(transition('error', 'RESET')).toBe('idle');
  });

  it('reports canTransition consistently with transition', () => {
    const states: TransportState[] = ['idle', 'playing', 'paused', 'recording'];
    for (const state of states) {
      expect(canTransition(state, 'STOP')).toBe(transition(state, 'STOP') !== null);
    }
  });

  it('flags busy states for the update manager', () => {
    expect(isBusyState('recording')).toBe(true);
    expect(isBusyState('renderingAudio')).toBe(true);
    expect(isBusyState('idle')).toBe(false);
    expect(isBusyState('paused')).toBe(false);
    expect(isBusyState('audioReady')).toBe(false);
  });
});
