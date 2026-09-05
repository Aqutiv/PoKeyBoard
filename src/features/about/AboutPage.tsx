import { useEffect, useState } from 'react';
import { APP_BUILD_LABEL } from '@/app/version';
import { useMessages } from '@/i18n/i18nContext';
import './about.css';

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
      <div className="about__scroll">
        <p className="page__hint">{m.about.intro}</p>
        <p className="page__hint" role="status">
          {online ? m.about.online : m.about.offline}{' '}
          {swReady ? m.about.swReady : m.about.swNotReady}
        </p>

        <h2 className="about__section">{m.about.featuresTitle}</h2>
        <ul className="about__features">
          {m.about.features.map((feature) => (
            <li key={feature.title}>
              <h3 className="about__feature-title">{feature.title}</h3>
              <p className="about__feature-body">{feature.body}</p>
            </li>
          ))}
        </ul>

        <h2 className="about__section">{m.about.privacyTitle}</h2>
        <p className="page__hint">{m.about.privacyBody}</p>
        <p className="page__hint">{m.about.backgroundHint}</p>

        <h2 className="about__section">{m.about.installTitle}</h2>
        <p className="page__hint">{m.about.installBody}</p>

        <h2 className="about__section">{m.about.credits}</h2>
        <p className="page__hint">{m.about.creditLine}</p>
        <p className="page__hint">{m.about.attribution}</p>
        <p className="page__hint">
          {m.about.wurlitzerAttribution}{' '}
          <a href="https://github.com/sfzinstruments/GregSullivan.E-Pianos">Wurlitzer EP203W</a>
          {' · '}
          <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>
        </p>
        <p className="page__hint">{m.about.version({ version: APP_BUILD_LABEL })}</p>
      </div>
    </section>
  );
}
