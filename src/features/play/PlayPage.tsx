import { useState, useSyncExternalStore } from 'react';
import { COMPACT_LANDSCAPE_QUERY, useMediaQuery } from '@/app/hooks/useMediaQuery';
import { useTransportState } from '@/app/hooks/useTransport';
import { usePlaybackActiveMidis } from '@/app/hooks/useActiveMidis';
import { useEngineStatus, useSampleLoadProgress } from '@/app/hooks/useAudioEngine';
import { lifecycleService } from '@/app/lifecycle';
import { audioEngine } from '@/audio/AudioEngine';
import { isLibraryTakeId } from '@/domain/libraryTakes';
import { ShareMenu } from '@/features/export/ShareMenu';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import { MetronomeControls } from '@/features/metronome/MetronomeControls';
import { MusicScore } from '@/features/notation/MusicScore';
import { TransportControls } from '@/features/transport/TransportControls';
import { isBusyState } from '@/features/transport/transportMachine';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';
import { SaveStatusBadge } from './SaveStatusBadge';

const subscribeLifecycle = (onStoreChange: () => void) => lifecycleService.subscribe(onStoreChange);
const getLifecycle = () => lifecycleService.getSnapshot();

/** The main instrument view: transport, score, metronome, keyboard. */
export function PlayPage() {
  const m = useMessages();
  const transportState = useTransportState();
  const [compactView, setCompactView] = useState<'notation' | 'keyboard'>('notation');
  const interruption = useSyncExternalStore(subscribeLifecycle, getLifecycle);
  const status = useEngineStatus();
  const progress = useSampleLoadProgress();
  const percent =
    progress.totalFiles > 0 ? Math.round((progress.loadedFiles / progress.totalFiles) * 100) : 0;

  const title = useTakeStore((s) => s.take.title);
  const takeId = useTakeStore((s) => s.take.id);
  const isLibrary = isLibraryTakeId(takeId);
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const playbackActiveMidis = usePlaybackActiveMidis();
  // In short landscape the metronome row does not fit; a compact subset is
  // embedded in the piano controls row instead. Render one or the other,
  // never both (duplicate groups would confuse assistive tech).
  const compactLandscape = useMediaQuery(COMPACT_LANDSCAPE_QUERY);

  return (
    <section
      className="page page--play"
      aria-label={m.play.pageLabel}
      data-piano-ready={progress.phase === 'core-ready' ? 'true' : 'false'}
    >
      <div className="play-layout" data-compact-view={compactView}>
        <header className="play-header">
          <h1 className="play-header__title">{title}</h1>
          {isLibrary ? <span className="play-header__library">{m.library.chip}</span> : null}
          <div className="play-view-switch" role="group" aria-label={m.play.viewLabel}>
            <button
              type="button"
              className={`play-view-switch__option${compactView === 'notation' ? ' is-selected' : ''}`}
              aria-pressed={compactView === 'notation'}
              onClick={() => setCompactView('notation')}
            >
              {m.play.notationView}
            </button>
            <button
              type="button"
              className={`play-view-switch__option${compactView === 'keyboard' ? ' is-selected' : ''}`}
              aria-pressed={compactView === 'keyboard'}
              onClick={() => setCompactView('keyboard')}
            >
              {m.play.keyboardView}
            </button>
          </div>
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
          <p className="play-interruption" role="alert">
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
        <TransportControls />
        <div className="play-layout__score">
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
                {m.settings.tryAgain}
              </button>
            </div>
          ) : null}
          {status === 'error' ? (
            <p className="page__hint" role="alert">
              {m.play.audioUnavailable}
            </p>
          ) : null}
          <MusicScore />
        </div>
        {compactLandscape ? null : <MetronomeControls />}
        <div className="play-layout__keyboard">
          <PianoKeyboard
            extraActiveMidis={playbackActiveMidis}
            controlsExtra={compactLandscape ? <MetronomeControls compact /> : null}
          />
        </div>
      </div>
    </section>
  );
}
