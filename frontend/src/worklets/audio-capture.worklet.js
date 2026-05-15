class SentinelAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(16000 * 8);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i += 1) {
      this.buffer[this.offset] = input[i];
      this.offset += 1;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(16000);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("sentinel-audio-capture", SentinelAudioCapture);
