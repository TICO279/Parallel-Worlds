/** Buffered WAV playback lets the browser decode the provider's actual sample rate. */
export class TtsPlayback {
  private ctx?: AudioContext; private source?: AudioBufferSourceNode;
  private startedAt = 0; private duration = 0;
  async resume() { this.ctx ??= new AudioContext(); await this.ctx.resume(); }
  async play(bytes: ArrayBuffer, signal: AbortSignal, onStart: () => void, onEnd: () => void) {
    if (!this.ctx || signal.aborted) return;
    const audio = await this.ctx.decodeAudioData(bytes);
    if (signal.aborted || !this.ctx || this.ctx.state === 'closed') return;
    const source = this.ctx.createBufferSource(); source.buffer = audio; source.connect(this.ctx.destination);
    this.source = source; this.duration = audio.duration; this.startedAt = this.ctx.currentTime;
    source.onended = () => { source.disconnect(); if (this.source === source) { this.source = undefined; onEnd(); } };
    source.start(); onStart();
  }
  stop() {
    const played = this.source && this.ctx ? Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.startedAt)) * 1000 : 0;
    if (this.source) { this.source.onended = null; this.source.stop(); this.source.disconnect(); this.source = undefined; }
    return played;
  }
  async close() { this.stop(); const ctx = this.ctx; this.ctx = undefined; if (ctx && ctx.state !== 'closed') await ctx.close(); }
}
