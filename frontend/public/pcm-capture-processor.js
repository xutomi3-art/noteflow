/**
 * AudioWorklet: accumulates PCM samples and sends ~256ms chunks as Int16.
 * Based on huiyizhushou2's proven implementation.
 * No downsampling — AudioContext should be created with sampleRate: 16000.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._bufferSize = 4096; // ~256ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    // Accumulate samples
    const newBuf = new Float32Array(this._buffer.length + channelData.length);
    newBuf.set(this._buffer);
    newBuf.set(channelData, this._buffer.length);
    this._buffer = newBuf;

    // Send when buffer is full
    while (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.slice(0, this._bufferSize);
      this._buffer = this._buffer.slice(this._bufferSize);

      // Convert float32 to int16
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMProcessor);
