import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '@/audio/AudioEngine';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the range an instrument switch reloads', () => {
  it('is the keyboard’s standing request, not a one-off export or demo', async () => {
    // jsdom has no AudioContext; the engine reports that and carries on, which
    // is all this test needs — the remembered range is bookkeeping, not audio.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = new AudioEngine();

    await engine.ensurePlayableRange(36, 84);
    // An export of a take that only spans two notes, then a lesson demo.
    await engine.ensurePlayableRange(60, 62, { remember: false });
    await engine.ensurePlayableRange(72, 76, { remember: false });

    const reload = vi.spyOn(engine, 'ensurePlayableRange');
    await engine.setInstrument('headroom-grand');

    // Remembering the export's span would leave the next piano decoding only
    // those notes, and every key outside it borrowing a sample far away.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(36, 84);
  });
});
