import { describe, expect, it } from 'vitest';
import {
  allDark,
  builtInMode,
  enterLedMode,
  isButtonReport,
  isPartyKeys,
  keyOfNote,
  MAX_FRAME_BYTES,
  noteOfKey,
  NO_SHIFT,
  parseShiftReport,
  PARTYKEYS_KEYS,
  rgbFrames,
  shiftForNote,
  type KeyColour,
} from '@/features/keyLights/partyKeysProtocol';

const HEADER = [0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00];
const cmd = (...body: number[]) => [...HEADER, ...body, 0xf7];
const bytes = (frames: Uint8Array[]) => frames.map((frame) => [...frame]);

// Vectors from PianoBallDesktop's tests/KeyLightsTests.cpp.
describe('PartyKeys light messages', () => {
  it('enters LED mode with 0F 01 and hands the lights back with 0F 00', () => {
    expect([...enterLedMode()]).toEqual(cmd(0x0f, 0x01));
    expect([...builtInMode()]).toEqual(cmd(0x0f, 0x00));
  });

  it('writes the documented red-and-blue frame', () => {
    const frames = rgbFrames([
      { key: 0, colour: { r: 255, g: 0, b: 0 } },
      { key: 12, colour: { r: 0, g: 0, b: 255 } },
      { key: 24, colour: { r: 0, g: 0, b: 255 } },
    ]);
    expect(bytes(frames)).toEqual([
      cmd(0x15, 0x02, 0x01, 0x7f, 0, 0, 0, 0, 0x01, 0x00, 0, 0, 0, 0, 0x01, 0x7f, 0x02, 0x0c, 0x18),
    ]);
  });

  it('splits each channel into 7-bit high and low bytes', () => {
    expect(bytes(rgbFrames([{ key: 3, colour: { r: 128, g: 51, b: 0 } }]))).toEqual([
      cmd(0x15, 0x01, 0x01, 0x00, 0x00, 0x33, 0x00, 0x00, 0x01, 0x03),
    ]);
  });

  it('never sends a key off the keyboard', () => {
    expect(rgbFrames([{ key: -1, colour: { r: 1, g: 1, b: 1 } }])).toEqual([]);
    expect(rgbFrames([{ key: 36, colour: { r: 1, g: 1, b: 1 } }])).toEqual([]);
  });

  it('splits 36 colours across frames that each fit, losing none', () => {
    const rainbow: KeyColour[] = Array.from({ length: PARTYKEYS_KEYS }, (_, k) => ({
      key: k,
      colour: { r: k * 7, g: 255 - k, b: k },
    }));
    const split = rgbFrames(rainbow);
    expect(split.length).toBeGreaterThan(1);
    let groups = 0;
    for (const frame of split) {
      expect(frame.length).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      expect(frame.length).toBeGreaterThanOrEqual(18);
      expect(frame[7]).toBe(0x15);
      expect(frame[frame.length - 1]).toBe(0xf7);
      groups += frame[8] as number;
    }
    expect(groups).toBe(36);
    for (const frame of rgbFrames(rainbow, 30)) expect(frame.length).toBeLessThanOrEqual(30);
  });

  it('darkens every key in one 53-byte group', () => {
    const dark = allDark();
    expect(dark).toHaveLength(1);
    expect(dark[0]).toHaveLength(53);
    expect(dark[0]?.[8]).toBe(1);
  });

  it('carries a group too long for one frame on into the next', () => {
    const same = Array.from({ length: PARTYKEYS_KEYS }, (_, key) => ({
      key,
      colour: { r: 9, g: 9, b: 9 },
    }));
    let keys = 0;
    for (const frame of rgbFrames(same, 40)) {
      expect(frame.length).toBeLessThanOrEqual(40);
      keys += frame.length - 10 - 7;
    }
    expect(keys).toBe(36);
  });

  it('reads the octave report as signed 7-bit, and tells the button report apart', () => {
    const report = Uint8Array.of(0xf0, 0x05, 0x30, 0x20, 0x00, 0x01, 0x3f, 0x18, 0x7f, 0x02, 0xf7);
    expect(parseShiftReport(report)).toEqual({ octave: -1, transpose: 2 });
    const button = Uint8Array.of(0xf0, 0x05, 0x30, 0x10, 0x00, 0x00, 0x3f, 0x16, 0xf7);
    expect(parseShiftReport(button)).toBeNull();
    expect(isButtonReport(button)).toBe(true);
    expect(isButtonReport(report)).toBe(false);
  });

  it('finds a PartyKeys by name', () => {
    expect(isPartyKeys('PartyKeys')).toBe(true);
    expect(isPartyKeys('2- PARTYKEYS MIDI')).toBe(true);
    expect(isPartyKeys('Party Keys')).toBe(false);
    expect(isPartyKeys('Microsoft GS Wavetable Synth')).toBe(false);
    expect(isPartyKeys(undefined)).toBe(false);
  });
});

