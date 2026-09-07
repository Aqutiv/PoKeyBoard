import { useTransportState } from './hooks/useTransport';
import { useRouter } from './routerContext';
import { transportController } from '@/features/transport/transportController';
import { useMessages } from '@/i18n/i18nContext';
import { useTakeStore } from '@/state/useTakeStore';

export function NowPlaying() {
  const { route, navigate } = useRouter();
  const state = useTransportState();
  const title = useTakeStore((s) => s.take.title);
  const m = useMessages();
  if (route === 'play' || (state !== 'playing' && state !== 'paused')) return null;
  return (
    <aside className="now-playing" aria-label={m.nav.nowPlaying}>
      <button type="button" className="now-playing__title" onClick={() => navigate('play')}>
        <span>{m.nav.nowPlaying}: </span>
        <strong>{title}</strong>
      </button>
      <button
        type="button"
        className="btn btn--small"
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
