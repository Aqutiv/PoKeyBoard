import { describe, expect, it } from 'vitest';
import { TransportClock } from '@/features/transport/transportClock';

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
});
