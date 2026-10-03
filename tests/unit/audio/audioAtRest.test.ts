import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import { AudioEngine } from '@/audio/AudioEngine';
import { isAppleMobile } from '@/audio/iosAudioSession';

vi.mock('@/audio/PianoGraphFactory', () => ({
  createPianoGraph: () => ({
    voiceDestination: {},
    outputDestination: {},
    setMasterVolume: () => undefined,
    setReverbMix: () => undefined,
    setReverbRoom: () => undefined,
    dispose: () => undefined,
  }),
}));

/** The scheduler worklets made, newest last. */
const tickers: FakeTickerNode[] = [];

class FakeTickerNode {
  readonly port = { postMessage: vi.fn(), onmessage: null as (() => void) | null };
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  constructor() {
    tickers.push(this);
  }
}

/** A context that can be suspended and resumed, with a worklet to load. */
class FakeAudioContext {
  state: AudioContextState = 'running';
  readonly currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = { kind: 'destination' };
  readonly audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  readonly suspend = vi.fn(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });
  readonly resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  addEventListener(): void {}
  createBuffer() {
    return {};
  }
  createBufferSource() {
    return {
      playbackRate: { value: 1 },
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}

const SAMPLE: SampleSelection = {
  buffer: { duration: 3 } as AudioBuffer,
  playbackRate: 1,
  gain: 0.8,
};

/** An engine whose worklet has loaded. Its core load waits on a restore that never comes. */
async function readyEngine(): Promise<{ engine: AudioEngine; context: FakeAudioContext }> {
  const engine = new AudioEngine();
  engine.initialize();
  await vi.waitFor(() => expect(tickers).toHaveLength(1));
  vi.spyOn(engine.bank, 'getSample').mockReturnValue(SAMPLE);
  return { engine, context: engine.getAudioContext() as unknown as FakeAudioContext };
}

beforeEach(() => {
  tickers.length = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeTickerNode);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the scheduler pulse', () => {
  it('stays unplugged and silent while nothing listens', async () => {
    await readyEngine();
    const ticker = tickers[0]!;
    expect(ticker.connect).not.toHaveBeenCalled();
    expect(ticker.port.postMessage).not.toHaveBeenCalled();
  });

  it('pulses from the first listener until the last one leaves', async () => {
    const { engine, context } = await readyEngine();
    const ticker = tickers[0]!;

    const first = engine.subscribeSchedulerTick(() => undefined);
    const second = engine.subscribeSchedulerTick(() => undefined);
    expect(ticker.port.postMessage.mock.calls).toEqual([[true]]);
    expect(ticker.connect).toHaveBeenCalledExactlyOnceWith(context.destination);

    first();
    expect(ticker.disconnect).not.toHaveBeenCalled();
    second();
    expect(ticker.port.postMessage.mock.calls).toEqual([[true], [false]]);
    expect(ticker.disconnect).toHaveBeenCalledOnce();
  });

  it('starts pulsing for a listener that came before the worklet was ready', async () => {
    const engine = new AudioEngine();
    engine.initialize();
    const listener = vi.fn();
    engine.subscribeSchedulerTick(listener);
    await vi.waitFor(() => expect(tickers).toHaveLength(1));
    const ticker = tickers[0]!;
    expect(ticker.port.postMessage.mock.calls).toEqual([[true]]);
    expect(ticker.connect).toHaveBeenCalledOnce();
    ticker.port.onmessage?.();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('sleeping while the page is away', () => {
  it('suspends once the tail has passed, if still wanted then', async () => {
    const { engine, context } = await readyEngine();
    vi.useFakeTimers();
    engine.sleepAfter(3.25, () => true);
    vi.advanceTimersByTime(3249);
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it('stays awake when no longer wanted, or called off', async () => {
    const { engine, context } = await readyEngine();
    vi.useFakeTimers();
    engine.sleepAfter(1, () => false);
    vi.advanceTimersByTime(1000);

    engine.sleepAfter(1, () => true);
    engine.wake();
    vi.advanceTimersByTime(1000);

    expect(context.suspend).not.toHaveBeenCalled();
  });

  it('never sleeps a context that is not running', async () => {
    const { engine, context } = await readyEngine();
    context.state = 'suspended';
    vi.useFakeTimers();
    engine.sleepAfter(0, () => true);
    vi.advanceTimersByTime(10);
    expect(context.suspend).not.toHaveBeenCalled();
  });

  it('wakes only a context it put to sleep', async () => {
    const { engine, context } = await readyEngine();
    engine.wake();
    expect(context.resume).not.toHaveBeenCalled();

    vi.useFakeTimers();
    engine.sleepAfter(1, () => true);
    vi.advanceTimersByTime(1000);
    expect(context.state).toBe('suspended');
    engine.wake();
    expect(context.resume).toHaveBeenCalledOnce();
    engine.wake();
    expect(context.resume).toHaveBeenCalledOnce();
  });
});

describe('sleeping only once everything has rung out', () => {
  it('waits a whole quiet stretch after the last voice', async () => {
    const { engine, context } = await readyEngine();
    const voices = (engine as unknown as { voices: { voiceCount: number } }).voices;
    const count = vi.spyOn(voices, 'voiceCount', 'get');
    count.mockReturnValue(2);
    vi.useFakeTimers();
    engine.sleepAfter(1, () => true);
    vi.advanceTimersByTime(1000); // still sounding: look again later
    count.mockReturnValue(0);
    vi.advanceTimersByTime(1000); // just ended: its tail gets a stretch
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it('sleeps again after a note played with the page away has rung out', async () => {
    const { engine, context } = await readyEngine();
    const voices = (engine as unknown as { voices: { voiceCount: number } }).voices;
    const count = vi.spyOn(voices, 'voiceCount', 'get').mockReturnValue(0);
    vi.useFakeTimers();
    engine.sleepAfter(1, () => true);
    vi.advanceTimersByTime(1000);
    expect(context.suspend).toHaveBeenCalledOnce();

    // A MIDI note: it wakes the device, and sounds.
    count.mockReturnValue(1);
    engine.noteOn(60, 0.5, 'midi');
    await vi.waitFor(() => expect(context.state).toBe('running'));
    vi.advanceTimersByTime(1000);
    expect(context.suspend).toHaveBeenCalledOnce();
    // Let go, and rung out: asleep again a quiet stretch later.
    count.mockReturnValue(0);
    vi.advanceTimersByTime(2000);
    expect(context.suspend).toHaveBeenCalledTimes(2);
  });

  it('a note played while the sleep waits only puts it off', async () => {
    const { engine, context } = await readyEngine();
    const voices = (engine as unknown as { voices: { voiceCount: number } }).voices;
    const count = vi.spyOn(voices, 'voiceCount', 'get').mockReturnValue(0);
    vi.useFakeTimers();
    engine.sleepAfter(1, () => true);
    vi.advanceTimersByTime(500);
    count.mockReturnValue(1);
    engine.noteOn(60, 0.5, 'midi');
    vi.advanceTimersByTime(500);
    count.mockReturnValue(0);
    vi.advanceTimersByTime(1000);
    expect(context.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(context.suspend).toHaveBeenCalledOnce();
  });

  it('unlocks again at the next press after waking', async () => {
    const { engine } = await readyEngine();
    vi.useFakeTimers();
    engine.sleepAfter(1, () => true);
    vi.advanceTimersByTime(1000);
    engine.wake();
    const unlock = vi.spyOn(engine, 'unlockFromUserGesture');
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    expect(unlock).toHaveBeenCalledOnce();
  });
});

describe('the iPhone silent-switch session', () => {
  const nav = (userAgent: string, platform: string, maxTouchPoints: number) => ({
    userAgent,
    platform,
    maxTouchPoints,
  });

  it('runs on iPhones and iPads, including an iPad asking for the desktop site', () => {
    expect(
      isAppleMobile(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)),
    ).toBe(true);
    expect(isAppleMobile(nav('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5))).toBe(
      true,
    );
    expect(
      isAppleMobile(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)),
    ).toBe(true);
  });

  it('stays off on touch laptops, Chromebooks, Android and Macs', () => {
    expect(isAppleMobile(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 10))).toBe(
      false,
    );
    expect(isAppleMobile(nav('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 'Linux x86_64', 10))).toBe(
      false,
    );
    expect(isAppleMobile(nav('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv81', 5))).toBe(
      false,
    );
    expect(
      isAppleMobile(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)),
    ).toBe(false);
  });
});
