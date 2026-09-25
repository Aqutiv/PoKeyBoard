import { describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import {
  cappedRenderSeconds,
  MAX_RENDER_MINUTES,
  scheduleTakeVoices,
  undampedRingOutSeconds,
} from '@/audio/OfflineTakeRenderer';
import { createEmptyTake } from '@/domain/noteEvents';
import {
  RELEASE_TC,
  releaseSampleVoice,
  releaseTcFor,
  RESTRIKE_TC,
  sampleVoiceLevel,
  startSampleVoice,
  UNDAMPED_FROM_MIDI,
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

  it('starts a voice at its sample’s onset, not at the top of the buffer', () => {
    const { audio, destination } = setup();
    const voice = startSampleVoice(
      audio,
      destination,
      { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1, offset: 0.011 },
      2,
    );
    expect(voice.source.start).toHaveBeenCalledWith(2, 0.011);
  });

  it('damps a bass string more slowly than a treble one', () => {
    expect(releaseTcFor(21)).toBeGreaterThan(releaseTcFor(60));
    expect(releaseTcFor(60)).toBeGreaterThan(releaseTcFor(84));
    const { audio, destination } = setup();
    const bass = startSampleVoice(
      audio,
      destination,
      { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1, releaseTc: releaseTcFor(21) },
      0,
    );
    releaseSampleVoice(bass, 1);
    expect(bass.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, releaseTcFor(21));
    // Left long enough to fall away under its slower damper.
    expect(vi.mocked(bass.source.stop).mock.calls.at(-1)?.[0]).toBeCloseTo(
      1 + releaseTcFor(21) * 8,
      10,
    );
  });

  it('lets a string with no damper ring on when its key comes up', () => {
    const { audio, destination } = setup();
    const top = startSampleVoice(
      audio,
      destination,
      { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1, undamped: true },
      0,
    );
    releaseSampleVoice(top, 1);
    expect(top.gain.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(top.source.stop).not.toHaveBeenCalled();
    expect(sampleVoiceLevel(top, 2)).toBe(1);
    expect(UNDAMPED_FROM_MIDI).toBeGreaterThan(84);
  });

  describe('striking a key that still sounds', () => {
    const plain: SampleSelection = { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 };

    it('fades the old sound from the moment the new one starts', () => {
      const { audio, context, destination, sources, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 64, 'key');
      voices.setSustain(true, 'pedal');
      voices.noteOff(64, 'key'); // held by the pedal
      context.currentTime = 1;
      voices.noteOn(plain, 64, 'key');
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, RESTRIKE_TC);
      expect(sources[0]!.stop).toHaveBeenLastCalledWith(1 + RESTRIKE_TC * 8);
      // The new strike is untouched, and so is any other key.
      expect(params[1]!.setTargetAtTime).not.toHaveBeenCalled();
    });

    it('damps across sources: one key is one string', () => {
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 60, 'midi');
      voices.noteOn(plain, 62, 'midi');
      voices.noteOn(plain, 60, 'pointer:1', 0.5);
      expect(params[0]!.setTargetAtTime).toHaveBeenCalledWith(0, 0.5, RESTRIKE_TC);
      expect(params[1]!.setTargetAtTime).not.toHaveBeenCalled();
      // The finger's note is the one lit now.
      expect([...voices.activeMidis()]).toEqual(expect.arrayContaining([60, 62]));
    });

    it('leaves a playback note scheduled for later alone', () => {
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 2, 1);
      voices.noteOn(plain, 67, 'key', 0.5); // struck before that note is due
      expect(params[0]!.setTargetAtTime).not.toHaveBeenCalledWith(0, 0.5, RESTRIKE_TC);
    });

    it('damps a playback note at its own scheduled start, not early', () => {
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0, 4);
      voices.scheduleNote(plain, 67, 'playback', 1.5, 1);
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1.5, RESTRIKE_TC);
    });

    it('keeps the key down for the longer of the two notes', () => {
      // A half note with an eighth struck inside it on the same key, the way
      // two voices share one: the new strike rings on to the half note's end.
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0, 4);
      voices.scheduleNote(plain, 67, 'playback', 1.5, 1);
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 4, RELEASE_TC);
    });

    it('strikes a note two voices share once', () => {
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 1, 2);
      voices.scheduleNote(plain, 67, 'playback', 1, 0.5);
      // The first never sounds: it is damped from its own start...
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, RESTRIKE_TC);
      // ...and the one that does is held for the longer value.
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 3, RELEASE_TC);
    });

    it('leaves a held key its own until playback strikes it again', () => {
      // Playback schedules ahead: its strike is still 150 ms off.
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 60, 'key');
      voices.scheduleNote(plain, 60, 'playback', 0.15, 1);
      // Still held, so still lit...
      expect(voices.activeMidis().has(60)).toBe(true);
      // ...and let go before that strike, it is damped as any key is, until
      // the strike silences what is left of the string.
      context.currentTime = 0.1;
      voices.noteOff(60, 'key');
      expect(params[0]!.setTargetAtTime).toHaveBeenCalledWith(0, 0.1, RELEASE_TC);
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.15, RESTRIKE_TC);
      expect(voices.activeMidis().has(60)).toBe(false);
    });

    it('damps a string still dying away after its key came up', () => {
      // A quick repeat: let go at 0.1 s and struck again 60 ms later, when the
      // damper has only begun to quiet the string.
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 64, 'key');
      context.currentTime = 0.1;
      voices.noteOff(64, 'key');
      context.currentTime = 0.16;
      voices.noteOn(plain, 64, 'key');
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.16, RESTRIKE_TC);
    });

    it('leaves a string a stop is already fading alone', () => {
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 64, 'key');
      context.currentTime = 1;
      voices.allNotesOff();
      context.currentTime = 1.05;
      voices.noteOn(plain, 64, 'key');
      // Not lifted back to full level only to be faded again.
      expect(params[0]!.setValueAtTime).not.toHaveBeenCalledWith(1, 1.05);
      expect(params[0]!.setTargetAtTime).toHaveBeenCalledTimes(1);
    });

    it('gives way to a strike playback queued before the key was played', () => {
      // Playback's strike of the key is already queued, 150 ms off, when the
      // player strikes it by hand: both must not sound together.
      const { audio, destination, params, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0.15, 1);
      voices.noteOn(plain, 67, 'key');
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.15, RESTRIKE_TC);
      expect(sources[1]!.stop).toHaveBeenLastCalledWith(0.15 + RESTRIKE_TC * 8);
      // Until then the key is the player's, lit while held.
      expect(voices.activeMidis().has(67)).toBe(true);
    });

    it('still gives way to a strike that comes before the queued one', () => {
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0.15, 1);
      voices.noteOn(plain, 67, 'midi'); // due to give way at 0.15
      context.currentTime = 0.05;
      voices.noteOn(plain, 67, 'pointer:1');
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.05, RESTRIKE_TC);
      expect(params[2]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.15, RESTRIKE_TC);
    });

    it('ignores a queued strike that a panic stop called off', () => {
      const { audio, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0.15, 1);
      voices.allNotesOff(); // paused before it was due
      voices.noteOn(plain, 67, 'key');
      expect(params[1]!.setTargetAtTime).not.toHaveBeenCalled();
    });

    it('stops lighting a held key once its sound has ended', () => {
      const { audio, destination, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      const listener = vi.fn();
      voices.subscribeActiveNotes(listener);
      voices.noteOn(plain, 60, 'key');
      expect(listener).toHaveBeenLastCalledWith(new Set([60]));
      (sources[0]!.onended as () => void)();
      expect(listener).toHaveBeenLastCalledWith(new Set());
    });

    it('sounds the same in an export', () => {
      const { audio, destination, params } = setup();
      const missing = scheduleTakeVoices(
        audio,
        destination,
        [
          { midi: 67, velocity: 0.7, startMs: 0, durationMs: 4000 },
          { midi: 67, velocity: 0.7, startMs: 1500, durationMs: 1000 },
          // Released at 1 s, long before it comes back: its tail is left alone.
          { midi: 72, velocity: 0.7, startMs: 0, durationMs: 1000 },
          { midi: 72, velocity: 0.7, startMs: 3000, durationMs: 500 },
          // Shared by two voices.
          { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 2000 },
          { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 500 },
        ],
        () => plain,
      );
      expect(missing).toBe(0);
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1.5, RESTRIKE_TC);
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 4, RELEASE_TC);
      expect(params[2]!.setTargetAtTime).not.toHaveBeenCalledWith(0, 3, RESTRIKE_TC);
      expect(params[3]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 3.5, RELEASE_TC);
      expect(params[4]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, RESTRIKE_TC);
      expect(params[5]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 3, RELEASE_TC);
    });

    it('damps a string still dying away in an export too', () => {
      const { audio, destination, params } = setup();
      scheduleTakeVoices(
        audio,
        destination,
        [
          { midi: 64, velocity: 0.7, startMs: 0, durationMs: 100 },
          { midi: 64, velocity: 0.7, startMs: 160, durationMs: 100 },
        ],
        () => plain,
      );
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.16, RESTRIKE_TC);
    });
  });

  it('makes room in an export for the top strings to ring out', () => {
    // No damper above F♯6: a short last note still rings its whole recording.
    const ringing: SampleSelection = {
      buffer: { duration: 5.8 } as AudioBuffer,
      playbackRate: 1,
      gain: 1,
      offset: 0.01,
      undamped: true,
    };
    const notes = [
      { midi: 60, velocity: 0.7, startMs: 0, durationMs: 9000 },
      { midi: UNDAMPED_FROM_MIDI + 2, velocity: 0.7, startMs: 10_000, durationMs: 200 },
    ];
    const sampleFor = (midi: number) => (midi >= UNDAMPED_FROM_MIDI ? ringing : null);
    expect(undampedRingOutSeconds(notes, sampleFor)).toBeCloseTo(15.79, 5);
    expect(undampedRingOutSeconds(notes.slice(0, 1), sampleFor)).toBe(0);
  });

  it('keeps the ring-out inside the render cap', () => {
    const cap = MAX_RENDER_MINUTES * 60;
    // Its last key comes up 4 s short of the cap: with the tail, inside it.
    const take = createEmptyTake({
      notes: [{ id: 'top', midi: 96, velocity: 0.7, startMs: (cap - 5) * 1000, durationMs: 1000 }],
      durationMs: (cap - 4) * 1000,
    });
    expect(cappedRenderSeconds(take, 0)).toBe(cap - 1);
    // But that top string rings on for 5.8 s, past the cap, and stops there.
    expect(cappedRenderSeconds(take, cap - 5 + 5.8)).toBe(cap);
  });

  describe('a panic stop', () => {
    const plain: SampleSelection = { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 };

    it('silences a key with no damper that was already let go', () => {
      const { audio, context, destination, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn({ ...plain, undamped: true }, 96, 'key');
      context.currentTime = 1;
      voices.noteOff(96, 'key'); // rings on: nothing to damp it
      expect(sources[0]!.stop).not.toHaveBeenCalled();
      context.currentTime = 2;
      voices.allNotesOff();
      expect(sources[0]!.stop).toHaveBeenLastCalledWith(2.25);
    });

    it('silences a string only due to be damped later', () => {
      const { audio, context, destination, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0, 4);
      voices.scheduleNote(plain, 67, 'playback', 1.5, 1); // damps the first at 1.5
      context.currentTime = 1;
      voices.allNotesOff();
      for (const source of sources) expect(source.stop).toHaveBeenLastCalledWith(1.25);
    });
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
