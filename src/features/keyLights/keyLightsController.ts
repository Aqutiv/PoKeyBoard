import type { InputNoteEvent } from '@/audio/AudioEngine';
import type { NoteEvent } from '@/domain/takeTypes';
import { cuesMove, NO_KEYS, takeCuesAt } from '@/features/keyboard/playbackCues';
import { SoundingNotes } from '@/features/keyboard/soundingNotes';
import type { TransportState } from '@/features/transport/transportMachine';
import { deviceLights, EMPTY_SCENE, type KeyLightScene } from './keyLightModel';
import { KeyLightSession } from './keyLightSession';
import type { LightLink, LightLinksSnapshot } from './lightLinks';
import {
  isButtonReport,
  NO_SHIFT,
  parseShiftReport,
  shiftForNote,
  type KeyboardShift,
} from './partyKeysProtocol';

/**
 * After a Multi-Function Button report the keyboard shows its own hints:
 * nothing is sent for this long, then every key is drawn again, and again at
 * `BUTTON_REPAINT_MS` (PianoBallDesktop, measured on this keyboard).
 */
export const BUTTON_HOLD_MS = 1500;
export const BUTTON_REPAINT_MS = 4000;

/** After a send fails, the next try waits this long, so a dead link is not hammered. */
export const RETRY_AFTER_FAILURE_MS = 1000;

/**
 * How far ahead of the playhead the take's lights are drawn, to meet the
 * sound rather than trail it. Tuned on the keyboard; the on-screen keys use
 * the playhead as it is.
 */
export const LIGHT_LEAD_MS = 0;

/** What the lights read from the rest of the app; the runtime wires the real ones. */
export interface KeyLightsDeps {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  watchLinks(listener: (snapshot: LightLinksSnapshot) => void): () => void;
  /** Key lights on, and MIDI on, which every keyboard connection rides on. */
  enabled(): boolean;
  followsVelocity(): boolean;
  subscribeSettings(listener: () => void): () => void;
  transportState(): TransportState;
  playheadMs(): number;
  /** The open take's notes, sorted by start. */
  notes(): readonly NoteEvent[];
  subscribeTransport(listener: () => void): () => void;
  /** Every key played, from every input: the screen, the computer keyboard, MIDI… */
  subscribeInput(listener: (event: InputNoteEvent) => void): () => void;
  /** An animation-frame tick, for while the page is shown. */
  subscribeFrames(listener: () => void): () => void;
  /** The audio scheduler's tick, which runs on behind a hidden page. */
  subscribeBackgroundTicks(listener: () => void): () => void;
  hidden(): boolean;
  /** Settings → playback in the background, so a take keeps playing hidden. */
  backgroundPlayback(): boolean;
  subscribeVisibility(listener: () => void): () => void;
  subscribePageHide(listener: () => void): () => void;
  /**
   * What the screen's keyboard asks for beyond the take: keys waited for, wrong
   * keys, notes coming. Empty until the practice and lesson lights fill it.
   */
  extras?(): Pick<KeyLightScene, 'targets' | 'wrong' | 'coming' | 'faint'>;
  subscribeExtras?(listener: () => void): () => void;
}

/**
 * Presses whose keys are lit: the on-screen keys, the computer keyboard and a
 * game controller. Not MIDI: the lit keyboard's own presses are drawn white by
 * its firmware over any colour, and its colour comes back on release.
 */
function drawsPressesFrom(sourceId: string): boolean {
  return sourceId === 'kbd' || sourceId === 'gamepad' || sourceId.startsWith('pointer:');
}

export interface KeyLightsStatus {
  /** The keyboard being lit, if any. */
  readonly keyboard: { readonly name: string; readonly transport: LightLink['transport'] } | null;
  /** The name of a PartyKeys on USB that SysEx would let the app light. */
  readonly awaitingSysex: string | null;
}

const NO_STATUS: KeyLightsStatus = { keyboard: null, awaitingSysex: null };

/**
 * Lights a connected PartyKeys the way the on-screen keys are lit: the take's
 * notes in their hands as they play, softer ones dimmer, keys held from the
 * screen or the computer keyboard, and whatever the practice and lesson lights
 * add. One keyboard at a time, Bluetooth before USB.
 *
 * It sends only what changes, at most 25 updates a second, and is quiet when
 * nothing moves: it ticks with the frames only while the take does, and
 * otherwise on the events that change what the keys show.
 */
