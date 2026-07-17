/**
 * Desktop computer-keyboard input: two rows map to a piano octave and a
 * half starting at the movable base note (default C4). Space is sustain,
 * Z/X shift the base an octave. Auto-repeat is ignored; window blur
 * releases everything.
 */
export interface ComputerKeyboardCallbacks {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  setSustain(down: boolean): void;
}

const KEY_TO_SEMITONE: Record<string, number> = {
  KeyA: 0, // C
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12, // C, next octave
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

const MIN_BASE = 24; // C1
const MAX_BASE = 96; // C7

export class ComputerKeyboardInput {
  private baseMidi = 60;
  private readonly downCodes = new Map<string, number>();
  private sustainKeyDown = false;
  private callbacks: ComputerKeyboardCallbacks | null = null;
  private velocity = 0.75;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.callbacks || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextInput(event.target)) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (!this.sustainKeyDown) {
        this.sustainKeyDown = true;
        this.callbacks.setSustain(true);
      }
      return;
    }
    if (event.code === 'KeyZ' || event.code === 'KeyX') {
      const next = this.baseMidi + (event.code === 'KeyZ' ? -12 : 12);
      this.baseMidi = Math.min(MAX_BASE, Math.max(MIN_BASE, next));
      return;
    }
    const semitone = KEY_TO_SEMITONE[event.code];
    if (semitone === undefined || this.downCodes.has(event.code)) return;
    const midi = this.baseMidi + semitone;
    if (midi < 0 || midi > 127) return;
    this.downCodes.set(event.code, midi);
    this.callbacks.noteOn(midi, this.velocity);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!this.callbacks) return;
    if (event.code === 'Space') {
      if (this.sustainKeyDown) {
        this.sustainKeyDown = false;
        this.callbacks.setSustain(false);
      }
      return;
    }
    const midi = this.downCodes.get(event.code);
    if (midi === undefined) return;
    this.downCodes.delete(event.code);
    this.callbacks.noteOff(midi);
  };

  private readonly onBlur = () => {
    this.releaseAll();
  };

  attach(callbacks: ComputerKeyboardCallbacks): () => void {
    this.callbacks = callbacks;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    return () => {
      this.releaseAll();
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      this.callbacks = null;
    };
  }

  setVelocity(velocity: number): void {
    this.velocity = velocity;
  }

  releaseAll(): void {
    if (!this.callbacks) return;
    for (const [code, midi] of [...this.downCodes]) {
      this.downCodes.delete(code);
      this.callbacks.noteOff(midi);
    }
    if (this.sustainKeyDown) {
      this.sustainKeyDown = false;
      this.callbacks.setSustain(false);
    }
  }
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
