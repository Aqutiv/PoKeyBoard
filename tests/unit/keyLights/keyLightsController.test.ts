import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { NoteEvent } from '@/domain/takeTypes';
import {
  BUTTON_HOLD_MS,
  BUTTON_REPAINT_MS,
  KeyLightsController,
  RETRY_AFTER_FAILURE_MS,
  type KeyLightsDeps,
} from '@/features/keyLights/keyLightsController';
import type { KeyLightScene } from '@/features/keyLights/keyLightModel';
import {
  COMING_LEVEL,
  dimLight,
  handLight,
  ledColour,
  LIGHT_COLOURS,
} from '@/features/keyLights/ledColours';
import type { LightLink, LightLinksSnapshot } from '@/features/keyLights/lightLinks';
import {
  allDark,
  builtInMode,
  enterLedMode,
  rgbFrames,
} from '@/features/keyLights/partyKeysProtocol';
import type { TransportState } from '@/features/transport/transportMachine';

/** A keyboard that keeps every frame it is sent, and can be made to refuse them. */
class FakeLink extends EventTarget implements LightLink {
  readonly id: string;
  readonly name = 'PartyKeys';
  readonly transport: LightLink['transport'];
  readonly frames: number[][] = [];
  refuse = false;
  readonly input = this;

  constructor(id: string, transport: LightLink['transport'] = 'usb') {
    super();
    this.id = id;
    this.transport = transport;
  }

  send(frame: Uint8Array): Promise<void> {
    if (this.refuse) return Promise.reject(new DOMException('gone', 'InvalidStateError'));
    this.frames.push([...frame]);
    return Promise.resolve();
  }

  /** The keyboard's own message, as its port delivers it. */
  emit(...bytes: number[]) {
    this.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from(bytes) }));
  }

  take(): number[][] {
    return this.frames.splice(0);
  }
}

const sameBytes = (frames: Uint8Array[]) => frames.map((frame) => [...frame]);

function note(midi: number, startMs: number, durationMs: number, velocity = 1): NoteEvent {
  return { id: `n${midi}-${startMs}`, midi, startMs, durationMs, velocity };
}

let links: (snapshot: LightLinksSnapshot) => void;
let input: (event: InputNoteEvent) => void;
let settings: () => void;
let transport: () => void;
let frames: (() => void) | null;
let state: TransportState;
let playhead: number;
let notes: NoteEvent[];
let enabled: boolean;
let hidden: boolean;
let stop: () => void;

function controller(): KeyLightsController {
  const deps: KeyLightsDeps = {
    now: () => Date.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    watchLinks: (listener) => {
      links = listener;
      return () => undefined;
    },
    enabled: () => enabled,
    followsVelocity: () => true,
    subscribeSettings: (listener) => {
      settings = listener;
      return () => undefined;
    },
    transportState: () => state,
    playheadMs: () => playhead,
    notes: () => notes,
    subscribeTransport: (listener) => {
      transport = listener;
      return () => undefined;
    },
    subscribeInput: (listener) => {
      input = listener;
      return () => undefined;
    },
    subscribeFrames: (listener) => {
      frames = listener;
      return () => {
        frames = null;
      };
    },
    subscribeBackgroundTicks: () => () => undefined,
    hidden: () => hidden,
    backgroundPlayback: () => false,
    subscribeVisibility: () => () => undefined,
    subscribePageHide: () => () => undefined,
    extras: () => scenery,
    subscribeExtras: (listener) => {
      extrasChanged = listener;
      return () => undefined;
    },
  };
  return new KeyLightsController(deps);
}

let scenery: Pick<KeyLightScene, 'targets' | 'wrong' | 'coming'>;
let extrasChanged: () => void = () => undefined;

/** Connects `link`, lets the startup run, and clears what it sent. */
async function connect(link: FakeLink) {
  links({ links: [link], usbAwaitingSysex: false });
  await vi.advanceTimersByTimeAsync(100);
  return link.take();
}

