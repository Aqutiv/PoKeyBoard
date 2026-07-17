import { describe, expect, it } from 'vitest';
import { detectCapabilities } from '@/audio/audioCapabilities';

describe('detectCapabilities', () => {
  it('returns a complete boolean map without throwing in jsdom', () => {
    const caps = detectCapabilities();
    const expectedKeys = [
      'standaloneDisplayMode',
      'beforeInstallPrompt',
      'share',
      'shareFiles',
      'storagePersist',
      'storageEstimate',
      'fileSystemAccess',
      'wakeLock',
      'audioWorklet',
      'webCodecsAudioEncoder',
      'pointerEvents',
      'touch',
    ];
    for (const key of expectedKeys) {
      expect(typeof caps[key as keyof typeof caps]).toBe('boolean');
    }
  });

  it('does not report standalone mode in a plain test environment', () => {
    expect(detectCapabilities().standaloneDisplayMode).toBe(false);
  });
});
