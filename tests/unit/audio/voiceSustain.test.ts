import { describe, expect, it, vi } from 'vitest';
import { VoiceManager } from '@/audio/VoiceManager';

/**
 * These cases never sound a note, so the graph is never touched — a clock is
 * the whole context the pedal bookkeeping needs. jsdom has no Web Audio, the
 * same reason pianoGraph.test.ts hand-stubs its nodes.
 */
function makeVoices() {
  const context = { currentTime: 0 } as unknown as BaseAudioContext;
  const voices = new VoiceManager(context, {} as GainNode);
  const listener = vi.fn();
  voices.subscribeSustain(listener);
  return { voices, listener };
}

describe('VoiceManager sustain state', () => {
  it('reports the damper going down and back up', () => {
    const { voices, listener } = makeVoices();
    voices.setSustain(true, 'kbd-pedal');
    expect(listener).toHaveBeenLastCalledWith(true);
    voices.setSustain(false, 'kbd-pedal');
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('stays down, and stays quiet, while a second source still holds it', () => {
    const { voices, listener } = makeVoices();
    voices.setSustain(true, 'ui-pedal');
    voices.setSustain(true, 'kbd-pedal');
    // The damper never came up, so there was nothing to report.
    expect(listener).toHaveBeenCalledTimes(1);

    voices.setSustain(false, 'ui-pedal');
    expect(voices.sustainDown).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    voices.setSustain(false, 'kbd-pedal');
    expect(voices.sustainDown).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('reports the pedal dropping when a panic reset clears it', () => {
    const { voices, listener } = makeVoices();
    voices.setSustain(true, 'kbd-pedal');
    listener.mockClear();

    // Playback ending or a recording stopping runs this while Space is held.
    voices.allNotesOff();
    expect(voices.sustainDown).toBe(false);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('says nothing when a panic reset finds the pedal already up', () => {
    const { voices, listener } = makeVoices();
    voices.allNotesOff();
    expect(listener).not.toHaveBeenCalled();
  });
});
