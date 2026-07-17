import { useEffect, useState } from 'react';

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
  const online = useOnline();
  const [swReady, setSwReady] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.getRegistration().then((registration) => {
      setSwReady(Boolean(registration?.active));
    });
  }, []);

  return (
    <section className="page" aria-label="About">
      <header className="page__header">
        <h1 className="page__title">About PoKeyBoard</h1>
      </header>
      <p className="page__hint">
        Play, record, and share piano performances — entirely in your browser. Recordings are
        structured note events (never the microphone), stored locally on this device.
      </p>
      <p className="page__hint" role="status">
        {online ? 'Online.' : 'Offline.'}{' '}
        {swReady
          ? 'The app shell is cached and starts without a connection.'
          : 'Offline support activates after the first visit over HTTPS.'}
      </p>
      <p className="page__hint">
        Audio normally pauses when the app goes to the background or the screen locks. Takes are
        local to this browser profile — installing the app can use separate storage, so export
        JSON backups for anything important.
      </p>
      <h2 className="page__hint" style={{ fontWeight: 650 }}>
        Credits
      </h2>
      <p className="page__hint">
        Piano: Salamander Grand Piano v3 by Alexander Holm (CC-BY 3.0), adapted for the web. MP3
        encoding by the LAME encoder compiled to WebAssembly. Full notices ship with the source in
        THIRD_PARTY_NOTICES.md.
      </p>
      <p className="page__hint">Version {__APP_VERSION__}.</p>
    </section>
  );
}
