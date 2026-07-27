import { describe, expect, it } from 'vitest';
import {
  ledgerLineSteps,
  midiToStaffPosition,
  stemGoesDown,
} from '@/features/notation/staffMapping';

describe('midiToStaffPosition', () => {
  it('places treble reference notes', () => {
    expect(midiToStaffPosition(64)).toEqual({
      staff: 'treble',
      clef: 'treble',
      step: 0,
      accidental: null,
      alter: 0,
    }); // E4 bottom line
    expect(midiToStaffPosition(77)).toEqual({
      staff: 'treble',
      clef: 'treble',
      step: 8,
      accidental: null,
      alter: 0,
    }); // F5 top line
    expect(midiToStaffPosition(71)).toEqual({
      staff: 'treble',
      clef: 'treble',
      step: 4,
      accidental: null,
      alter: 0,
    }); // B4 middle line
  });

  it('places middle C on the first ledger below the treble staff', () => {
    expect(midiToStaffPosition(60)).toEqual({
      staff: 'treble',
      clef: 'treble',
      step: -2,
      accidental: null,
      alter: 0,
    });
    expect(ledgerLineSteps(-2)).toEqual([-2]);
  });

  it('places bass reference notes', () => {
    expect(midiToStaffPosition(43)).toEqual({
      staff: 'bass',
      clef: 'bass',
      step: 0,
      accidental: null,
      alter: 0,
    }); // G2 bottom line
    expect(midiToStaffPosition(57)).toEqual({
      staff: 'bass',
      clef: 'bass',
      step: 8,
      accidental: null,
      alter: 0,
    }); // A3 top line
    expect(midiToStaffPosition(59)).toEqual({
      staff: 'bass',
      clef: 'bass',
      step: 9,
      accidental: null,
      alter: 0,
    }); // B3 above staff
  });

  it('splits staffs at middle C', () => {
    expect(midiToStaffPosition(60).staff).toBe('treble');
    expect(midiToStaffPosition(59).staff).toBe('bass');
  });

  it('lets an imported staff override the middle-C split', () => {
    // A left hand written at middle C stays on the bass staff, two ledger
    // lines up, instead of jumping the gap to the treble.
    const c4 = midiToStaffPosition(60, 'bass');
    expect(c4).toEqual({ staff: 'bass', clef: 'bass', step: 10, accidental: null, alter: 0 });
    expect(ledgerLineSteps(c4.step)).toEqual([10]);
    // And a right hand reaching under it stays in the treble.
    expect(midiToStaffPosition(55, 'treble')).toEqual({
      staff: 'treble',
      clef: 'treble',
      step: -5,
      accidental: null,
      alter: 0,
    });
  });

  it('reads a staff under whichever clef it carries', () => {
    // The bass staff under a G clef: C4 sits a ledger line below it, exactly
    // where the treble staff would put it, rather than one above.
    expect(midiToStaffPosition(60, 'bass', 'treble')).toEqual({
      staff: 'bass',
      clef: 'treble',
      step: -2,
      accidental: null,
      alter: 0,
    });
    // And the treble staff under an F clef reads the low register.
    expect(midiToStaffPosition(43, 'treble', 'bass')).toEqual({
      staff: 'treble',
      clef: 'bass',
      step: 0,
      accidental: null,
      alter: 0,
    });
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