describe('PartyKeys key mapping', () => {
  it('plays C3 to B5 on keys 0 to 35', () => {
    expect(keyOfNote(48, NO_SHIFT)).toBe(0);
    expect(keyOfNote(83, NO_SHIFT)).toBe(35);
    expect(keyOfNote(47, NO_SHIFT)).toBe(-1);
    expect(keyOfNote(84, NO_SHIFT)).toBe(-1);
  });

  it('follows the keyboard’s own OCT and transpose, both ways', () => {
    const shift = { octave: -1, transpose: 2 };
    expect(keyOfNote(38, shift)).toBe(0);
    expect(noteOfKey(0, shift)).toBe(38);
    for (let key = 0; key < PARTYKEYS_KEYS; key += 1) {
      expect(keyOfNote(noteOfKey(key, shift), shift)).toBe(key);
    }
    const up = { octave: 1, transpose: 0 };
    expect(keyOfNote(72, up)).toBe(12);
    expect(keyOfNote(60, up)).toBe(0);
    expect(keyOfNote(59, up)).toBe(-1);
  });

  it('reads an octave pressed unseen from the first note outside the span', () => {
    expect(shiftForNote(60, NO_SHIFT)).toEqual(NO_SHIFT);
    expect(shiftForNote(83, NO_SHIFT)).toEqual(NO_SHIFT);
    expect(shiftForNote(84, NO_SHIFT)).toEqual({ octave: 1, transpose: 0 });
    expect(shiftForNote(95, NO_SHIFT)).toEqual({ octave: 1, transpose: 0 });
    expect(shiftForNote(96, NO_SHIFT)).toEqual({ octave: 2, transpose: 0 });
    expect(shiftForNote(47, NO_SHIFT)).toEqual({ octave: -1, transpose: 0 });
    expect(shiftForNote(36, NO_SHIFT)).toEqual({ octave: -1, transpose: 0 });
    expect(shiftForNote(35, NO_SHIFT)).toEqual({ octave: -2, transpose: 0 });
    const transposed = { octave: 0, transpose: 3 };
    expect(shiftForNote(51, transposed)).toEqual(transposed);
    expect(shiftForNote(50, transposed)).toEqual({ octave: -1, transpose: 3 });
    expect(shiftForNote(87, transposed)).toEqual({ octave: 1, transpose: 3 });
    expect(shiftForNote(0, NO_SHIFT)).toEqual({ octave: -4, transpose: 0 });
    expect(shiftForNote(127, NO_SHIFT)).toEqual({ octave: 4, transpose: 0 });
  });

  it('always finds an octave that puts the note on a key, within range', () => {
    for (let raw = 0; raw < 128; raw += 1) {
      const shift = shiftForNote(raw, NO_SHIFT);
      if (shift.octave > -4 && shift.octave < 4) {
        expect(keyOfNote(raw, shift)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
