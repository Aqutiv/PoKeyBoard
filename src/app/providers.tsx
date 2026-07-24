import { useEffect, useState, type ReactNode } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { persistenceService } from '@/data/persistence';
import { I18nProvider } from '@/i18n/I18nProvider';
import { lifecycleService } from './lifecycle';
import { RouterProvider } from './router';
import { themeController } from './theme';

/**
 * App-level providers plus one-time service wiring: the audio engine
 * initializes (suspended) at startup so samples decode early, and the very
 * first user gesture anywhere unlocks audio output.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let mounted = true;
    audioEngine.initialize();
    void persistenceService.init().finally(() => {
      if (mounted) setRestored(true);
    });
    lifecycleService.init();
    themeController.init();

    const unlock = () => {
      void audioEngine.unlockFromUserGesture();
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      mounted = false;
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  return (
    <I18nProvider>
      {restored ? (
        <RouterProvider>{children}</RouterProvider>
      ) : (
        <div className="app-boot" role="status" aria-live="polite">
          <span className="app-boot__wordmark" aria-hidden="true">
            PoKeyBoard
          </span>
          Loading…
        </div>
      )}
    </I18nProvider>
  );
}