export class KeyLightsController {
  private readonly deps: KeyLightsDeps;
  private link: LightLink | null = null;
  private session = new KeyLightSession();
  private shift: KeyboardShift = NO_SHIFT;
  private readonly sounding = new SoundingNotes();
  private readonly held = new Map<string, Map<number, number>>();
  private status: KeyLightsStatus = NO_STATUS;
  private readonly statusListeners = new Set<() => void>();
  private wasEnabled = false;
  private sending = false;
  /** Moved on by each batch of frames, and by a release, which ends the one in flight. */
  private batch = 0;
  private timer: unknown = null;
  private timerAt = Number.POSITIVE_INFINITY;
  private holdUntil = Number.NEGATIVE_INFINITY;
  private retryAt = Number.NEGATIVE_INFINITY;
  private repaintTimer: unknown = null;
  private stopMotion: (() => void) | null = null;
  private motionHidden = false;
  private stopInput: (() => void) | null = null;

  constructor(deps: KeyLightsDeps) {
    this.deps = deps;
  }

  start(): () => void {
    const { deps } = this;
    this.wasEnabled = deps.enabled();
    const stops = [
      deps.watchLinks((snapshot) => this.onLinks(snapshot)),
      deps.subscribeSettings(() => this.onSettings()),
      deps.subscribeTransport(() => this.onMotion()),
      deps.subscribeVisibility(() => this.onMotion()),
      deps.subscribeInput((event) => this.onInput(event)),
      deps.subscribePageHide(() => this.releaseNow()),
      deps.subscribeExtras?.(() => this.requestTick()) ?? (() => undefined),
    ];
    this.onMotion();
    return () => {
      for (const stop of stops) stop();
      this.releaseNow();
      this.useLink(null);
      this.stopMotion?.();
      this.stopMotion = null;
      this.clearTimer();
      if (this.repaintTimer !== null) this.deps.clearTimer(this.repaintTimer);
      this.repaintTimer = null;
      this.held.clear();
    };
  }

