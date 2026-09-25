import { describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import {
  moveSampleVoiceRelease,
  startSampleVoice,
  releaseSampleVoice,
  sampleVoiceLevel,
} from '@/audio/sampleVoice';
import { VoiceManager } from '@/audio/VoiceManager';

function setup() {
  const sources: Array<Record<string, unknown>> = [];
  const params: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const context = {
    currentTime: 0,
    createBufferSource: () => {
      const source = {
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(source);
      return source;
    },
    createGain: () => {
      const gain = {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      };
      params.push(gain);
      return { gain, connect: vi.fn(), disconnect: vi.fn() };
    },
  };
  const sample: SampleSelection = {
    buffer: { duration: 3 } as AudioBuffer,
    playbackRate: 0.5,
    gain: 0.8,
    loop: { start: 2, end: 2.1 },
    envelope: { attack: 0.001, hold: 5, decay: 25, release: 0.1 },
  };
  return {
    context,
    sources,
    params,
    sample,
    audio: context as unknown as BaseAudioContext,
    destination: {} as GainNode,
  };
}

describe('shared sample voice', () => {
  it('starts loops at source seconds and retires long held voices', () => {
    const { audio, destination, sample, sources } = setup();
    const voice = startSampleVoice(audio, destination, sample, 1);
    expect(sources[0]).toMatchObject({
      loop: true,
      loopStart: 2,
      loopEnd: 2.1,
      playbackRate: { value: 0.5 },
    });
    expect(vi.mocked(voice.source.stop).mock.calls[0]?.[0]).toBeCloseTo(31.001, 10);
    expect(voice.source.start).toHaveBeenCalledBefore(vi.mocked(voice.source.stop));
    expect(sampleVoiceLevel(voice, 3)).toBe(0.8);
    expect(sampleVoiceLevel(voice, 18.501)).toBeCloseTo(0.4);
    expect(sampleVoiceLevel(voice, 32)).toBe(0);
  });

  it.each([0.0005, 0.001, 2, 5.001, 12, 30.001, 31])(
    'releases continuously at %s seconds, including interrupted ramps',
    (when) => {
      const { audio, destination, sample } = setup();
      const voice = startSampleVoice(audio, destination, sample, 0);
      const before = sampleVoiceLevel(voice, when);
      releaseSampleVoice(voice, when);
      expect(voice.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(before, when);
      expect(sampleVoiceLevel(voice, when + 0.05)).toBeCloseTo(before / 2);
      expect(voice.source.stop).toHaveBeenLastCalledWith(when + 0.1);
    },
  );

  it('moves a release still to come, the envelope playing on to the new one', () => {
    const { audio, destination, sample } = setup();
    const voice = startSampleVoice(audio, destination, sample, 0);
    releaseSampleVoice(voice, 10); // in the decay, which runs from 5.001 to 30.001
    moveSampleVoiceRelease(voice, 20);
    // Still decaying at 15 rather than released, and let go from 20 instead.
    expect(sampleVoiceLevel(voice, 15)).toBeCloseTo(0.8 * (1 - (15 - 5.001) / 25));
    expect(voice.gain.gain.cancelScheduledValues).toHaveBeenNthCalledWith(2, 10);
    expect(voice.gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 20.1);
    expect(voice.source.stop).toHaveBeenLastCalledWith(20.1);
  });

  it('retains the acoustic release and non-looping defaults', () => {
    const { audio, destination } = setup();
    const voice = startSampleVoice(
      audio,
      destination,
      { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 },
      0,
    );
    expect(voice.source.loop).toBeUndefined();
    releaseSampleVoice(voice, 2);
    expect(voice.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 2, 0.07);
    expect(voice.source.stop).toHaveBeenLastCalledWith(2.6);
  });

  it('keeps the loop while pedaled and releases when the pedal lifts', () => {
    const { audio, context, destination, sample, sources } = setup();
    const voices = new VoiceManager(audio, destination);
    voices.noteOn(sample, 61, 'key');
    voices.setSustain(true, 'pedal');
    context.currentTime = 3;
    voices.noteOff(61, 'key');
    const source = sources[0]!;
    expect(source.stop).toHaveBeenCalledTimes(1);
    context.currentTime = 5;
    voices.setSustain(false, 'pedal');
    expect(source.stop).toHaveBeenLastCalledWith(5.1);
    expect(voices.activeMidis().size).toBe(0);
  });

  it('interrupts scheduled playback and pedal holds when switching instruments', () => {
    const { audio, context, destination, sample, sources } = setup();
    const voices = new VoiceManager(audio, destination);
    voices.scheduleNote(sample, 61, 'transport', 0, 10);
    voices.noteOn(sample, 64, 'key');
    voices.setSustain(true, 'pedal');
    voices.noteOff(64, 'key');
    context.currentTime = 4;
    voices.allNotesOff();
    for (const source of sources) expect(source.stop).toHaveBeenLastCalledWith(4.25);
    expect(voices.activeMidis().size).toBe(0);
    expect(voices.sustainDown).toBe(false);
  });
});

describe('VoiceManager when playback changes speed', () => {
  it('calls off a source’s notes not yet begun, silently, and nothing else', () => {
    const { audio, context, destination, sample, sources } = setup();
    const voices = new VoiceManager(audio, destination);
    voices.scheduleNote(sample, 60, 'playback', 0.5, 1); // sounding by 1
    voices.scheduleNote(sample, 62, 'playback', 1.5, 1); // still to come
    voices.scheduleNote(sample, 64, 'learn', 1.5, 1); // another source's
    voices.noteOn(sample, 65, 'key'); // the player's own
    const lit = vi.fn();
    voices.subscribeActiveNotes(lit);
    context.currentTime = 1;
    voices.cancelPending('playback', 1);
    // Stopped before it starts, cut from the graph and gone from the voices.
    expect(sources[1]!.stop).toHaveBeenLastCalledWith(1);
    expect(sources[1]!.disconnect).toHaveBeenCalled();
    expect(voices.voiceCount).toBe(3);
    // Everything else as it was, and nothing lit or unlit.
    expect(sources[0]!.stop).toHaveBeenLastCalledWith(1.6);
    expect(sources[2]!.stop).toHaveBeenLastCalledWith(2.6);
    expect(sources[3]!.stop).toHaveBeenLastCalledWith(30.001);
    expect(lit).not.toHaveBeenCalled();
  });

  it('moves the key-up still to come of a source’s sounding notes', () => {
    const { audio, context, destination, sample, sources } = setup();
    const plain: SampleSelection = { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 };
    const voices = new VoiceManager(audio, destination);
    voices.scheduleNote(sample, 60, 'playback', 0, 2); // key-up at 2
    voices.scheduleNote(plain, 62, 'playback', 0, 3); // key-up at 3
    voices.scheduleNote(sample, 64, 'playback', 0, 0.5); // let go already
    voices.scheduleNote(sample, 65, 'learn', 0, 2); // another source's
    context.currentTime = 1;
    // A quarter of the speed from 1: what was a second away is four.
    voices.retimeReleases('playback', 1, (releaseTime) => 1 + (releaseTime - 1) * 4);
    expect(sources[0]!.stop).toHaveBeenLastCalledWith(5.1);
    expect(sources[1]!.stop).toHaveBeenLastCalledWith(9.6);
    expect(sources[2]!.stop).toHaveBeenLastCalledWith(0.6);
    expect(sources[3]!.stop).toHaveBeenLastCalledWith(2.1);
  });
});
