import { useEffect, useState } from 'react';
import { useMessages } from '@/i18n/i18nContext';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** About and offline status. */
export function AboutPage() {
  const m = useMessages();
  const online = useOnline();
  const [swReady, setSwReady] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((registration) => {
      setSwReady(Boolean(registration?.active));
    });
  }, []);

  return (
    <section className="page" aria-label={m.nav.about}>
      <header className="page__header">
        <h1 className="page__title">{m.about.title}</h1>
      </header>
      <p className="page__hint">{m.about.intro}</p>
      <p className="page__hint" role="status">
        {online ? m.about.online : m.about.offline} {swReady ? m.about.swReady : m.about.swNotReady}
      </p>
      <p className="page__hint">{m.about.backgroundHint}</p>
      <h2 className="page__hint" style={{ fontWeight: 650 }}>
        {m.about.credits}
      </h2>
      <p className="page__hint">{m.about.creditLine}</p>
      <p className="page__hint">{m.about.attribution}</p>
      <p className="page__hint">{m.about.version({ version: __APP_VERSION__ })}</p>
    </section>
  );
}
