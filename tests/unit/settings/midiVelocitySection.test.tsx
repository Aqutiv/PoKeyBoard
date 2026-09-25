import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests as resetAccess, getSnapshot } from '@/features/keyboard/midiAccess';
import { MidiInput } from '@/features/keyboard/midiInput';
import { MidiSection } from '@/features/settings/MidiSection';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

const NOTE_ON = 0x90;

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
let port: FakePort;
let detachInput: (() => void) | null = null;
/** What performance.now() reads when a strike arrives. */
let clockMs = 0;

/**
 * One key struck and let go, a second after the last. The section times the
 * strike itself, so the clock is only pinned for as long as it arrives.
 */
function strike(raw: number, pitch = 60) {
  clockMs += 1000;
  const now = vi.spyOn(performance, 'now').mockReturnValue(clockMs);
  act(() => {
    port.dispatchEvent(
      new MessageEvent('midimessage', { data: Uint8Array.from([NOTE_ON, pitch, raw]) }),
    );
  });
  now.mockRestore();
  port.dispatchEvent(
    new MessageEvent('midimessage', { data: Uint8Array.from([NOTE_ON, pitch, 0]) }),
  );
}

/** The device as the app shell owns it: attached, and playing into nothing here. */
async function connectKeyboard() {
  const input = new MidiInput();
  detachInput = input.attach({
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setSustain: vi.fn(),
    shiftRange: vi.fn(),
    setVolume: vi.fn(),
  });
  await vi.waitFor(() => expect(getSnapshot().kind).toBe('ready'));
}

function renderSection() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <MidiSection />
    </I18nContext.Provider>,
  );
}

function calibrateButton() {
  return screen.getByRole('button', { name: en.settings.midiCalibrate });
}

beforeEach(() => {
  resetAccess();
  clockMs = 0;
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS, midiInput: true });
  ports = new Map();
  port = new FakePort('a', 'Keystation Mini 32 MK3');
  ports.set(port.id, port);
  const access = Object.assign(new EventTarget(), { inputs: ports });
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: () => Promise.resolve(access),
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: 'granted' }) },
  });
});

afterEach(() => {
  // No `globals: true`, so RTL's auto-cleanup is not registered.
  cleanup();
  detachInput?.();
  detachInput = null;
  vi.restoreAllMocks();
  resetAccess();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

describe('MIDI velocity settings', () => {
  it('calibrates inline from the softest and loudest notes played, and resets', async () => {
    await connectKeyboard();
    renderSection();
    expect(screen.getByRole('status')).toHaveTextContent(en.settings.midiRangeNone);

    fireEvent.click(calibrateButton());
    expect(screen.getByRole('status')).toHaveTextContent(en.settings.midiCalibrateSoftest);

    strike(23);
    expect(screen.getByRole('status')).toHaveTextContent(
      en.settings.midiCalibrateLoudest({ softest: 23 }),
    );

    strike(118, 64);
    expect(useSettingsStore.getState().midiVelocityRange).toEqual({ min: 23, max: 118 });
    expect(screen.getByRole('status')).toHaveTextContent(
      en.settings.midiRangeSet({ min: 23, max: 118 }),
    );

    fireEvent.click(screen.getByRole('button', { name: en.settings.midiCalibrateReset }));
    expect(useSettingsStore.getState().midiVelocityRange).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(en.settings.midiRangeNone);
    expect(screen.queryByRole('button', { name: en.settings.midiCalibrateReset })).toBeNull();
  });

  it('turns down a loudest note that is not clearly louder, keeping the range it had', async () => {
    useSettingsStore.setState({ midiVelocityRange: { min: 10, max: 100 } });
    await connectKeyboard();
    renderSection();

    fireEvent.click(calibrateButton());
    strike(60);
    strike(70);

    expect(screen.getByRole('alert')).toHaveTextContent(en.settings.midiCalibrateRejected);
    expect(useSettingsStore.getState().midiVelocityRange).toEqual({ min: 10, max: 100 });
    expect(screen.getByRole('status')).toHaveTextContent(
      en.settings.midiRangeSet({ min: 10, max: 100 }),
    );

    // Trying again clears the complaint.
    fireEvent.click(calibrateButton());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops listening once cancelled', async () => {
    await connectKeyboard();
    renderSection();

    fireEvent.click(calibrateButton());
    strike(30);
    fireEvent.click(screen.getByRole('button', { name: en.settings.midiCalibrateCancel }));
    strike(20);
    strike(120);

    expect(useSettingsStore.getState().midiVelocityRange).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(en.settings.midiRangeNone);
  });

  it('stops listening when MIDI is turned off mid-calibration', async () => {
    await connectKeyboard();
    renderSection();

    fireEvent.click(calibrateButton());
    act(() => useSettingsStore.setState({ midiInput: false }));
    strike(20);
    strike(120);
    act(() => useSettingsStore.setState({ midiInput: true }));

    expect(useSettingsStore.getState().midiVelocityRange).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(en.settings.midiRangeNone);
  });

  it('offers calibration only while a keyboard is connected', async () => {
    ports.clear();
    await connectKeyboard();
    renderSection();

    expect(calibrateButton()).toBeDisabled();
  });

  it('saves the velocity curve chosen', async () => {
    await connectKeyboard();
    renderSection();

    const curves = screen.getByRole('radiogroup', { name: en.settings.midiVelocityCurve });
    expect(curves).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: en.settings.midiCurveHeavy }));

    expect(useSettingsStore.getState().midiVelocityCurve).toBe('heavy');
  });

  it('leaves the curve and calibration out while velocity is fixed', async () => {
    useSettingsStore.setState({ velocityMode: 'fixed' });
    await connectKeyboard();
    renderSection();

    expect(screen.queryByRole('radiogroup', { name: en.settings.midiVelocityCurve })).toBeNull();
    expect(screen.queryByRole('button', { name: en.settings.midiCalibrate })).toBeNull();
  });
});
