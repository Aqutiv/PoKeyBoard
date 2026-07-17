import { useEngineStatus, useSampleLoadProgress } from '@/app/hooks/useAudioEngine';
import { PianoKeyboard } from '@/features/keyboard/PianoKeyboard';

/** Play view — score and transport land in later slices. */
export function PlayPage() {
  const status = useEngineStatus();
  const progress = useSampleLoadProgress();
  const percent =
    progress.totalFiles > 0 ? Math.round((progress.loadedFiles / progress.totalFiles) * 100) : 0;

  return (
    <section className="page page--play" aria-label="Play">
      <div className="play-layout">
        <div className="play-layout__score">
          <p className="page__hint" role="status">
            {progress.phase === 'loading-core' || progress.phase === 'loading-manifest'
              ? `Loading piano… ${percent}%`
              : null}
            {progress.phase === 'core-ready' ? 'Piano ready — play something.' : null}
            {progress.error ? `${progress.error} ` : null}
            {status === 'error' ? 'Audio is unavailable in this browser.' : null}
          </p>
        </div>
        <div className="play-layout__keyboard">
          <PianoKeyboard />
        </div>
      </div>
    </section>
  );
}
