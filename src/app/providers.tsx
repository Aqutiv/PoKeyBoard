import { useEffect, type ReactNode } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import { RouterProvider } from './router';

/**
 * App-level providers plus one-time service wiring: the audio engine
 * initializes (suspended) at startup so samples decode early, and the very
 * first user gesture anywhere unlocks audio output.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    audioEngine.initialize();

    const unlock = () => {
      void audioEngine.unlockFromUserGesture();
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    };
  }, []);

  return <RouterProvider>{children}</RouterProvider>;
}
