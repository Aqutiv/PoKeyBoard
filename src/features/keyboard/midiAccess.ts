/**
 * Shared Web MIDI access. Settings needs the port list and the permission
 * state; the piano needs the ports themselves. Both go through this one
 * module so there is a single MIDIAccess and a single permission prompt.
 *
 * Nothing here runs at import time — requestMIDIAccess raises a browser
 * permission prompt, so it is only ever called from the Settings toggle or
 * from PianoKeyboard once the setting is already on and permission granted.
 */
export interface MidiPortInfo {
  id: string;
  name: string;
}

export type MidiAccessSnapshot =
  | { kind: 'unsupported' }
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'denied' }
  | { kind: 'error' }
  | { kind: 'ready'; inputs: readonly MidiPortInfo[] };

type PortsListener = (inputs: readonly MIDIInput[]) => void;

const UNSUPPORTED: MidiAccessSnapshot = { kind: 'unsupported' };
const IDLE: MidiAccessSnapshot = { kind: 'idle' };

let access: MIDIAccess | null = null;
let pending: Promise<void> | null = null;
let snapshot: MidiAccessSnapshot = IDLE;
const listeners = new Set<() => void>();
const portsListeners = new Set<PortsListener>();

function isSupported(): boolean {
  return typeof navigator.requestMIDIAccess === 'function';
}

function readInputs(): MIDIInput[] {
  if (!access) return [];
  return [...access.inputs.values()];
}

function publish(next: MidiAccessSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * statechange also fires for outputs, and Windows fires it repeatedly for a
 * single plug event. Rebuilding the snapshot object every time would spin
 * useSyncExternalStore, so only a real change to the input list republishes.
 */
function publishPorts(): void {
  const inputs = readInputs();
  const changed =
    snapshot.kind !== 'ready' ||
    snapshot.inputs.length !== inputs.length ||
    inputs.some((input, index) => {
      const previous = snapshot.kind === 'ready' ? snapshot.inputs[index] : undefined;
      return previous?.id !== input.id || previous.name !== (input.name ?? '');
    });
  if (changed) {
    publish({
      kind: 'ready',
      inputs: inputs.map((input) => ({ id: input.id, name: input.name ?? input.id })),
    });
  }
  for (const listener of portsListeners) listener(inputs);
}

const onStateChange = () => {
  publishPorts();
};

/**
 * Whether the browser has already granted MIDI, so access can be opened
 * without raising a prompt. Chrome prompts on requestMIDIAccess even without
 * sysex, and a returning user whose site permissions were reset should not
 * meet that prompt unprompted on page load.
 */
export async function isAlreadyGranted(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    // The 'midi' descriptor is not in the TS PermissionName union.
    const status = await navigator.permissions.query({
      name: 'midi' as PermissionName,
    });
    return status.state === 'granted';
  } catch {
    // Firefox and older Safari reject unknown descriptors; treat as "ask".
    return false;
  }
}

/** Idempotent: concurrent callers share one request and one MIDIAccess. */
export function ensureAccess(): Promise<void> {
  if (!isSupported()) {
    if (snapshot.kind !== 'unsupported') publish(UNSUPPORTED);
    return Promise.resolve();
  }
  if (access) return Promise.resolve();
  if (pending) return pending;

  publish({ kind: 'requesting' });
  pending = navigator
    .requestMIDIAccess({ sysex: false })
    .then((granted) => {
      access = granted;
      granted.addEventListener('statechange', onStateChange);
      publishPorts();
    })
    .catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : '';
      // Older Chrome reported a denied MIDI prompt as SecurityError.
      publish(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? { kind: 'denied' }
          : { kind: 'error' },
      );
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * Open access only if the browser has already granted MIDI. This is the path
 * the piano takes on load: a returning player gets their keyboard back with
 * no ceremony, and nobody meets a permission prompt they did not ask for.
 */
export async function ensureAccessIfGranted(): Promise<void> {
  if (!(await isAlreadyGranted())) return;
  await ensureAccess();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): MidiAccessSnapshot {
  // Derived rather than captured at import: a browser with no Web MIDI has to
  // read as unsupported before anything asks for access, or Settings shows a
  // live-looking toggle that can never work. UNSUPPORTED is a module constant,
  // so repeated calls stay referentially stable for useSyncExternalStore.
  if (snapshot === IDLE && !isSupported()) return UNSUPPORTED;
  return snapshot;
}

/**
 * Ports, delivered now and on every hot-plug. Consumers bind from the
 * callback and never hold the access promise, so a consumer that detaches
 * before the promise resolves simply is not in this set when it lands.
 */
export function subscribePorts(listener: PortsListener): () => void {
  portsListeners.add(listener);
  if (access) listener(readInputs());
  return () => portsListeners.delete(listener);
}

/** Test-only: the module-level access and snapshot outlive a single test. */
export function __resetForTests(): void {
  if (access) access.removeEventListener('statechange', onStateChange);
  access = null;
  pending = null;
  snapshot = IDLE;
  listeners.clear();
  portsListeners.clear();
}
