import { usePlaybackActiveMidis } from '@/app/hooks/useActiveMidis';
import { useEngineStatus, useSampleLoadProgress } from '@/app/hooks/useAudioEngine';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';
import { MetronomeControls } from '@/features/metronome/MetronomeControls';
import { MusicScore } from '@/features/notation/MusicScore';
import { TransportControls } from '@/features/transport/TransportControls';
import { useExportUiStore } from '@/state/useExportUiStore';
import { useTakeStore } from '@/state/useTakeStore';
import { SaveStatusBadge } from './SaveStatusBadge';

/** Play view — the score renderer lands in the notation slice. */
export function PlayPage() {
  const status = useEngineStatus();
  const progress = useSampleLoadProgress();
  const percent =
    progress.totalFiles > 0 ? Math.round((progress.loadedFiles / progress.totalFiles) * 100) : 0;

  const title = useTakeStore((s) => s.take.title);
  const takeId = useTakeStore((s) => s.take.id);
  const hasNotes = useTakeStore((s) => s.take.notes.length > 0);
  const openExport = useExportUiStore((s) => s.openExport);
  const playbackActiveMidis = usePlaybackActiveMidis();

  return (
    <section className="page page--play" aria-label="Play">
      <div className="play-layout">
        <header className="play-header">
          <h1 className="play-header__title">{title}</h1>
          <span className="play-header__side">
            <SaveStatusBadge />
            <button
              type="button"
              className="play-header__export"
              onClick={() => openExport(takeId)}
              disabled={!hasNotes}
            >
              Share audio
            </button>
          </span>
        </header>
        <TransportControls />
        <div className="play-layout__score">
          {progress.phase === 'loading-core' || progress.phase === 'loading-manifest' ? (
            <p className="page__hint" role="status">
              Loading piano… {percent}%
            </p>
          ) : null}
          {progress.error ? (
            <p className="page__hint" role="alert">
              {progress.error}
            </p>
          ) : null}
          {status === 'error' ? (
            <p className="page__hint" role="alert">
              Audio is unavailable in this browser.
            </p>
          ) : null}
          <MusicScore />
        </div>
        <MetronomeControls />
        <div className="play-layout__keyboard">
          <PianoKeyboard extraActiveMidis={playbackActiveMidis} />
        </div>
      </div>
    </section>
  );
}
