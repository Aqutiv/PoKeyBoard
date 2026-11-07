import { describe, expect, it } from 'vitest';
import {
  ALL_DARK,
  KeyLightSession,
  lightChanges,
  type DeviceLights,
} from '@/features/keyLights/keyLightSession';
import {
  allDark,
  builtInMode,
  enterLedMode,
  rgbFrames,
  type Rgb8,
} from '@/features/keyLights/partyKeysProtocol';

const RED: Rgb8 = { r: 255, g: 0, b: 0 };
const GREEN: Rgb8 = { r: 0, g: 255, b: 0 };
const BLUE: Rgb8 = { r: 0, g: 0, b: 255 };

function lights(...lit: [number, Rgb8][]): DeviceLights {
  const out = [...ALL_DARK];
  for (const [key, colour] of lit) out[key] = colour;
  return out;
}

const bytes = (frames: Uint8Array[]) => frames.map((frame) => [...frame]);

// The session tests are PianoBallDesktop's (tests/KeyLightsTests.cpp, session()).
describe('KeyLightSession', () => {
  it('enters LED mode, lets it settle, darkens every key, then lights what is wanted', () => {
    const s = new KeyLightSession();
    const want = lights([0, RED]);
    expect(bytes(s.step(0, want))).toEqual([[...enterLedMode()]]);
    expect(s.step(20, want)).toEqual([]);
    expect(bytes(s.step(60, want))).toEqual([
      ...bytes(allDark()),
      ...bytes(rgbFrames([{ key: 0, colour: RED }])),
    ]);
    expect(s.live).toBe(true);
  });

  it('gathers changes inside a 40 ms gap into one update, and sends nothing unchanged', () => {
    const s = new KeyLightSession();
    s.step(0, ALL_DARK);
    s.step(60, lights([0, RED]));
    expect(s.step(70, lights([0, RED], [1, GREEN]))).toEqual([]);
    expect(s.step(90, lights([0, RED], [1, GREEN], [2, BLUE]))).toEqual([]);
    expect(bytes(s.step(101, lights([0, RED], [1, GREEN], [2, BLUE])))).toEqual(
      bytes(
        rgbFrames([
          { key: 1, colour: GREEN },
          { key: 2, colour: BLUE },
        ]),
      ),
    );
    expect(s.step(200, lights([0, RED], [1, GREEN], [2, BLUE]))).toEqual([]);
  });

  it('starts over from LED mode and dark keys after a failed send', () => {
    const s = new KeyLightSession();
    s.step(0, ALL_DARK);
    s.step(60, lights([0, RED]));
    s.fail();
    expect(s.live).toBe(false);
    expect(bytes(s.step(300, lights([0, RED])))).toEqual([[...enterLedMode()]]);
    const next = s.step(400, lights([0, RED]));
    expect([...(next[0] as Uint8Array)]).toEqual([...(allDark()[0] as Uint8Array)]);
  });

  it('after the keyboard draws its own lights, re-enters LED mode and draws all 36 keys, never dark first', () => {
    const s = new KeyLightSession();
    const want = lights([3, RED]);
    s.step(0, want);
    s.step(60, want);
    s.repaintAll();
    expect(bytes(s.step(500, want))).toEqual([[...enterLedMode()]]);
    expect(s.step(520, want)).toEqual([]);
    const repaint = s.step(560, want);
    expect(s.live).toBe(true);
    let keys = 0;
    for (const frame of repaint) {
      expect(frame[7]).toBe(0x15);
      for (let at = 9, group = 0; group < (frame[8] as number); group += 1) {
        const count = frame[at + 6] as number;
        keys += count;
        at += 7 + count;
      }
    }
    expect(keys).toBe(36);
  });

  it('releases a lit keyboard with every key dark, then mode 00', () => {
    const s = new KeyLightSession();
    s.step(0, ALL_DARK);
    s.step(60, ALL_DARK);
    expect(bytes(s.release())).toEqual([...bytes(allDark()), [...builtInMode()]]);
    expect(s.live).toBe(false);
  });

  it('leaves a keyboard never lit alone, and hands back one still settling', () => {
    const never = new KeyLightSession();
    never.repaintAll();
    expect(never.release()).toEqual([]);
    const settling = new KeyLightSession();
    settling.step(0, ALL_DARK);
    expect(bytes(settling.release())).toEqual([[...builtInMode()]]);
  });

  it('says when the next step has something to send', () => {
    const s = new KeyLightSession();
    expect(s.nextStepIn(0, ALL_DARK)).toBe(0);
    s.step(0, ALL_DARK);
    expect(s.nextStepIn(10, ALL_DARK)).toBe(40);
    s.step(50, ALL_DARK);
    expect(s.nextStepIn(60, ALL_DARK)).toBeNull();
    s.step(60, lights([1, RED]));
    expect(s.nextStepIn(70, lights([1, BLUE]))).toBe(30);
  });

  it('lists only the keys whose light changes', () => {
    const before = lights([0, RED]);
    expect(lightChanges(before, before)).toEqual([]);
    expect(lightChanges(before, lights([0, RED], [5, BLUE]))).toEqual([{ key: 5, colour: BLUE }]);
  });
});
