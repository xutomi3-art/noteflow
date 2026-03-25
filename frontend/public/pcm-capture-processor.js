/**
 * AudioWorklet processor for capturing PCM 16-bit 16kHz mono audio.
 * Downsamples from device sample rate, buffers to 200ms chunks.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetRate = 16000;
    this.chunkSamples = 3200; // 200ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array, mono channel
    const ratio = sampleRate / this.targetRate;

    // Downsample by skipping samples
    for (let i = 0; i < samples.length; i += ratio) {
      const idx = Math.floor(i);
      if (idx < samples.length) {
        // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
        const s = Math.max(-1, Math.min(1, samples[idx]));
        this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
      }
    }

    // Send 200ms chunks
    while (this.buffer.length >= this.chunkSamples) {
      const chunk = this.buffer.splice(0, this.chunkSamples);
      const int16 = new Int16Array(chunk);
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
