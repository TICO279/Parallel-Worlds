// Adapted from Boson's Apache-2.0 tutorial; adds cancellation and failure cleanup.
import captureSource from './worklets/capture-processor.js?raw';
import { addWorkletModule } from './loadWorklet';
import { createResampler, floatTo16BitPCM } from './resample';
import { AUDIO_RATE } from './constants';
function encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
export class MicCapture {
  private generation = 0; private starting = false;
  private ctx: AudioContext | null = null; private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null; private node: AudioWorkletNode | null = null;
  constructor(private onChunk: (base64: string) => void, private onLevel?: (rms: number) => void) {}
  get active() { return this.node !== null; }
  async start(): Promise<void> {
    if (this.active || this.starting) return;
    this.starting = true; const gen = ++this.generation;
    let stream: MediaStream | undefined; let ctx: AudioContext | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone requires localhost or a secure browser context.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
      if (gen !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      ctx = new AudioContext(); this.stream = stream; this.ctx = ctx;
      await addWorkletModule(ctx, captureSource);
      if (gen !== this.generation) return;
      const resampler = createResampler(ctx.sampleRate, AUDIO_RATE);
      this.source = ctx.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = e => {
        if (gen !== this.generation) return;
        const frame = new Float32Array(e.data); let sum = 0;
        for (const sample of frame) sum += sample * sample;
        this.onLevel?.(Math.sqrt(sum / frame.length));
        const converted = resampler.process(frame);
        if (converted.length) this.onChunk(encode(floatTo16BitPCM(converted)));
      };
      this.source.connect(this.node); this.node.connect(ctx.destination);
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (gen === this.generation) await this.stop();
      if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
      throw error;
    } finally { if (gen === this.generation) this.starting = false; }
  }
  async stop(): Promise<void> {
    ++this.generation; this.starting = false;
    this.node?.port.close(); this.source?.disconnect(); this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    const ctx = this.ctx; this.ctx = null; this.stream = null; this.source = null; this.node = null;
    this.onLevel?.(0);
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  }
}
