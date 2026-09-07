import { useTransportState } from './hooks/useTransport';
import { usePianoReady } from './hooks/useAudioEngine';
import { useRouter } from './routerContext';
import { transportController } from '@/features/transport/transportController';
import { effectivePlaybackDurationMs } from '@/features/transport/sustainPedal';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';

export function NowPlaying() {
  const { route, navigate } = useRouter();
  const state = useTransportState();
  const pianoReady = usePianoReady();
  const take = useTakeStore((s) => s.take);
  const m = useMessages();
  if (route === 'play' || (state !== 'playing' && state !== 'paused')) return null;
  // Natural completion also enters paused; only offer Resume while music remains.
  if (
    state === 'paused' &&
    transportController.getPlayheadMs() >= effectivePlaybackDurationMs(take)
  ) {
    return null;
  }
  return (
    <aside className="now-playing" aria-label={m.nav.nowPlaying}>
      <button type="button" className="now-playing__title" onClick={() => navigate('play')}>
        <span>{m.nav.nowPlaying}: </span>
        <strong>{take.title}</strong>
      </button>
      <button
        type="button"
        className="btn btn--small"
        disabled={state === 'paused' && !pianoReady}
        onClick={() =>
          state === 'playing' ? transportController.pause() : transportController.play()
        }
      >
        {state === 'playing' ? m.transport.pause : m.transport.resume}
      </button>
      <button type="button" className="btn btn--small" onClick={() => transportController.stop()}>
        {m.transport.stop}
      </button>
    </aside>
  );
}
