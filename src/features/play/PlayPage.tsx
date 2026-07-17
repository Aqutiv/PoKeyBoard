import { useEngineStatus, useSampleLoadProgress } from '@/app/hooks/useAudioEngine';

/** Play view skeleton — keyboard, score, and transport land in later slices. */
export function PlayPage() {
  const status = useEngineStatus();
  const progress = useSampleLoadProgress();
  const percent =
    progress.totalFiles > 0 ? Math.round((progress.loadedFiles / progress.totalFiles) * 100) : 0;

  return (
    <section className="page page--play" aria-label="Play">
      <header className="page__header">
        <h1 className="page__title">PoKeyBoard</h1>
      </header>
      <p className="page__hint">
        Audio: {status}
        {progress.phase === 'loading-core' ? ` — loading piano ${percent}%` : null}
        {progress.phase === 'core-ready' ? ' — piano ready' : null}
        {progress.error ? ` — ${progress.error}` : null}
      </p>
    </section>
  );
}
