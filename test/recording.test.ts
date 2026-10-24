import { describe, expect, it, vi } from 'vitest';
import { SessionRecorder, type api } from '../src/recording';
describe('recording queue', () => {
  it('serializes writes and coalesces snapshots without stale overwrites', async () => {
    let finish!: () => void; const bodies: any[] = [];
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) await new Promise<void>(r => { finish = r; });
      return {};
    });
    const recorder = new SessionRecorder('session', vi.fn(), request as unknown as typeof api);
    recorder.snapshot([]); recorder.snapshot([]); recorder.snapshot([]);
    expect(request).toHaveBeenCalledTimes(1); finish();
    await vi.waitFor(() => expect(recorder.synced).toBe(true));
    expect(bodies.map(b => b.revision)).toEqual([1, 3]); recorder.dispose();
  });
  it('keeps a failed snapshot and retries it', async () => {
    vi.useFakeTimers(); const status = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const recorder = new SessionRecorder('session', status, request as typeof api);
    recorder.snapshot([]); await Promise.resolve(); await Promise.resolve();
    expect(status).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    await vi.advanceTimersByTimeAsync(2001); expect(recorder.synced).toBe(true);
    expect(status).toHaveBeenLastCalledWith(null); recorder.dispose(); vi.useRealTimers();
  });
});
