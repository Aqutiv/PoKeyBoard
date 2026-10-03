/* Audio-render-driven timing pulse for playback while page timers are throttled. */
class PoKeyBoardTransportScheduler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesUntilTick = 0;
    // Silent until the page asks: an idle app must not be woken 40 times a
    // second for pulses nothing is listening to.
    this.ticking = false;
    this.port.onmessage = (event) => {
      this.ticking = event.data === true;
      this.framesUntilTick = 0;
    };
  }

  process() {
    if (!this.ticking) return true;
    this.framesUntilTick -= 128;
    if (this.framesUntilTick <= 0) {
      this.port.postMessage(0);
      this.framesUntilTick += Math.max(128, Math.round(sampleRate * 0.025));
    }
    return true;
  }
}

registerProcessor('pokeyboard-transport-scheduler', PoKeyBoardTransportScheduler);
