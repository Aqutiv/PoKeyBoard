/* Audio-render-driven timing pulse for playback while page timers are throttled. */
class PoKeyBoardTransportScheduler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.framesUntilTick = 0;
  }

  process() {
    this.framesUntilTick -= 128;
    if (this.framesUntilTick <= 0) {
      this.port.postMessage(0);
      this.framesUntilTick += Math.max(128, Math.round(sampleRate * 0.025));
    }
    return true;
  }
}

registerProcessor('pokeyboard-transport-scheduler', PoKeyBoardTransportScheduler);
