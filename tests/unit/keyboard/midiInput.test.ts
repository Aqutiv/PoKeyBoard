import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests, getSnapshot } from '@/features/keyboard/midiAccess';
import { MidiInput } from '@/features/keyboard/midiInput';

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;
const BEND = 0xe0;

/** A MIDI port is just an EventTarget as far as this module is concerned. */
class FakePort extends EventTarget {
  id: string;
  name: string;

  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }
}

let ports: Map<string, FakePort>;
let access: EventTarget & { inputs: Map<string, FakePort> };
let requestSpy: ReturnType<typeof vi.fn>;
let hidden = false;

function send(port: FakePort, ...bytes: number[]) {
  // jsdom has no MIDIMessageEvent; MessageEvent's init carries `data`.
  port.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from(bytes) }));
}

function plug(port: FakePort) {
  ports.set(port.id, port);
  access.dispatchEvent(new Event('statechange'));
}

function unplug(port: FakePort) {
  ports.delete(port.id);
  access.dispatchEvent(new Event('statechange'));
}

/** Attaches and waits for the access promise to resolve and bind the ports. */
async function attachInput() {
  const callbacks = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setSustain: vi.fn(),
    shiftRange: vi.fn(),
    setVolume: vi.fn(),
  };
  const input = new MidiInput();
  const detach = input.attach(callbacks);
  await vi.waitFor(() => expect(getSnapshot().kind).toBe('ready'));
  return { ...callbacks, input, detach };
}

function openModal() {
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  return dialog;
}

function setHidden(next: boolean) {
  hidden = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  __resetForTests();
  hidden = false;
  ports = new Map();
  access = Object.assign(new EventTarget(), { inputs: ports });
  requestSpy = vi.fn(() => Promise.resolve(access));
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: requestSpy,
  });
  // MidiInput only opens access that is already granted; the prompt belongs
  // to the Settings toggle.
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: 'granted' }) },
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  __resetForTests();
  document.body.replaceChildren();
});

