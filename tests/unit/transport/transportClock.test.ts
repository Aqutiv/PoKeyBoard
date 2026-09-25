import { describe, expect, it } from 'vitest';
import { foldIntoLoop, loopPassAt, TransportClock } from '@/features/transport/transportClock';

function makeClock() {
  let now = 100; // seconds
  const clock = new TransportClock(() => now);
  return { clock, advance: (s: number) => (now += s), setNow: (s: number) => (now = s) };
}

describe('TransportClock', () => {
  it('advances take time with the audio clock while running', () => {
    const { clock, advance } = makeClock();
    clock.start(1000);
    advance(2);
    expect(clock.currentTakeMs()).toBeCloseTo(3000);
  });

  it('freezes on pause and resumes from the frozen point', () => {
    const { clock, advance } = makeClock();
    clock.start(0);
    advance(1.5);
    clock.pause();
    advance(10);
    expect(clock.currentTakeMs()).toBeCloseTo(1500);
    clock.start(clock.currentTakeMs());
    advance(0.5);
    expect(clock.currentTakeMs()).toBeCloseTo(2000);
  });

  it('supports anchoring to a future audio time (count-in)', () => {
    const { clock, advance } = makeClock();
    clock.start(0, 102); // recording begins 2s from now
    expect(clock.currentTakeMs()).toBeCloseTo(-2000);
    advance(3);
    expect(clock.currentTakeMs()).toBeCloseTo(1000);
  });

  it('maps take time to audio time and back', () => {
    const { clock } = makeClock();
    clock.start(500, 100);
    expect(clock.audioTimeForTakeMs(1500)).toBeCloseTo(101);
    expect(clock.takeMsForAudioTime(101)).toBeCloseTo(1500);
  });

  it('seeks while stopped', () => {
    const { clock } = makeClock();
    clock.seek(4200);
    expect(clock.currentTakeMs()).toBe(4200);
    expect(clock.isRunning).toBe(false);
  });

  it('runs slower or faster than the take at a rate', () => {
    const { clock, advance } = makeClock();
    clock.start(1000, 100, { rate: 0.5 });
    advance(2);
    // Two seconds at half speed is one second of take.
    expect(clock.currentTakeMs()).toBeCloseTo(2000);
    expect(clock.audioTimeForTakeMs(3000)).toBeCloseTo(104);
    expect(clock.takeMsForAudioTime(104)).toBeCloseTo(3000);
  });

  it('folds take time round a loop and keeps an unwrapped timeline', () => {
    const { clock, advance } = makeClock();
    const loop = { startMs: 1000, endMs: 2000 };
    clock.start(500, 100, { loop });
    advance(1);
    expect(clock.currentTakeMs()).toBeCloseTo(1500); // into the loop from before it
    advance(1);
    expect(clock.currentTakeMs()).toBeCloseTo(1500); // once round: back where it was
    expect(clock.currentVirtualMs()).toBeCloseTo(2500);
    // The second pass plays take time t at virtual time t + one loop.
    expect(clock.audioTimeForVirtualMs(1000 + 1000)).toBeCloseTo(101.5);
    expect(loopPassAt(loop, 2500)).toBe(1);
    expect(loopPassAt(loop, 1999)).toBe(0);
    expect(foldIntoLoop(loop, 3250)).toBeCloseTo(1250);
  });

  it('changes rate from now on without moving the position', () => {
    const { clock, advance } = makeClock();
    clock.start(0, 100);
    advance(1);
    clock.retime({ rate: 2 });
    expect(clock.currentTakeMs()).toBeCloseTo(1000);
    advance(1);
    expect(clock.currentTakeMs()).toBeCloseTo(3000);
    expect(clock.rate).toBe(2);
  });

  it('restarts the unwrapped timeline where a retime finds it', () => {
    const { clock, advance } = makeClock();
    clock.start(0, 100, { loop: { startMs: 0, endMs: 1000 } });
    advance(2.25); // third pass, a quarter in
    clock.retime({ loop: null });
    expect(clock.currentTakeMs()).toBeCloseTo(250);
    expect(clock.currentVirtualMs()).toBeCloseTo(250);
    advance(1);
    expect(clock.currentTakeMs()).toBeCloseTo(1250); // no loop now: straight on
  });
});