beforeEach(() => {
  vi.useFakeTimers();
  state = 'idle';
  playhead = 0;
  notes = [];
  enabled = true;
  hidden = false;
  frames = null;
  scenery = { targets: new Map(), wrong: new Set(), coming: new Map() };
  stop = controller().start();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('KeyLightsController', () => {
  it('starts a connected keyboard in LED mode, then darkens every key', async () => {
    const link = new FakeLink('usb:1');
    const sent = await connect(link);
    expect(sent).toEqual([[...enterLedMode()], ...sameBytes(allDark())]);
  });

  it('lights the take’s notes in their hand while it plays, and darkens them when it stops', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    notes = [note(60, 0, 1000, 1)]; // C4: key 12, right hand
    state = 'playing';
    playhead = 100;
    transport();
    expect(frames).not.toBeNull();
    frames?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.take()).toEqual(
      sameBytes(rgbFrames([{ key: 12, colour: handLight('right', 1, true) }])),
    );

    state = 'idle';
    transport();
    expect(frames).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    expect(link.take()).toEqual(sameBytes(rgbFrames([{ key: 12, colour: { r: 0, g: 0, b: 0 } }])));
  });

  it('lights keys held on screen, but not the keyboard’s own presses', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    input({ type: 'on', midi: 62, velocity: 1, audioTime: 0, sourceId: 'pointer:1' });
    input({ type: 'on', midi: 64, velocity: 1, audioTime: 0, sourceId: 'midi' });
    await vi.advanceTimersByTimeAsync(50);
    expect(link.take()).toEqual(
      sameBytes(rgbFrames([{ key: 14, colour: handLight('right', 1, true) }])),
    );
    input({ type: 'off', midi: 62, audioTime: 0, sourceId: 'pointer:1' });
    await vi.advanceTimersByTimeAsync(50);
    expect(link.take()).toEqual(sameBytes(rgbFrames([{ key: 14, colour: { r: 0, g: 0, b: 0 } }])));
  });

  it('moves the lights with the keyboard’s octave, read from the notes it sends', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    input({ type: 'on', midi: 72, velocity: 1, audioTime: 0, sourceId: 'kbd' }); // C5: key 24
    await vi.advanceTimersByTimeAsync(50);
    link.take();

    link.emit(0x90, 84, 100); // C6 from the keyboard: it must be at OCT+1
    await vi.advanceTimersByTimeAsync(50);
    const moved = link.take();
    // C5 now sits on key 12; key 24 goes dark.
    expect(moved).toEqual(
      sameBytes(
        rgbFrames([
          { key: 12, colour: handLight('right', 1, true) },
          { key: 24, colour: { r: 0, g: 0, b: 0 } },
        ]),
      ),
    );
  });

  it('lets the Multi-Function Button’s hints show, then draws every key again, twice', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    link.emit(0xf0, 0x05, 0x30, 0x10, 0x00, 0x00, 0x3f, 0x16, 0xf7);

    await vi.advanceTimersByTimeAsync(BUTTON_HOLD_MS - 10);
    expect(link.take()).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    const repaint = link.take();
    expect(repaint[0]).toEqual([...enterLedMode()]);
    expect(repaint.length).toBeGreaterThan(1);
    expect(repaint.slice(1).every((frame) => frame[7] === 0x15)).toBe(true);

    await vi.advanceTimersByTimeAsync(BUTTON_REPAINT_MS - BUTTON_HOLD_MS);
    expect(link.take()[0]).toEqual([...enterLedMode()]);
  });

  it('gives the keyboard its own lights back when Key lights is turned off', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    enabled = false;
    settings();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.take()).toEqual([...sameBytes(allDark()), [...builtInMode()]]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(link.take()).toEqual([]);
  });

  it('starts over after a refused frame, without hammering the link', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    link.refuse = true;
    input({ type: 'on', midi: 60, velocity: 1, audioTime: 0, sourceId: 'kbd' });
    await vi.advanceTimersByTimeAsync(10);
    link.refuse = false;
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_FAILURE_MS / 2);
    expect(link.take()).toEqual([]);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_FAILURE_MS);
    expect(link.take()[0]).toEqual([...enterLedMode()]);
  });

  it('hands a USB keyboard back when Bluetooth takes over, and starts the new one fresh', async () => {
    const usb = new FakeLink('usb:1');
    await connect(usb);
    const bluetooth = new FakeLink('bluetooth:1', 'bluetooth');
    links({ links: [bluetooth, usb], usbAwaitingSysex: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(usb.take()).toEqual([...sameBytes(allDark()), [...builtInMode()]]);
    expect(bluetooth.take()[0]).toEqual([...enterLedMode()]);
  });

  it('goes dark while the page is away with nothing playing', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    input({ type: 'on', midi: 60, velocity: 1, audioTime: 0, sourceId: 'kbd' });
    await vi.advanceTimersByTimeAsync(50);
    link.take();
    hidden = true;
    transport();
    await vi.advanceTimersByTimeAsync(50);
    expect(link.take()).toEqual(sameBytes(rgbFrames([{ key: 12, colour: { r: 0, g: 0, b: 0 } }])));
  });

  it('shows what practice and lessons ask for, as soon as it changes', async () => {
    const link = new FakeLink('usb:1');
    await connect(link);
    scenery = {
      targets: new Map<number, 'left' | 'right' | null>([
        [60, 'left'],
        [62, null],
      ]),
      wrong: new Set([64]),
      coming: new Map([[65, 'right' as const]]),
    };
    extrasChanged();
    await vi.advanceTimersByTimeAsync(50);
    expect(link.take()).toEqual(
      sameBytes(
        rgbFrames([
          { key: 12, colour: ledColour(LIGHT_COLOURS.left) },
          { key: 14, colour: ledColour(LIGHT_COLOURS.target) },
          { key: 16, colour: ledColour(LIGHT_COLOURS.wrong) },
          { key: 17, colour: dimLight(LIGHT_COLOURS.right, COMING_LEVEL) },
        ]),
      ),
    );
  });

  it('reports the keyboard it lights, and a USB one waiting on SysEx', () => {
    const c = controller();
    const stopAgain = c.start();
    links({ links: [], usbAwaitingSysex: true });
    expect(c.getStatus()).toEqual({ keyboard: null, usbAwaitingSysex: true });
    links({ links: [new FakeLink('usb:2')], usbAwaitingSysex: false });
    expect(c.getStatus()).toEqual({
      keyboard: { name: 'PartyKeys', transport: 'usb' },
      usbAwaitingSysex: false,
    });
    stopAgain();
  });
});
