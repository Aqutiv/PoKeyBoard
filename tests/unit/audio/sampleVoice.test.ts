import { describe, expect, it, vi } from 'vitest';
import type { SampleSelection } from '@/audio/audioTypes';
import {
  cappedRenderSeconds,
  MAX_RENDER_MINUTES,
  scheduleTakeVoices,
  scheduleVoicesAhead,
  undampedRingOutSeconds,
} from '@/audio/OfflineTakeRenderer';
import { createEmptyTake } from '@/domain/noteEvents';
import {
  ATTACK_S,
  dampSampleVoice,
  moveSampleVoiceRelease,
  RELEASE_TC,
  releaseSampleVoice,
  releaseTcFor,
  RESTRIKE_TC,
  sampleVoiceLevel,
  startSampleVoice,
  TONE_FILTER_Q_DB,
  UNDAMPED_FROM_MIDI,
} from '@/audio/sampleVoice';
import { VoiceManager } from '@/audio/VoiceManager';

function setup() {
  const sources: Array<Record<string, unknown>> = [];
  const params: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const filters: Array<{
    type: string;
    frequency: { value: number };
    Q: { value: number };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    currentTime: 0,
    sampleRate: 48_000,
    createBiquadFilter: () => {
      const filter = {
        type: 'lowpass',
        frequency: { value: 350 },
        Q: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(filter);
      return filter;
    },
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
    filters,
    sample,
    audio: context as unknown as BaseAudioContext,
    destination: {} as GainNode,
  };
}

/** What each mock node was told to do, beyond being wired up, in the order it was told. */
function callsTo(nodes: readonly Record<string, unknown>[]): unknown[][][] {
  return nodes.map((node) =>
    Object.entries(node)
      .filter(([name, value]) => vi.isMockFunction(value) && !name.endsWith('connect'))
      .flatMap(([name, value]) => {
        const { calls, invocationCallOrder } = (value as ReturnType<typeof vi.fn>).mock;
        return calls.map((args, i) => ({ order: invocationCallOrder[i]!, call: [name, ...args] }));
      })
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.call),
  );
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
    expect(voice.stopTime).toBe(20.1);
  });

  it('moves only a key-up: none on a string without a damper, nor a strike’s fade', () => {
    const { audio, destination } = setup();
    const plain: SampleSelection = { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 };
    const top = startSampleVoice(audio, destination, { ...plain, undamped: true }, 0);
    releaseSampleVoice(top, 1); // no damper, so it rings on
    moveSampleVoiceRelease(top, 2);
    expect(top.releaseTime).toBeUndefined();
    expect(top.source.stop).not.toHaveBeenCalled();
    // A strike's fade goes with its strike, not with a change of speed.
    const struck = startSampleVoice(audio, destination, plain, 0);
    dampSampleVoice(struck, 1);
    moveSampleVoiceRelease(struck, 2);
    expect(struck.releaseTime).toBe(1);
    expect(struck.stopTime).toBe(1 + RESTRIKE_TC * 8);
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
      const notes = [
        { midi: 67, velocity: 0.7, startMs: 0, durationMs: 4000 },
        { midi: 67, velocity: 0.7, startMs: 1500, durationMs: 1000 },
        // Released at 1 s, long before it comes back: its tail is left alone.
        { midi: 72, velocity: 0.7, startMs: 0, durationMs: 1000 },
        { midi: 72, velocity: 0.7, startMs: 3000, durationMs: 500 },
        // Shared by two voices.
        { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 2000 },
        { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 500 },
      ];
      scheduleTakeVoices(
        audio,
        destination,
        notes,
        notes.map(() => plain),
      )(Number.POSITIVE_INFINITY);
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1.5, RESTRIKE_TC);
      expect(params[1]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 4, RELEASE_TC);
      expect(params[2]!.setTargetAtTime).not.toHaveBeenCalledWith(0, 3, RESTRIKE_TC);
      expect(params[3]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 3.5, RELEASE_TC);
      expect(params[4]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 1, RESTRIKE_TC);
      expect(params[5]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 3, RELEASE_TC);
    });

    it('damps a string still dying away in an export too', () => {
      const { audio, destination, params } = setup();
      const notes = [
        { midi: 64, velocity: 0.7, startMs: 0, durationMs: 100 },
        { midi: 64, velocity: 0.7, startMs: 160, durationMs: 100 },
      ];
      scheduleTakeVoices(
        audio,
        destination,
        notes,
        notes.map(() => plain),
      )(Number.POSITIVE_INFINITY);
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.16, RESTRIKE_TC);
    });

    it('makes the same voices for an export a stretch at a time as all at once', () => {
      const notes = [
        { midi: 67, velocity: 0.7, startMs: 0, durationMs: 4000 },
        { midi: 72, velocity: 0.7, startMs: 0, durationMs: 1000 },
        { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 2000 },
        { midi: 76, velocity: 0.7, startMs: 1000, durationMs: 500 },
        { midi: 67, velocity: 0.7, startMs: 1500, durationMs: 1000 },
        { midi: 72, velocity: 0.7, startMs: 3000, durationMs: 500 },
      ];
      const made = (stretches: number[]) => {
        const { audio, destination, params, sources } = setup();
        const scheduleUntil = scheduleTakeVoices(
          audio,
          destination,
          notes,
          notes.map(() => plain),
        );
        for (const until of stretches) scheduleUntil(until);
        return { params: callsTo(params), sources: callsTo(sources) };
      };
      expect(made([1]).sources).toHaveLength(2);
      // The G struck again at 1.5 s still damps the one struck at 0, a stretch back.
      expect(made([1, 1.2, 2, 3.5, Number.POSITIVE_INFINITY])).toEqual(
        made([Number.POSITIVE_INFINITY]),
      );
    });
  });

  describe('an export render', () => {
    const plain: SampleSelection = { buffer: {} as AudioBuffer, playbackRate: 1, gain: 1 };
    const notesAt = (...seconds: number[]) =>
      seconds.map((at) => ({ midi: 60, velocity: 0.7, startMs: at * 1000, durationMs: 400 }));

    /** The mock context as an offline one `seconds` long, pausing when asked to. */
    function offline(seconds: number, canPause = true) {
      const { audio, destination, sources } = setup();
      const pauses: { at: number; resolve: () => void; reject: (error: Error) => void }[] = [];
      const resume = vi.fn(async () => undefined);
      const pausing = {
        suspend: (at: number) =>
          new Promise<void>((resolve, reject) => pauses.push({ at, resolve, reject })),
        resume,
      };
      const context = Object.assign(audio, {
        length: seconds * 48_000,
        sampleRate: 48_000,
        ...(canPause ? pausing : {}),
      }) as unknown as OfflineAudioContext;
      return { context, destination, sources, pauses, resume };
    }

    it('makes its voices a stretch or two ahead, pausing to make more', async () => {
      const { context, destination, sources, pauses, resume } = offline(9);
      const notes = notesAt(0, 3, 4.5, 7);
      const done = scheduleVoicesAhead(
        context,
        scheduleTakeVoices(
          context,
          destination,
          notes,
          notes.map(() => plain),
        ),
      );
      expect(pauses.map((pause) => pause.at)).toEqual([2, 4, 6, 8]);
      expect(sources).toHaveLength(2); // Those before 4 s.
      pauses[0]!.resolve();
      await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
      expect(sources).toHaveLength(3); // Before 6 s.
      for (const pause of pauses.slice(1)) pause.resolve();
      await done;
      expect(sources).toHaveLength(4);
      expect(resume).toHaveBeenCalledTimes(4);
    });

    it('makes every voice up front where an offline render cannot pause', async () => {
      const { context, destination, sources } = offline(60, false);
      const notes = notesAt(0, 30, 55);
      await scheduleVoicesAhead(
        context,
        scheduleTakeVoices(
          context,
          destination,
          notes,
          notes.map(() => plain),
        ),
      );
      expect(sources).toHaveLength(3);
    });

    it('makes every voice still to come at once when a pause is refused', async () => {
      const { context, destination, sources, pauses } = offline(9);
      const notes = notesAt(0, 3, 4.5, 7);
      const done = scheduleVoicesAhead(
        context,
        scheduleTakeVoices(
          context,
          destination,
          notes,
          notes.map(() => plain),
        ),
      );
      pauses[0]!.reject(new Error('refused'));
      for (const pause of pauses.slice(1)) pause.resolve();
      await done;
      expect(sources).toHaveLength(4);
    });

    it('lets the render go on when a voice cannot be made, and says why', async () => {
      const { context, pauses, resume } = offline(5);
      const failure = new Error('no voice');
      const done = scheduleVoicesAhead(context, (until) => {
        if (until > 4) throw failure;
      });
      for (const pause of pauses) pause.resolve();
      await expect(done).rejects.toBe(failure);
      await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(pauses.length));
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

  describe('a string due to be struck again', () => {
    const plain: SampleSelection = {
      buffer: { duration: 10 } as AudioBuffer,
      playbackRate: 1,
      gain: 1,
    };
    /** Half speed from `now`: what was a second away is two. */
    const halfSpeed = (now: number) => (t: number) => now + (t - now) * 2;

    it('fades once, at the strike put back, and still holds the key for the note it cut', () => {
      // A half note on 67 with an eighth struck inside it: the eighth fades it
      // at 1.5 and keeps the key down for the half note, to 4.
      const { audio, context, destination, params, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 67, 'playback', 0, 4);
      voices.scheduleNote(plain, 67, 'playback', 1.5, 1);
      context.currentTime = 1;
      params[0]!.setTargetAtTime!.mockClear();
      const at = halfSpeed(1);
      voices.cancelPending('playback', 1);
      voices.retimeReleases('playback', 1, at);
      voices.scheduleNote(plain, 67, 'playback', at(1.5), 2);
      // The fade at 1.5 is withdrawn, and the half note fades once, at the
      // eighth's new start, as a string struck again...
      expect(params[0]!.cancelScheduledValues).toHaveBeenCalledWith(1.5);
      const fades = params[0]!.setTargetAtTime!.mock.calls.filter(([, , tc]) => tc === RESTRIKE_TC);
      expect(fades).toEqual([[0, 2, RESTRIKE_TC]]);
      expect(sources[0]!.stop).toHaveBeenLastCalledWith(2 + RESTRIKE_TC * 8);
      // ...and the eighth holds the key down to the half note's end, now at 7.
      expect(params[2]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 7, RELEASE_TC);
    });

    it('fades a string let go before its strike from where its damper has it', () => {
      // Staccato on one key: let go at 0.25, struck again at 0.375.
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(plain, 64, 'playback', 0, 0.25);
      voices.scheduleNote(plain, 64, 'playback', 0.375, 0.25);
      context.currentTime = 0.125;
      const at = halfSpeed(0.125);
      voices.cancelPending('playback', 0.125);
      voices.retimeReleases('playback', 0.125, at);
      voices.scheduleNote(plain, 64, 'playback', at(0.375), 0.5);
      // Let go at 0.375 now, and faded at 0.625 from its damper's level then,
      // not lifted back to where it was while held.
      expect(params[0]!.setTargetAtTime).toHaveBeenCalledWith(0, 0.375, RELEASE_TC);
      expect(params[0]!.setValueAtTime).toHaveBeenLastCalledWith(
        Math.exp(-0.25 / RELEASE_TC),
        0.625,
      );
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.625, RESTRIKE_TC);
    });

    it('gives a key held by hand its string back until the strike put back comes', () => {
      const { audio, context, destination, params, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 60, 'key');
      voices.scheduleNote(plain, 60, 'playback', 0.15, 1); // due to fade the key at 0.15
      context.currentTime = 0.1;
      params[0]!.cancelScheduledValues!.mockClear();
      params[0]!.setTargetAtTime!.mockClear();
      voices.cancelPending('playback', 0.1);
      expect(params[0]!.cancelScheduledValues).toHaveBeenCalledWith(0.15);
      voices.scheduleNote(plain, 60, 'playback', 0.2, 2);
      expect(params[0]!.setTargetAtTime!.mock.calls).toEqual([[0, 0.2, RESTRIKE_TC]]);
      expect(sources[0]!.stop).toHaveBeenLastCalledWith(0.2 + RESTRIKE_TC * 8);
      expect(voices.activeMidis().has(60)).toBe(true);
    });

    it('fades a key let go by hand from where its damper has it', () => {
      const { audio, context, destination, params } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(plain, 60, 'key');
      voices.scheduleNote(plain, 60, 'playback', 0.25, 1);
      context.currentTime = 0.125;
      voices.noteOff(60, 'key'); // let go before the strike, due at 0.25
      context.currentTime = 0.1875;
      voices.cancelPending('playback', 0.1875);
      voices.scheduleNote(plain, 60, 'playback', 0.3125, 2);
      expect(params[0]!.setValueAtTime).toHaveBeenLastCalledWith(
        Math.exp(-0.1875 / RELEASE_TC),
        0.3125,
      );
      expect(params[0]!.setTargetAtTime).toHaveBeenLastCalledWith(0, 0.3125, RESTRIKE_TC);
    });
  });
});

