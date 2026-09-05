import { describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import { startSampleVoice, releaseSampleVoice, sampleVoiceLevel } from '@/audio/sampleVoice';
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
