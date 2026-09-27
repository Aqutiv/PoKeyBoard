import { useEffect, useState, type ReactNode } from 'react';
import { APP_BUILD_LABEL } from '@/app/version';
import { PIANO_INSTRUMENTS, type PianoInstrumentId } from '@/audio/instruments';
import { useMessages } from '@/i18n/i18nContext';
import type { Messages } from '@/i18n/types';
import './about.css';

interface Link {
  href: string;
  label: string;
}

const CC_BY_3: Link = { href: 'https://creativecommons.org/licenses/by/3.0/', label: 'CC BY 3.0' };
const CC_BY_4: Link = { href: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' };

/**
 * Where each piano's recordings are published and the licence they are under;
 * the credit itself is translated. Keyed by the registry, so a piano cannot
 * be added without one.
 */
const PIANO_CREDITS: Record<
  PianoInstrumentId,
  {
    key: keyof Messages['about']['pianoCredits'];
    source: string;
    sourceLabel?: string;
    license: Link;
  }
> = {
  'salamander-grand': {
    key: 'salamander',
    source: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
    license: CC_BY_3,
  },
  'headroom-grand': {
    key: 'headroom',
    source: 'https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano',
    license: CC_BY_4,
  },
  // The dataset is cited by its DOI.
  'bitklavier-grand': {
    key: 'bitklavier',
    source: 'https://doi.org/10.34770/xm18-yr83',
    sourceLabel: 'doi:10.34770/xm18-yr83',
    license: CC_BY_4,
  },
  'wurlitzer-ep203w': {
    key: 'wurlitzer',
    source: 'https://github.com/sfzinstruments/GregSullivan.E-Pianos',
    license: CC_BY_3,
  },
};

/** The third-party code and type the app ships, as THIRD_PARTY_NOTICES.md lists them. */
const SOFTWARE_CREDITS: readonly {
  key: keyof Messages['about']['software'];
  name: string;
  href: string;
  license: string;
}[] = [
  { key: 'lame', name: 'LAME', href: 'https://lame.sourceforge.io/', license: 'LGPL' },
  { key: 'pdfLib', name: 'pdf-lib', href: 'https://pdf-lib.js.org/', license: 'MIT' },
  {
    key: 'fraunces',
    name: 'Fraunces',
    href: 'https://github.com/undercasetype/Fraunces',
    license: 'OFL',
  },
];

const NOTICES_URL = 'https://github.com/Aqutiv/PoKeyBoard/blob/main/THIRD_PARTY_NOTICES.md';

/** A link out of the app: it opens beside the app rather than replacing it. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

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

        <h3 className="about__subsection">{m.about.pianosTitle}</h3>
        <ul className="about__credits">
          {PIANO_INSTRUMENTS.map((piano) => {
            const credit = PIANO_CREDITS[piano.id];
            const text = m.about.pianoCredits[credit.key];
            return (
              <li key={piano.id} className="about__credit">
                <h4 className="about__feature-title">{piano.name}</h4>
                <p className="about__feature-body">{text.credit}</p>
                <p className="about__feature-body">{text.adapted}</p>
                <p className="about__links">
                  <ExternalLink href={credit.source}>
                    {credit.sourceLabel ?? m.about.source}
                  </ExternalLink>
                  {' · '}
                  <ExternalLink href={credit.license.href}>{credit.license.label}</ExternalLink>
                </p>
              </li>
            );
          })}
        </ul>

        <h3 className="about__subsection">{m.about.softwareTitle}</h3>
        <ul className="about__software">
          {SOFTWARE_CREDITS.map((item) => (
            <li key={item.key}>
              <ExternalLink href={item.href}>{item.name}</ExternalLink>
              {' — '}
              {m.about.software[item.key]}
              {' · '}
              {item.license}
            </li>
          ))}
        </ul>
        <p className="about__notices">
          {m.about.notices} <ExternalLink href={NOTICES_URL}>THIRD_PARTY_NOTICES.md</ExternalLink>
        </p>

        <p className="page__hint about__version">{m.about.version({ version: APP_BUILD_LABEL })}</p>
      </div>
    </section>
  );
}