describe('MidiInput', () => {
  it('does not touch the MIDI API until it is attached', () => {
    new MidiInput();
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('plays a note with the velocity the device sent', async () => {
    const port = new FakePort('a', 'Keystation Mini 32 MK3');
    plug(port);
    const { noteOn } = await attachInput();

    send(port, NOTE_ON, 60, 100);

    expect(noteOn).toHaveBeenCalledWith(60, 100 / 127);
  });

  // The M-Audio Keystation never sends 0x80 at all — this is its only release.
  it('treats a note on with velocity 0 as a release', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn, noteOff } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    noteOn.mockClear();
    send(port, NOTE_ON, 60, 0);

    expect(noteOff).toHaveBeenCalledWith(60);
    expect(noteOn).not.toHaveBeenCalled();
  });

  it('releases on a note off, ignoring its release velocity', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOff } = await attachInput();

    send(port, NOTE_ON, 64, 80);
    send(port, NOTE_OFF, 64, 64);

    expect(noteOff).toHaveBeenCalledWith(64);
  });

  it('ignores a release for a note it never started', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOff } = await attachInput();

    send(port, NOTE_OFF, 64, 0);

    expect(noteOff).not.toHaveBeenCalled();
  });

  it('does not retrigger a note that is already sounding', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    send(port, NOTE_ON, 60, 40);

    expect(noteOn).toHaveBeenCalledTimes(1);
  });

  it('plays notes on any channel', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn } = await attachInput();

    send(port, NOTE_ON | 0x01, 60, 90);
    send(port, NOTE_ON | 0x09, 67, 90);

    expect(noteOn).toHaveBeenCalledTimes(2);
  });

  it('drops notes outside the piano', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn } = await attachInput();

    send(port, NOTE_ON, 20, 90);
    send(port, NOTE_ON, 109, 90);

    expect(noteOn).not.toHaveBeenCalled();
  });

  it('works the sustain pedal on the CC64 threshold', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { setSustain } = await attachInput();

    send(port, CC, 64, 127);
    expect(setSustain).toHaveBeenLastCalledWith(true);
    send(port, CC, 64, 63);
    expect(setSustain).toHaveBeenLastCalledWith(false);
    send(port, CC, 64, 64);
    expect(setSustain).toHaveBeenLastCalledWith(true);
  });

  // Every setSustain reaches the recorder, so a streaming pedal must not
  // write a run of meaningless events into the take.
  it('reports the pedal only when it changes side', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { setSustain } = await attachInput();

    send(port, CC, 64, 127);
    send(port, CC, 64, 100);
    send(port, CC, 64, 80);

    expect(setSustain).toHaveBeenCalledTimes(1);
  });

  it('maps CC7 to the master volume and ignores the mod wheel', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { setVolume } = await attachInput();

    send(port, CC, 7, 64);
    expect(setVolume).toHaveBeenCalledWith(64 / 127);

    setVolume.mockClear();
    send(port, CC, 1, 100);
    expect(setVolume).not.toHaveBeenCalled();
  });

  it('shifts the range once per bend press, not once per message', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { shiftRange } = await attachInput();

    // A bend button ramps smoothly; every step past the threshold arrives.
    for (let msb = 64; msb >= 20; msb -= 1) send(port, BEND, 0, msb);
    expect(shiftRange).toHaveBeenCalledTimes(1);
    expect(shiftRange).toHaveBeenCalledWith(-1);

    // Only once it returns to centre can the next press shift again.
    for (let msb = 20; msb <= 64; msb += 1) send(port, BEND, 0, msb);
    expect(shiftRange).toHaveBeenCalledTimes(1);
    for (let msb = 64; msb <= 110; msb += 1) send(port, BEND, 0, msb);
    expect(shiftRange).toHaveBeenCalledTimes(2);
    expect(shiftRange).toHaveBeenLastCalledWith(1);
  });

  it('ignores clock, active sensing, sysex and truncated messages', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn, noteOff, setSustain } = await attachInput();

    send(port, 0xf8);
    send(port, 0xfe);
    send(port, 0xf0, 0x7e, 0x00, 0xf7);
    send(port, 0x90);

    expect(noteOn).not.toHaveBeenCalled();
    expect(noteOff).not.toHaveBeenCalled();
    expect(setSustain).not.toHaveBeenCalled();
  });

  it('releases everything on an all-notes-off panic', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOff, setSustain } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    send(port, NOTE_ON, 64, 90);
    send(port, CC, 64, 127);
    send(port, CC, 123, 0);

    expect(noteOff).toHaveBeenCalledWith(60);
    expect(noteOff).toHaveBeenCalledWith(64);
    expect(setSustain).toHaveBeenLastCalledWith(false);
  });

  it('picks up a device plugged in after it attached', async () => {
    const { noteOn } = await attachInput();
    const port = new FakePort('late', 'pad');
    plug(port);

    send(port, NOTE_ON, 60, 90);

    expect(noteOn).toHaveBeenCalledWith(60, 90 / 127);
  });

  // A yanked cable never delivers the note-off for what it was holding.
  it('releases what an unplugged device was holding', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOff } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    unplug(port);

    expect(noteOff).toHaveBeenCalledWith(60);
  });

  // Two keyboards connected: pulling one must not cut off the other.
  it('releases only the unplugged port, leaving another device holding', async () => {
    const a = new FakePort('a', 'first');
    const b = new FakePort('b', 'second');
    plug(a);
    plug(b);
    const { noteOn, noteOff, setSustain } = await attachInput();

    a.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([NOTE_ON, 60, 90]) }));
    b.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([NOTE_ON, 67, 90]) }));
    b.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([CC, 64, 127]) }));
    expect(noteOn).toHaveBeenCalledTimes(2);

    unplug(a);

    expect(noteOff).toHaveBeenCalledWith(60);
    expect(noteOff).not.toHaveBeenCalledWith(67);
    // The pedal belongs to the device still connected.
    expect(setSustain).not.toHaveBeenCalledWith(false);
  });

  it('keeps the pedal down while any port still holds it', async () => {
    const a = new FakePort('a', 'first');
    const b = new FakePort('b', 'second');
    plug(a);
    plug(b);
    const { setSustain } = await attachInput();

    a.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([CC, 64, 127]) }));
    b.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([CC, 64, 127]) }));
    expect(setSustain).toHaveBeenCalledTimes(1);

    a.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([CC, 64, 0]) }));
    expect(setSustain).toHaveBeenCalledTimes(1);

    b.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from([CC, 64, 0]) }));
    expect(setSustain).toHaveBeenLastCalledWith(false);
  });

  it('stands down while the tab is hidden and swallows the release that follows', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn, noteOff } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    setHidden(true);
    expect(noteOff).toHaveBeenCalledWith(60);

    noteOn.mockClear();
    noteOff.mockClear();
    send(port, NOTE_ON, 64, 90);
    expect(noteOn).not.toHaveBeenCalled();
    // The hardware still releases the key it was holding.
    send(port, NOTE_ON, 64, 0);
    expect(noteOff).not.toHaveBeenCalled();

    setHidden(false);
    send(port, NOTE_ON, 67, 90);
    expect(noteOn).toHaveBeenCalledWith(67, 90 / 127);
  });

  it('keeps playing when the window loses focus', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn, noteOff } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    window.dispatchEvent(new Event('blur'));

    expect(noteOff).not.toHaveBeenCalled();
    send(port, NOTE_ON, 64, 90);
    expect(noteOn).toHaveBeenCalledTimes(2);
  });

  it('stands down while a modal is open', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn } = await attachInput();

    const dialog = openModal();
    send(port, NOTE_ON, 60, 90);
    expect(noteOn).not.toHaveBeenCalled();

    dialog.remove();
    send(port, NOTE_ON, 60, 90);
    expect(noteOn).toHaveBeenCalledTimes(1);
  });

  it('stops listening once detached', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { noteOn, noteOff, detach } = await attachInput();

    send(port, NOTE_ON, 60, 90);
    detach();
    expect(noteOff).toHaveBeenCalledWith(60);

    noteOn.mockClear();
    send(port, NOTE_ON, 64, 90);
    expect(noteOn).not.toHaveBeenCalled();
  });

  it('binds nothing when it detaches before access resolves', async () => {
    const port = new FakePort('a', 'pad');
    ports.set(port.id, port);
    const noteOn = vi.fn();
    const detach = new MidiInput().attach({
      noteOn,
      noteOff: vi.fn(),
      setSustain: vi.fn(),
      shiftRange: vi.fn(),
      setVolume: vi.fn(),
    });

    detach();
    await vi.waitFor(() => expect(getSnapshot().kind).toBe('ready'));
    send(port, NOTE_ON, 60, 90);

    expect(noteOn).not.toHaveBeenCalled();
  });

  it('survives a denied permission prompt', async () => {
    requestSpy.mockRejectedValueOnce(new DOMException('nope', 'NotAllowedError'));
    const detach = new MidiInput().attach({
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      setSustain: vi.fn(),
      shiftRange: vi.fn(),
      setVolume: vi.fn(),
    });

    await vi.waitFor(() => expect(getSnapshot().kind).toBe('denied'));
    expect(() => detach()).not.toThrow();
  });

  it('uses the fixed velocity when that mode is on', async () => {
    const port = new FakePort('a', 'pad');
    plug(port);
    const { input, noteOn } = await attachInput();
    input.setVelocityMode('fixed');
    input.setVelocity(0.4);

    send(port, NOTE_ON, 60, 127);

    expect(noteOn).toHaveBeenCalledWith(60, 0.4);
  });
});
