import { describe, expect, it } from 'vitest';
import {
  ledgerLineSteps,
  midiToStaffPosition,
  stemGoesDown,
} from '@/features/notation/staffMapping';

describe('midiToStaffPosition', () => {
  it('places treble reference notes', () => {
    expect(midiToStaffPosition(64)).toEqual({ staff: 'treble', step: 0, accidental: null }); // E4 bottom line
    expect(midiToStaffPosition(77)).toEqual({ staff: 'treble', step: 8, accidental: null }); // F5 top line
    expect(midiToStaffPosition(71)).toEqual({ staff: 'treble', step: 4, accidental: null }); // B4 middle line
  });

  it('places middle C on the first ledger below the treble staff', () => {
    expect(midiToStaffPosition(60)).toEqual({ staff: 'treble', step: -2, accidental: null });
    expect(ledgerLineSteps(-2)).toEqual([-2]);
  });

  it('places bass reference notes', () => {
    expect(midiToStaffPosition(43)).toEqual({ staff: 'bass', step: 0, accidental: null }); // G2 bottom line
    expect(midiToStaffPosition(57)).toEqual({ staff: 'bass', step: 8, accidental: null }); // A3 top line
    expect(midiToStaffPosition(59)).toEqual({ staff: 'bass', step: 9, accidental: null }); // B3 above staff
  });

  it('splits staffs at middle C', () => {
    expect(midiToStaffPosition(60).staff).toBe('treble');
    expect(midiToStaffPosition(59).staff).toBe('bass');
  });

  it('spells black keys as sharps on the lower letter', () => {
    const cSharp = midiToStaffPosition(61);
    expect(cSharp.accidental).toBe('#');
    expect(cSharp.step).toBe(midiToStaffPosition(60).step); // C#4 sits on C4's position
    const fSharp = midiToStaffPosition(66);
    expect(fSharp.accidental).toBe('#');
    expect(fSharp.step).toBe(midiToStaffPosition(65).step);
  });

  it('computes ledger lines above and below', () => {
    expect(ledgerLineSteps(0)).toEqual([]);
    expect(ledgerLineSteps(8)).toEqual([]);
    expect(ledgerLineSteps(-4)).toEqual([-2, -4]);
    expect(ledgerLineSteps(10)).toEqual([10]);
    expect(ledgerLineSteps(13)).toEqual([10, 12]);
  });

  it('points stems down from the middle line up', () => {
    expect(stemGoesDown(4)).toBe(true);
    expect(stemGoesDown(9)).toBe(true);
    expect(stemGoesDown(3)).toBe(false);
    expect(stemGoesDown(-2)).toBe(false);
  });
});
