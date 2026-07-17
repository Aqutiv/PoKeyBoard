import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useMetronomeOn, useTransportState } from '@/app/hooks/useTransport';
import { audioEngine } from '@/audio/AudioEngine';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import type { CountInBars } from '@/domain/takeTypes';
import './metronome.css';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '6/8'] as const;
const MIN_BPM = 40;
const MAX_BPM = 240;

/** Poll the current beat while clicks are audible; -1 when silent. */
function useActiveBeat(running: boolean, numerator: number): number {
  const subscribeBeat = useCallback(
    (onStoreChange: () => void) => {
      const timer = running ? setInterval(onStoreChange, 60) : null;
      return () => {
        if (timer !== null) clearInterval(timer);
      };
    },
    [running],
  );
  return useSyncExternalStore(subscribeBeat, () => {
    if (!running) return -1;
    const beat = transportController.metronome.beatAt(audioEngine.currentTime);
    return beat < 0 ? -1 : Math.floor(beat) % numerator;
  });
}

export function MetronomeControls() {
  const metronomeOn = useMetronomeOn();
  const state = useTransportState();
  const tempo = useTakeStore((s) => s.take.tempo);
  const setTempo = useTakeStore((s) => s.setTempo);
  const metronomeVolume = useSettingsStore((s) => s.metronomeVolume);
  const setMetronomeVolume = useSettingsStore((s) => s.setMetronomeVolume);
  const [bpmText, setBpmText] = useState(String(tempo.bpm));
  const [lastBpm, setLastBpm] = useState(tempo.bpm);
  const tapTimesRef = useRef<number[]>([]);

  // Adjust-during-render pattern: reflect external BPM changes in the field.
  if (tempo.bpm !== lastBpm) {
    setLastBpm(tempo.bpm);
    setBpmText(String(Math.round(tempo.bpm)));
  }

  const clicksAudible = metronomeOn || state === 'countIn';
  const activeBeat = useActiveBeat(clicksAudible, tempo.timeSignature.numerator);

  const applyBpm = useCallback(
    (bpm: number) => {
      const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
      setTempo({ ...tempo, bpm: clamped });
      transportController.refreshMetronomeConfig();
    },
    [tempo, setTempo],
  );

  const onBpmCommit = useCallback(() => {
    const parsed = Number(bpmText);
    if (Number.isFinite(parsed)) applyBpm(parsed);
    else setBpmText(String(Math.round(tempo.bpm)));
  }, [bpmText, applyBpm, tempo.bpm]);

  const onTap = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current.filter((t) => now - t < 2500);
    taps.push(now);
    tapTimesRef.current = taps.slice(-6);
    if (tapTimesRef.current.length >= 2) {
      const times = tapTimesRef.current;
      const intervals: number[] = [];
      for (let i = 1; i < times.length; i += 1) {
        intervals.push((times[i] as number) - (times[i - 1] as number));
      }
      const average = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
      applyBpm(60_000 / average);
    }
  }, [applyBpm]);

  const onTimeSignature = useCallback(
    (value: string) => {
      const [num, den] = value.split('/').map(Number);
      if (!num || !den) return;
      setTempo({ ...tempo, timeSignature: { numerator: num, denominator: den } });
      transportController.refreshMetronomeConfig();
    },
    [tempo, setTempo],
  );

  const onCountIn = useCallback(
    (value: string) => {
      setTempo({ ...tempo, countInBars: Number(value) as CountInBars });
    },
    [tempo, setTempo],
  );

  const beats = Array.from({ length: tempo.timeSignature.numerator }, (_, i) => i);

  return (
    <div className="metronome" role="group" aria-label="Metronome">
      <button
        type="button"
        className={`metronome__toggle${metronomeOn ? ' is-on' : ''}`}
        aria-pressed={metronomeOn}
        aria-label={
          metronomeOn
            ? `Metronome on, ${Math.round(tempo.bpm)} beats per minute`
            : 'Metronome off'
        }
        onClick={() => transportController.setMetronomeOn(!metronomeOn)}
      >
        ♩
      </button>

      <div className="metronome__bpm">
        <button
          type="button"
          className="metronome__step"
          aria-label="Decrease tempo"
          onClick={() => applyBpm(tempo.bpm - 1)}
        >
          −
        </button>
        <input
          className="metronome__bpm-input"
          inputMode="numeric"
          value={bpmText}
          onChange={(event) => setBpmText(event.target.value)}
          onBlur={onBpmCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          aria-label="Beats per minute"
        />
        <button
          type="button"
          className="metronome__step"
          aria-label="Increase tempo"
          onClick={() => applyBpm(tempo.bpm + 1)}
        >
          +
        </button>
      </div>

      <button type="button" className="metronome__tap" onClick={onTap}>
        Tap
      </button>

      <select
        aria-label="Time signature"
        value={`${tempo.timeSignature.numerator}/${tempo.timeSignature.denominator}`}
        onChange={(event) => onTimeSignature(event.target.value)}
      >
        {TIME_SIGNATURES.map((ts) => (
          <option key={ts} value={ts}>
            {ts}
          </option>
        ))}
      </select>

      <select
        aria-label="Count-in length"
        value={String(tempo.countInBars)}
        onChange={(event) => onCountIn(event.target.value)}
      >
        <option value="0">No count-in</option>
        <option value="1">1 bar</option>
        <option value="2">2 bars</option>
      </select>

      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={metronomeVolume}
        onChange={(event) => {
          setMetronomeVolume(Number(event.target.value));
          transportController.refreshMetronomeConfig();
        }}
        aria-label="Metronome volume"
        className="metronome__volume"
      />

      <div className="metronome__beats" aria-hidden="true">
        {beats.map((beat) => (
          <span
            key={beat}
            className={`metronome__dot${beat === activeBeat ? ' is-active' : ''}${beat === 0 ? ' is-accent' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
