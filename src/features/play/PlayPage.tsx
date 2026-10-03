import { PianoControls } from './PianoControls';
import { TakeTitle } from './TakeTitle';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { COMPACT_LANDSCAPE_QUERY, useMediaQuery } from '@/app/hooks/useMediaQuery';
import { useTransportState } from '@/app/hooks/useTransport';
import { useTrainingTargets, useTrainingWrongMidis } from '@/app/hooks/useActiveMidis';
import {
  useEngineStatus,
  usePianoSwitching,
  useSampleLoadProgress,
} from '@/app/hooks/useAudioEngine';
import { lifecycleService } from '@/app/lifecycle';
import { audioEngine } from '@/audio/AudioEngine';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import { ShareMenu } from '@/features/export/ShareMenu';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import { MetronomeControls } from '@/features/metronome/MetronomeControls';
import { MusicScore } from '@/features/notation/MusicScore';
import { PracticeResults } from '@/features/practice/PracticeResults';
import { TransportControls } from '@/features/transport/TransportControls';
import { isBusyState } from '@/features/transport/transportMachine';
import type { KeyRange } from '@/features/waterfall/WaterfallView';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import type { PlayView } from './playView';
import { PlayViewSwitch } from './PlayViewSwitch';
import { SaveStatusBadge } from './SaveStatusBadge';

// Fetched when first shown: the score is the default view, and the falling
// notes bring their own layout, painter and fingering along.
const WaterfallView = lazy(() =>
  import('@/features/waterfall/WaterfallView').then((module) => ({
    default: module.WaterfallView,
  })),
);

const subscribeLifecycle = (onStoreChange: () => void) => lifecycleService.subscribe(onStoreChange);
const getLifecycle = () => lifecycleService.getSnapshot();

/** What the layout shows over the keys: a view, or in short landscape the keys alone. */
type PlayStage = PlayView | 'keys';

/** The main instrument view: transport, score or falling notes, metronome, keyboard. */
export function PlayPage() {
  const m = useMessages();
  const transportState = useTransportState();
  const playView = useSettingsStore((s) => s.playView);
  const setPlayView = useSettingsStore((s) => s.setPlayView);
  // Short landscape has no room for a view and the keys together, so it can
  // show the keys alone. Kept while the page is open, so turning the phone
  // upright and back returns to it, but never remembered beyond that.
  const [keysOnly, setKeysOnly] = useState(false);
  // Where the key bed is, so the falling notes can stand over their keys.
  const [keyboardRange, setKeyboardRange] = useState<KeyRange | null>(null);
  const interruption = useSyncExternalStore(subscribeLifecycle, getLifecycle);
  const status = useEngineStatus();
  const progress = useSampleLoadProgress();
  const pianoSwitching = usePianoSwitching();
  const percent =
    progress.coreTotalBytes > 0
      ? Math.round((progress.coreLoadedBytes / progress.coreTotalBytes) * 100)
      : 0;

  const takeId = useTakeStore((s) => s.take.id);
  const isLibrary = isLibraryTakeId(takeId);
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const followPlayback = useSettingsStore((s) => s.keyboardFollowsPlayback);
  const trainingTargets = useTrainingTargets();
  const trainingWrong = useTrainingWrongMidis();
  // In short landscape the metronome row does not fit; a compact subset is
  // embedded in the piano controls row instead. Render one or the other,
  // never both (duplicate groups would confuse assistive tech).
  const compactLandscape = useMediaQuery(COMPACT_LANDSCAPE_QUERY);
  const showKeysOnly = compactLandscape && keysOnly;
  const stage: PlayStage = showKeysOnly ? 'keys' : playView;
  const falling = playView === 'waterfall';

  const chooseView = (view: PlayView) => {
    setPlayView(view);
    setKeysOnly(false);
  };

  const soundRow = compactLandscape ? null : (
    <div key="sound" className="play-sound-row">
      <MetronomeControls />
      <PianoControls />
    </div>
  );

  // Every child is keyed, so the sound row moves rather than remounts when
  // the view changes: under the score it sits above the keys; under the
  // falling notes, which stand straight on the keys, it moves below them, and
  // the page reads in the order it is drawn.
  return (
    <section
      className="page page--play"
      aria-label={m.play.pageLabel}
      // The piano chosen is ready — not merely one playing while it decodes.
      data-piano-ready={progress.phase === 'core-ready' && !pianoSwitching ? 'true' : 'false'}
    >
      <div className="play-layout" data-stage={stage}>
        <header key="header" className="play-header">
          <TakeTitle key={takeId} disabled={isBusyState(transportState)} />
          {isLibrary ? <span className="play-header__library">{m.library.chip}</span> : null}
          <PlayViewSwitch
            view={playView}
            keysOnly={showKeysOnly}
            offerKeys={compactLandscape}
            onView={chooseView}
            onKeysOnly={() => setKeysOnly(true)}
          />
          <span className="play-header__side">
            {isLibrary ? null : <SaveStatusBadge />}
            <ShareMenu
              takeId={takeId}
              disabled={!hasNotes || isBusyState(transportState)}
              triggerClassName="play-header__export"
              align="right"
            />
          </span>
        </header>
        {interruption.message ? (
          <p key="interruption" className="play-interruption" role="alert">
            {m.play[interruption.message]}{' '}
            <button
              type="button"
              className="play-interruption__dismiss"
              onClick={() => lifecycleService.dismissMessage()}
            >
              {m.play.dismiss}
            </button>
          </p>
        ) : null}
        <TransportControls key="transport" />
        <PracticeResults key="practice" />
        <div key="score" className="play-layout__score">
          {progress.phase === 'loading-core' || progress.phase === 'loading-manifest' ? (
            <p className="page__hint" role="status">
              {m.play.loadingPiano({ percent })}
            </p>
          ) : null}
          {progress.error ? (
            <div className="page__hint" role="alert">
              <p>{progress.error}</p>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => void audioEngine.loadCoreSamples()}
              >
                {m.play.retryLoadingPiano}
              </button>
            </div>
          ) : null}
          {status === 'error' ? (
            <p className="page__hint" role="alert">
              {m.play.audioUnavailable}
            </p>
          ) : null}
          {falling ? (
            // The empty stage holds the view's place while its code arrives.
            <Suspense fallback={<div className="waterfall" />}>
              <WaterfallView range={keyboardRange} />
            </Suspense>
          ) : (
            <MusicScore />
          )}
        </div>
        {falling ? null : soundRow}
        <div key="keyboard" className="play-layout__keyboard">
          <PianoKeyboard
            playbackCues
            followPlayback={followPlayback}
            targetMidis={trainingTargets}
            wrongMidis={trainingWrong}
            revealTargets
            controlsExtra={compactLandscape ? <MetronomeControls compact /> : null}
            onRangeChange={falling ? setKeyboardRange : undefined}
          />
        </div>
        {falling ? soundRow : null}
      </div>
    </section>
  );
}
