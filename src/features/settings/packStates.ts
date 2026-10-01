import { audioEngine } from '@/audio/AudioEngine';
import type { PianoInstrumentId } from '@/audio/instruments';

/**
 * Each piano's offline copy, as its card in Settings shows it. Kept here rather
 * than in the card, which unmounts whenever the player leaves Settings or its
 * Sound section: a download carries on in the engine regardless, and a card
 * that came back without it would offer Download again and fetch the pack a
 * second time.
 *
 * Failures carry no text: the card words them when it renders, in whatever
 * language is chosen by then.
 */
export type PackState =
  | { kind: 'checking' }
  | { kind: 'not-downloaded'; totalBytes: number }
  | { kind: 'downloading'; loadedBytes: number; totalBytes: number }
  | { kind: 'offline-ready'; totalBytes: number }
  | { kind: 'error'; failure: 'check' | 'download'; detail: string | null; totalBytes: number };

export type PackStates = Readonly<Partial<Record<PianoInstrumentId, PackState>>>;

let states: PackStates = {};
const downloading = new Set<PianoInstrumentId>();
const listeners = new Set<() => void>();

function publish(id: PianoInstrumentId, state: PackState): void {
  states = { ...states, [id]: state };
  for (const listener of listeners) listener();
}

export function subscribePacks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A new object on every change, so it serves useSyncExternalStore as is. */
export function getPacks(): PackStates {
  return states;
}

/**
 * Look again at whether a piano is downloaded. Until the first look lands its
 * card reads as checking; after that it keeps the last answer meanwhile, so a
 * card that comes back does not flicker. A download in flight is left alone:
 * it reports its own progress and looks again once it ends.
 */
export async function refreshPack(id: PianoInstrumentId): Promise<void> {
  if (downloading.has(id)) return;
  let next: PackState;
  try {
    const manifest = await audioEngine.bankFor(id).loadManifest();
    const offline = await audioEngine.isFullPackOffline(id);
    next = { kind: offline ? 'offline-ready' : 'not-downloaded', totalBytes: manifest.totalBytes };
  } catch {
    next = { kind: 'error', failure: 'check', detail: null, totalBytes: 0 };
  }
  // A download that started while this looked owns the state now.
  if (!downloading.has(id)) publish(id, next);
}

/** Download a piano for offline use; only from a card that offers it. */
export function downloadPack(id: PianoInstrumentId): void {
  const state = states[id];
  if (downloading.has(id)) return;
  if (state?.kind !== 'not-downloaded' && state?.kind !== 'error') return;
  downloading.add(id);
  publish(id, { kind: 'downloading', loadedBytes: 0, totalBytes: state.totalBytes });
  audioEngine
    .downloadFullSamplePack(id, (loadedBytes, totalBytes) => {
      publish(id, { kind: 'downloading', loadedBytes, totalBytes });
    })
    .then(
      () => {
        downloading.delete(id);
        return refreshPack(id);
      },
      (error: unknown) => {
        downloading.delete(id);
        publish(id, {
          kind: 'error',
          failure: 'download',
          detail: error instanceof Error ? error.message : null,
          totalBytes: 0,
        });
      },
    );
}

/** Delete a piano's downloaded samples; the caller has asked the player first. */
export async function deletePack(id: PianoInstrumentId): Promise<void> {
  await audioEngine.deleteDownloadedSamples(id);
  await refreshPack(id);
}

/** Test-only: the states outlive a single test. */
export function __resetForTests(): void {
  states = {};
  downloading.clear();
  listeners.clear();
}
