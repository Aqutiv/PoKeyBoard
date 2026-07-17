/** Typed capability snapshot per spec §3, shown in Settings diagnostics. */
export interface AppCapabilities {
  standaloneDisplayMode: boolean;
  beforeInstallPrompt: boolean;
  share: boolean;
  shareFiles: boolean;
  storagePersist: boolean;
  storageEstimate: boolean;
  fileSystemAccess: boolean;
  wakeLock: boolean;
  audioWorklet: boolean;
  webCodecsAudioEncoder: boolean;
  pointerEvents: boolean;
  touch: boolean;
}

interface NavigatorMaybeStandalone extends Navigator {
  standalone?: boolean;
}

export function isStandaloneDisplayMode(): boolean {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
  } catch {
    // matchMedia unavailable — fall through to the iOS legacy flag.
  }
  return (navigator as NavigatorMaybeStandalone).standalone === true;
}

function canShareFiles(): boolean {
  if (typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([''], 'probe.mp3', { type: 'audio/mpeg' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Feature detection only — never user-agent sniffing. */
export function detectCapabilities(): AppCapabilities {
  const nav = navigator as Navigator & { storage?: StorageManager };
  return {
    standaloneDisplayMode: isStandaloneDisplayMode(),
    beforeInstallPrompt: 'onbeforeinstallprompt' in window,
    share: typeof navigator.share === 'function',
    shareFiles: canShareFiles(),
    storagePersist: typeof nav.storage?.persist === 'function',
    storageEstimate: typeof nav.storage?.estimate === 'function',
    fileSystemAccess: 'showOpenFilePicker' in window,
    wakeLock: 'wakeLock' in navigator,
    audioWorklet:
      typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype,
    webCodecsAudioEncoder: 'AudioEncoder' in globalThis,
    pointerEvents: 'PointerEvent' in globalThis,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  };
}
