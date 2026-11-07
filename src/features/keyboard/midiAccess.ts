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
type OutputsListener = (outputs: readonly MIDIOutput[]) => void;

/**
 * SysEx, which a PartyKeys' lights are set with, is a permission of its own:
 * Chrome asks a second time, warning the site could "reprogram" the device.
 * So it is only ever asked for from the Key lights row, and plain MIDI stays
 * a plain prompt for everyone else.
 */
export type SysexState = 'none' | 'requesting' | 'granted' | 'denied' | 'error';

const UNSUPPORTED: MidiAccessSnapshot = { kind: 'unsupported' };
const IDLE: MidiAccessSnapshot = { kind: 'idle' };

let access: MIDIAccess | null = null;
let pending: Promise<void> | null = null;
let pendingSysex: Promise<boolean> | null = null;
let sysexState: SysexState = 'none';
let snapshot: MidiAccessSnapshot = IDLE;
const listeners = new Set<() => void>();
const portsListeners = new Set<PortsListener>();
const outputsListeners = new Set<OutputsListener>();

function isSupported(): boolean {
  return typeof navigator.requestMIDIAccess === 'function';
}

function readInputs(): MIDIInput[] {
  if (!access) return [];
  return [...access.inputs.values()];
}

function readOutputs(): MIDIOutput[] {
  // A test double may come without outputs at all.
  if (!access?.outputs) return [];
  return [...access.outputs.values()];
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
  if (outputsListeners.size > 0) {
    const outputs = readOutputs();
    for (const listener of outputsListeners) listener(outputs);
  }
}

const onStateChange = () => {
  publishPorts();
};

/** Takes `granted` as the one MIDIAccess: SysEx access replaces a plain one. */
function adopt(granted: MIDIAccess): void {
  if (access) access.removeEventListener('statechange', onStateChange);
  access = granted;
  granted.addEventListener('statechange', onStateChange);
  publishPorts();
}

function setSysexState(next: SysexState): void {
  if (sysexState === next) return;
  sysexState = next;
  for (const listener of listeners) listener();
}

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
      // SysEx access granted meanwhile is the better of the two.
      if (sysexState !== 'granted') adopt(granted);
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

/** Whether the browser has already granted MIDI with SysEx, so it opens without a prompt. */
export async function isSysexGranted(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const status = await navigator.permissions.query({
      name: 'midi' as PermissionName,
      sysex: true,
    } as PermissionDescriptor);
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * MIDI with SysEx, which raises its own prompt unless already granted. Once
 * granted it replaces plain access, so there is still one MIDIAccess, and the
 * ports it lists are bound anew. Resolves whether SysEx can now be sent.
 */
export function ensureSysexAccess(): Promise<boolean> {
  if (!isSupported()) return Promise.resolve(false);
  if (sysexState === 'granted' && access) return Promise.resolve(true);
  if (pendingSysex) return pendingSysex;

  setSysexState('requesting');
  const wasIdle = !access;
  if (wasIdle) publish({ kind: 'requesting' });
  pendingSysex = navigator
    .requestMIDIAccess({ sysex: true })
    .then((granted) => {
      sysexState = 'granted';
      adopt(granted);
      for (const listener of listeners) listener();
      return true;
    })
    .catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : '';
      setSysexState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      // A refused SysEx prompt leaves plain MIDI as it was.
      if (wasIdle && !access) publish(IDLE);
      return false;
    })
    .finally(() => {
      pendingSysex = null;
    });
  return pendingSysex;
}

export function getSysexState(): SysexState {
  return sysexState;
}

/**
 * Open access only if the browser has already granted MIDI. This is the path
 * the piano takes on load: a returning player gets their keyboard back with
 * no ceremony, and nobody meets a permission prompt they did not ask for.
 * SysEx granted before (for a PartyKeys' lights) is opened the same way.
 */
export async function ensureAccessIfGranted(): Promise<void> {
  if ((await isSysexGranted()) && (await ensureSysexAccess())) return;
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

/** Outputs, delivered now (once access is open) and on every hot-plug. */
export function subscribeOutputs(listener: OutputsListener): () => void {
  outputsListeners.add(listener);
  if (access) listener(readOutputs());
  return () => outputsListeners.delete(listener);
}

/** Every input and output now, or none before access is open. */
export function currentPorts(): { inputs: readonly MIDIInput[]; outputs: readonly MIDIOutput[] } {
  return { inputs: readInputs(), outputs: readOutputs() };
}

/** Test-only: the module-level access and snapshot outlive a single test. */
export function __resetForTests(): void {
  if (access) access.removeEventListener('statechange', onStateChange);
  access = null;
  pending = null;
  pendingSysex = null;
  sysexState = 'none';
  snapshot = IDLE;
  listeners.clear();
  portsListeners.clear();
  outputsListeners.clear();
}