  getStatus(): KeyLightsStatus {
    return this.status;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** What the keys show now, by note; also what a test reads. */
  scene(): KeyLightScene {
    const { deps } = this;
    const state = deps.transportState();
    const hidden = deps.hidden();
    // A take playing on behind a hidden page still lights the keys under the
    // player's hands; anything else waits for the page to come back.
    const shown = !hidden || (state === 'playing' && deps.backgroundPlayback());
    const cues = cuesMove(state)
      ? takeCuesAt(this.sounding, state, deps.notes(), deps.playheadMs() + LIGHT_LEAD_MS)
      : NO_KEYS;
    const held = new Map<number, number>();
    for (const keys of this.held.values()) {
      for (const [midi, velocity] of keys) held.set(midi, Math.max(velocity, held.get(midi) ?? 0));
    }
    const extras = deps.extras?.() ?? EMPTY_SCENE;
    return {
      shown,
      followsVelocity: deps.followsVelocity(),
      cues,
      held,
      targets: extras.targets,
      wrong: extras.wrong,
      coming: extras.coming,
      faint: extras.faint,
    };
  }

  private setStatus(next: KeyLightsStatus): void {
    const same =
      next.awaitingSysex === this.status.awaitingSysex &&
      next.keyboard?.name === this.status.keyboard?.name &&
      next.keyboard?.transport === this.status.keyboard?.transport;
    if (same) return;
    this.status = next;
    for (const listener of this.statusListeners) listener();
  }

  private onLinks(snapshot: LightLinksSnapshot): void {
    const next = snapshot.links[0] ?? null;
    if (next !== this.link) {
      // A keyboard still there, set aside for another (Bluetooth came up
      // beside USB), gets its own lights back first.
      if (this.link && snapshot.links.includes(this.link)) this.releaseNow();
      this.useLink(next);
    }
    this.setStatus({
      keyboard: next ? { name: next.name, transport: next.transport } : null,
      awaitingSysex: snapshot.awaitingSysex,
    });
    this.requestTick();
  }

  private useLink(next: LightLink | null): void {
    if (this.stopInput) this.stopInput();
    this.stopInput = null;
    // A batch still going to the last keyboard has nowhere left to go.
    this.batch += 1;
    this.link = next;
    // A new connection is a keyboard back at octave 0 in its own light mode.
    this.session = new KeyLightSession();
    this.shift = NO_SHIFT;
    this.holdUntil = Number.NEGATIVE_INFINITY;
    this.retryAt = Number.NEGATIVE_INFINITY;
    if (!next) return;
    const onMessage = (event: Event) => this.onKeyboardMessage((event as MessageEvent).data);
    next.input.addEventListener('midimessage', onMessage);
    this.stopInput = () => next.input.removeEventListener('midimessage', onMessage);
  }

  private onSettings(): void {
    const enabled = this.deps.enabled();
    if (this.wasEnabled && !enabled) this.releaseNow();
    this.wasEnabled = enabled;
    this.requestTick();
  }

  /** Follows the take with the frames while it moves, and with the audio's tick behind a hidden page. */
  private onMotion(): void {
    const { deps } = this;
    const moving = cuesMove(deps.transportState());
    const hidden = deps.hidden();
    if (this.stopMotion && (!moving || hidden !== this.motionHidden)) {
      this.stopMotion();
      this.stopMotion = null;
    }
    if (moving && !this.stopMotion) {
      this.motionHidden = hidden;
      const tick = () => this.tick();
      this.stopMotion = hidden ? deps.subscribeBackgroundTicks(tick) : deps.subscribeFrames(tick);
    }
    this.requestTick();
  }

  private onInput(event: InputNoteEvent): void {
    if (event.type === 'sustain' || !drawsPressesFrom(event.sourceId)) return;
    let keys = this.held.get(event.sourceId);
    if (event.type === 'on') {
      if (!keys) {
        keys = new Map();
        this.held.set(event.sourceId, keys);
      }
      keys.set(event.midi, event.velocity);
    } else if (keys) {
      keys.delete(event.midi);
      if (keys.size === 0) this.held.delete(event.sourceId);
    }
    this.requestTick();
  }

  /** The lit keyboard's own messages: its notes say where its octave is; its SysEx, what it did. */
  private onKeyboardMessage(data: unknown): void {
    if (!(data instanceof Uint8Array) || data.length < 2) return;
    const status = data[0] as number;
    if ((status & 0xf0) === 0x90 && (data[2] ?? 0) > 0) {
      const shift = shiftForNote(data[1] as number, this.shift);
      if (shift.octave !== this.shift.octave || shift.transpose !== this.shift.transpose) {
        this.shift = shift;
        this.requestTick();
      }
      return;
    }
    if (status !== 0xf0) return;
    const report = parseShiftReport(data);
    if (report) {
      this.shift = report;
      this.requestTick();
      return;
    }
    if (isButtonReport(data)) this.onButton();
  }

  /** The keyboard took its lights over: let its hints show, then draw every key again, twice. */
  private onButton(): void {
    const now = this.deps.now();
    this.holdUntil = now + BUTTON_HOLD_MS;
    // Colours still going out would land on the keyboard's own hints; the
    // repaint after the hold draws every key anyway.
    this.batch += 1;
    this.session.repaintAll();
    if (this.repaintTimer !== null) this.deps.clearTimer(this.repaintTimer);
    this.repaintTimer = this.deps.setTimer(() => {
      this.repaintTimer = null;
      this.session.repaintAll();
      this.requestTick();
    }, BUTTON_REPAINT_MS);
    this.schedule(BUTTON_HOLD_MS);
  }

  private active(): boolean {
    return this.link !== null && this.deps.enabled();
  }

  private requestTick(): void {
    this.schedule(0);
  }

  /** A tick no later than `ms` from now. */
  private schedule(ms: number): void {
    if (!this.active()) return;
    const at = this.deps.now() + ms;
    if (this.timer !== null && this.timerAt <= at) return;
    this.clearTimer();
    this.timerAt = at;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.timerAt = Number.POSITIVE_INFINITY;
      this.tick();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.timerAt = Number.POSITIVE_INFINITY;
  }

  private tick(): void {
    const link = this.link;
    if (!link || !this.deps.enabled()) return;
    // A send in flight ends with a tick of its own, which takes the newest state.
    if (this.sending) return;
    const now = this.deps.now();
    const waitUntil = Math.max(this.holdUntil, this.retryAt);
    if (now < waitUntil) {
      this.schedule(waitUntil - now);
      return;
    }
    const wanted = deviceLights(this.scene(), this.shift);
    const frames = this.session.step(now, wanted);
    if (frames.length > 0) {
      void this.send(link, frames);
      return;
    }
    const next = this.session.nextStepIn(now, wanted);
    if (next !== null) this.schedule(next);
  }

  private async send(link: LightLink, frames: readonly Uint8Array[]): Promise<void> {
    this.sending = true;
    const session = this.session;
    const batch = ++this.batch;
    try {
      for (const frame of frames) {
        // Released or handed over since this batch began: what is left of it
        // would land after the hand-back and light a keyboard given back.
        if (batch !== this.batch) break;
        await link.send(frame);
      }
    } catch (error) {
      if (session === this.session) {
        session.fail();
        this.retryAt = this.deps.now() + RETRY_AFTER_FAILURE_MS;
      }
      console.warn('PartyKeys lights could not be sent:', error);
    } finally {
      this.sending = false;
    }
    // Whatever changed while these went out goes next.
    this.requestTick();
  }

  /** Lights out and the keyboard's own lights back, sent without waiting: the page may be going. */
  private releaseNow(): void {
    const link = this.link;
    if (!link) return;
    this.clearTimer();
    this.batch += 1;
    for (const frame of this.session.release()) void link.send(frame).catch(() => undefined);
  }
}