describe('a voice’s tone filter', () => {
  const plain: SampleSelection = {
    buffer: { duration: 3 } as AudioBuffer,
    playbackRate: 1,
    gain: 0.5,
  };
  const toned: SampleSelection = { ...plain, toneCutoffHz: 1234, toneMakeupDb: 0.3 };

  it('is made only for a voice with a cutoff, so every other voice costs what it did', () => {
    const { audio, destination, filters } = setup();
    const voice = startSampleVoice(audio, destination, plain, 0);
    expect(filters).toHaveLength(0);
    expect(voice.filter).toBeUndefined();
    expect(voice.source.connect).toHaveBeenCalledWith(voice.gain);
    expect(voice.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, ATTACK_S);
  });

  it('lowpasses between the source and the envelope, its Q read as dB', () => {
    const { audio, destination, filters } = setup();
    const voice = startSampleVoice(audio, destination, toned, 0);
    const filter = filters[0]!;
    expect(voice.filter).toBe(filter);
    // Web Audio takes a lowpass's Q in dB: −3.1 dB is a linear Q of 0.70,
    // where 0.7 would be 1.08 and a 1.7 dB bump.
    expect(TONE_FILTER_Q_DB).toBe(-3.1);
    expect(filter).toMatchObject({
      type: 'lowpass',
      frequency: { value: 1234 },
      Q: { value: TONE_FILTER_Q_DB },
    });
    expect(voice.source.connect).toHaveBeenCalledWith(filter);
    expect(voice.source.connect).not.toHaveBeenCalledWith(voice.gain);
    expect(filter.connect).toHaveBeenCalledWith(voice.gain);
    expect(voice.gain.connect).toHaveBeenCalledWith(destination);
  });

  it('keeps its cutoff at or under Nyquist', () => {
    const { audio, context, destination, filters } = setup();
    context.sampleRate = 44_100;
    startSampleVoice(audio, destination, { ...toned, toneCutoffHz: 22_400 }, 0);
    expect(filters[0]!.frequency.value).toBe(22_050);
  });

  it('gives back what the filter takes in the level the envelope holds', () => {
    const { audio, destination } = setup();
    const voice = startSampleVoice(audio, destination, toned, 0);
    const level = 0.5 * 10 ** (0.3 / 20);
    expect(voice.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(level, ATTACK_S);
    expect(sampleVoiceLevel(voice, 1)).toBeCloseTo(level, 12);
    // Let go from where it really is, not from its gain alone.
    releaseSampleVoice(voice, 1);
    expect(voice.gain.gain.setValueAtTime).toHaveBeenLastCalledWith(level, 1);
    expect(sampleVoiceLevel(voice, 1 + RELEASE_TC)).toBeCloseTo(level / Math.E, 12);
  });

  describe('is taken out of the graph however its voice ends', () => {
    function ended(source: Record<string, unknown>): void {
      (source.onended as () => void)();
    }

    it('let go', () => {
      const { audio, destination, filters, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(toned, 60, 'key');
      voices.noteOff(60, 'key');
      expect(filters[0]!.disconnect).not.toHaveBeenCalled();
      ended(sources[0]!);
      expect(filters[0]!.disconnect).toHaveBeenCalled();
      expect(sources[0]!.disconnect).toHaveBeenCalled();
    });

    it('struck again', () => {
      const { audio, context, destination, filters, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(toned, 60, 'key');
      context.currentTime = 0.5;
      voices.noteOn(toned, 60, 'pointer:1');
      ended(sources[0]!);
      expect(filters[0]!.disconnect).toHaveBeenCalled();
      expect(filters[1]!.disconnect).not.toHaveBeenCalled();
    });

    it('stolen for a new note', () => {
      const { audio, destination, filters, sources } = setup();
      const voices = new VoiceManager(audio, destination, 1);
      voices.noteOn(toned, 60, 'key');
      voices.noteOn(toned, 64, 'key');
      expect(voices.voiceCount).toBe(1);
      ended(sources[0]!);
      expect(filters[0]!.disconnect).toHaveBeenCalled();
      expect(filters[1]!.disconnect).not.toHaveBeenCalled();
    });

    it('called off before it sounds', () => {
      const { audio, context, destination, filters } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.scheduleNote(toned, 60, 'playback', 2, 1);
      context.currentTime = 1;
      voices.cancelPending('playback', 1);
      // At once: it is dropped from the voices, so nothing will end it later.
      expect(filters[0]!.disconnect).toHaveBeenCalled();
    });

    it('stopped by a panic', () => {
      const { audio, destination, filters, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(toned, 60, 'key');
      voices.noteOn({ ...toned, undamped: true }, 96, 'key');
      voices.allNotesOff();
      for (const source of sources) ended(source);
      expect(filters).toHaveLength(2);
      for (const filter of filters) expect(filter.disconnect).toHaveBeenCalled();
    });

    it('run out while its key is still held', () => {
      const { audio, destination, filters, sources } = setup();
      const voices = new VoiceManager(audio, destination);
      voices.noteOn(toned, 60, 'key');
      ended(sources[0]!);
      expect(filters[0]!.disconnect).toHaveBeenCalled();
    });
  });
});
