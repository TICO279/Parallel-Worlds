import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicCapture } from '../src/audio/capture';
describe('audio resource lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('stops a microphone permission request that resolves after disconnect', async () => {
    let resolve!: (stream: unknown) => void; const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r; }) } });
    const capture = new MicCapture(vi.fn()); const pending = capture.start(); await capture.stop();
    resolve({ getTracks: () => [{ stop }] }); await pending;
    expect(stop).toHaveBeenCalledTimes(1); expect(capture.active).toBe(false);
  });
  it('releases acquired tracks if AudioContext initialization fails', async () => {
    const stop = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('device failed'); } });
    const capture = new MicCapture(vi.fn()); await expect(capture.start()).rejects.toThrow('device failed');
    expect(stop).toHaveBeenCalled(); expect(capture.active).toBe(false);
  });
});
describe('playback AudioWorklet', () => {
  function worklet() {
    let Processor: any;
    runInNewContext(readFileSync(new URL('../src/audio/worklets/playback-processor.js', import.meta.url), 'utf8'), {
      AudioWorkletProcessor: class { port = { onmessage: null, postMessage: vi.fn() }; },
      registerProcessor: (_name: string, ctor: any) => { Processor = ctor; },
    });
    return new Processor();
  }
  it('counts played samples rather than received samples and flushes queued audio', () => {
    const p = worklet(); p.push(new Int16Array([32767, -32768, 16384, 0]));
    const out = new Float32Array(2); p.process([], [[out]]);
    expect(out[0]).toBeCloseTo(1); expect(out[1]).toBe(-1);
    p.port.onmessage({ data: { type: 'flush' } });
    expect(p.port.postMessage).toHaveBeenCalledWith({ type: 'flushed', played: 2 });
    p.process([], [[out]]); expect(Array.from(out)).toEqual([0, 0]);
  });
  it('reports overflow instead of silently discarding unheard words', () => {
    const p = worklet(); p.available = p.size;
    p.push(new Int16Array([1])); expect(p.port.postMessage).toHaveBeenCalledWith({ type: 'overflow' });
    expect(p.available).toBe(0);
  });
});
