/**
 * iPhone ring/silent-switch workaround: while a looping (silent) media
 * element is playing, iOS treats the page as media playback and Web Audio
 * stays audible with the switch on silent. Activated from the audio unlock
 * gesture on touch devices only — desktops skip it so browser tabs don't
 * show a phantom speaker indicator.
 */

let element: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

/** A 200ms silent 8kHz mono 8-bit WAV, generated locally (no asset). */
function silentWavBlob(): Blob {
  const sampleRate = 8000;
  const samples = sampleRate / 5;
  const dataSize = samples;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).fill(128); // 8-bit silence midpoint
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Start (or keep) the silent playback session. Call from a user gesture. */
export function ensurePlaybackSession(): void {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return;
  if (element) {
    if (element.paused) void element.play().catch(() => undefined);
    return;
  }
  objectUrl = URL.createObjectURL(silentWavBlob());
  element = new Audio(objectUrl);
  element.loop = true;
  element.setAttribute('playsinline', '');
  void element.play().catch(() => {
    // Autoplay rejected — the next unlock gesture retries.
    releasePlaybackSession();
  });
}

export function releasePlaybackSession(): void {
  if (element) {
    element.pause();
    element.src = '';
    element = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}
