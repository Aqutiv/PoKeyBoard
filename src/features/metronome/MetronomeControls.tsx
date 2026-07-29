import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMetronomeOn, usePlayheadMs, useTransportState } from '@/app/hooks/useTransport';
import { audioEngine } from '@/audio/AudioEngine';
import { useMessages } from '@/i18n/i18nContext';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import type { CountInBars } from '@/domain/takeTypes';
import { barLineNearMs, createTakeTempoMap, withTempoAt } from '@/domain/tempoMap';
import './metronome.css';

const TIME_SIGNATURES: readonly string[] = ['2/2', '2/4', '3/4', '3/8', '4/4', '6/8'];
const MIN_BPM = 40;
const MAX_BPM = 240;

/** Poll the current beat while clicks are audible; -1 when silent. */
function useActiveBeat(running: boolean): number {
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
    return transportController.metronome.beatInBarAt(audioEngine.currentTime);
  });
}

interface MetronomeControlsProps {
  /**
   * Compact subset (toggle, BPM stepper, tap, beat dots) for embedding in
   * the short-landscape piano controls row. Only one instance — full or
   * compact — may be in the DOM at a time (duplicate group labels and beat
   * dots would break assistive tech and the e2e locators).
   */
  compact?: boolean;
}

export function MetronomeControls({ compact = false }: MetronomeControlsProps) {
  const m = useMessages();
  const metronomeOn = useMetronomeOn();
  const state = useTransportState();
  const tempo = useTakeStore((s) => s.take.tempo);
  const setTempo = useTakeStore((s) => s.setTempo);
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const playheadMs = usePlayheadMs();
  const metronomeVolume = useSettingsStore((s) => s.metronomeVolume);
  const setMetronomeVolume = useSettingsStore((s) => s.setMetronomeVolume);
  const tapTimesRef = useRef<number[]>([]);

  const tempoMap = useMemo(() => createTakeTempoMap(tempo), [tempo]);

  /**
   * Stopped partway into a take that already has notes, the tempo field edits
   * the tempo *from here* — the record-a-part, change tempo, record-the-next
   * flow — landing the change on the nearest bar line so the next part starts
   * on a downbeat. At the very start, and while the transport is moving, it
   * edits the take's tempo as a whole.
   */
  const stopped = state === 'idle' || state === 'paused';
  const barLineMs = stopped ? barLineNearMs(tempoMap, tempo.timeSignature, playheadMs) : 0;
  const positioned = stopped && hasNotes && barLineMs > 0;
  const targetMs = positioned ? barLineMs : playheadMs;
  const shownBpm = Math.round(tempoMap.bpmAt(targetMs));
  const targetBar = positioned
    ? Math.round(tempoMap.beatAtMs(barLineMs) / tempo.timeSignature.numerator) + 1
    : 0;

  const [bpmText, setBpmText] = useState(String(shownBpm));
  const [lastBpm, setLastBpm] = useState(shownBpm);
  /** Phone only: time signature, count-in and volume fold away behind "⋯". */
  const [secondaryOpen, setSecondaryOpen] = useState(false);

  // Adjust-during-render pattern: reflect external BPM changes in the field.
  if (shownBpm !== lastBpm) {
    setLastBpm(shownBpm);
    setBpmText(String(shownBpm));
  }

  const clicksAudible = metronomeOn || state === 'countIn';
  const activeBeat = useActiveBeat(clicksAudible);

  const applyBpm = useCallback(
    (bpm: number) => {
      const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
      if (positioned) {
        setTempo(withTempoAt(tempo, barLineMs, clamped));
        // Park the playhead on the bar line the change starts at.
        transportController.seek(barLineMs);
      } else {
        setTempo({ ...tempo, bpm: clamped });
      }
      transportController.refreshMetronomeConfig();
    },
    [tempo, setTempo, positioned, barLineMs],
  );

  const onBpmCommit = useCallback(() => {
    const parsed = Number(bpmText);
    if (Number.isFinite(parsed)) applyBpm(parsed);
    else setBpmText(String(shownBpm));
  }, [bpmText, applyBpm, shownBpm]);

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

  // The schema allows signatures beyond the presets (e.g. an imported 5/4
  // take); include the active one so the select never falls back to "2/4".
  const currentSignature = `${tempo.timeSignature.numerator}/${tempo.timeSignature.denominator}`;
  const signatureOptions = TIME_SIGNATURES.includes(currentSignature)
    ? TIME_SIGNATURES
    : [...TIME_SIGNATURES, currentSignature];

  return (
    <div
      className={`metronome${compact ? ' metronome--compact' : ''}`}
      role="group"
      aria-label={m.metronome.groupLabel}
    >
      <button
        type="button"
        className={`metronome__toggle${metronomeOn ? ' is-on' : ''}`}
        aria-pressed={metronomeOn}
        aria-label={metronomeOn ? m.metronome.on({ bpm: shownBpm }) : m.metronome.off}
        onClick={() => transportController.setMetronomeOn(!metronomeOn)}
      >
        ♩
      </button>

      <div className="metronome__bpm">
        <button
          type="button"
          className="metronome__step"
          aria-label={m.metronome.decreaseTempo}
          onClick={() => applyBpm(shownBpm - 1)}
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
          aria-label={m.metronome.bpmLabel}
        />
        <button
          type="button"
          className="metronome__step"
          aria-label={m.metronome.increaseTempo}
          onClick={() => applyBpm(shownBpm + 1)}
        >
          +
        </button>
      </div>

      {positioned ? (
        <span className="metronome__from-bar">{m.metronome.tempoFromBar({ bar: targetBar })}</span>
      ) : null}

      <button type="button" className="metronome__tap" onClick={onTap}>
        {m.metronome.tap}
      </button>

      {compact ? null : (
        <>
          {/* On a phone the settings below fold away behind this, so the
              metronome keeps to one row. Everywhere else the button is
              hidden and the group lays out inline, exactly as before. */}
          <button
            type="button"
            className="metronome__more"
            aria-expanded={secondaryOpen}
            aria-label={m.metronome.moreControls}
            onClick={() => setSecondaryOpen((open) => !open)}
          >
            ⋯
          </button>

          <div className="metronome__secondary" data-open={secondaryOpen}>
            <select
              aria-label={m.metronome.timeSignatureLabel}
              value={currentSignature}
              onChange={(event) => onTimeSignature(event.target.value)}
            >
              {signatureOptions.map((ts) => (
                <option key={ts} value={ts}>
                  {ts}
                </option>
              ))}
            </select>

            <select
              aria-label={m.metronome.countInLabel}
              value={String(tempo.countInBars)}
              onChange={(event) => onCountIn(event.target.value)}
            >
              <option value="0">{m.metronome.noCountIn}</option>
              <option value="1">{m.metronome.oneBar}</option>
              <option value="2">{m.metronome.twoBars}</option>
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
              aria-label={m.metronome.volumeLabel}
              className="metronome__volume"
            />
          </div>
        </>
      )}

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
