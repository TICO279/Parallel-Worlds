import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiggsClient, type ClientOptions } from '../src/realtime/HiggsClient';
import type { SessionBootstrap } from '../shared/domain';
class Socket {
  readyState = 0; bufferedAmount = 0; sent: any[] = [];
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null; onerror: (() => void) | null = null;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close = vi.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.onopen?.(); }
  receive(e: any) { this.onmessage?.({ data: JSON.stringify(e) }); }
}
function harness(overrides: Partial<ClientOptions> = {}) {
  const socket = new Socket();
  const player = { resume: vi.fn(async () => {}), reset: vi.fn(), enqueueBase64: vi.fn(), flush: vi.fn(async () => 520), close: vi.fn(async () => {}) };
  const mic = { active: false, start: vi.fn(async () => { mic.active = true; }), stop: vi.fn(async () => { mic.active = false; }) };
  let chunk: (a: string) => void = () => {};
  const opts = { bootstrap: vi.fn(async () => ({ session: { id: 'local' }, config: { type: 'session.update' }, credential: { value: 'bai-eph-test', expires_at: 9 } }) as SessionBootstrap),
    onBootstrap: vi.fn(), onState: vi.fn(), onActivity: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onMic: vi.fn(), onLevel: vi.fn(),
    socketFactory: vi.fn(() => socket as unknown as WebSocket), playerFactory: () => player,
    micFactory: (send: (a: string) => void) => { chunk = send; return mic; }, ...overrides };
  const client = new HiggsClient(opts);
  return { client, opts, socket, player, mic, chunk: (a: string) => chunk(a) };
}
afterEach(() => vi.useRealTimers());
describe('Higgs adapter with mocked transport and audio', () => {
  it('opens exactly once, configures on open, and waits for acknowledgement before mic audio', async () => {
    const h = harness(); await Promise.all([h.client.connect(), h.client.connect()]);
    expect(h.opts.socketFactory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.opts.socketFactory).mock.calls[0]?.[1]).toEqual(['realtime', 'bai-client-secret.bai-eph-test']);
    h.socket.open(); await h.client.toggleMic(); h.chunk('before');
    expect(h.mic.start).not.toHaveBeenCalled(); expect(h.socket.sent).toEqual([{ type: 'session.update' }]);
    h.socket.receive({ type: 'session.created', session: { id: 'upstream' } });
    await h.client.toggleMic(); h.chunk('after');
    expect(h.socket.sent[1]).toEqual({ type: 'input_audio_buffer.append', audio: 'after' });
    await h.client.disconnect();
  });
  it('interrupts already-generated queued audio, truncates played milliseconds, and suppresses late audio', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.socket.receive({ type: 'response.created' });
    h.socket.receive({ type: 'response.output_item.added', item: { id: 'a1', role: 'assistant' } });
    h.socket.receive({ type: 'response.output_audio.delta', item_id: 'a1', delta: 'pcm' });
    h.socket.receive({ type: 'response.done', response: { status: 'completed' } });
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
    h.socket.receive({ type: 'response.output_audio.delta', item_id: 'a1', delta: 'late-pcm' });
    await Promise.resolve();
    expect(h.player.enqueueBase64).toHaveBeenCalledTimes(1);
    expect(h.socket.sent).toContainEqual({ type: 'conversation.item.truncate', item_id: 'a1', content_index: 0, audio_end_ms: 520 });
    expect(h.opts.onEvent).toHaveBeenCalledWith({ type: 'client.interrupted', item_id: 'a1', played_ms: 520 });
    await h.client.disconnect();
  });
  it('cancels pending bootstrap and does not open a socket afterwards', async () => {
    let resolve!: (data: SessionBootstrap) => void;
    const h = harness({ bootstrap: () => new Promise(r => { resolve = r; }) });
    const pending = h.client.connect(); await Promise.resolve(); await h.client.disconnect();
    resolve({ session: { id: 'late' }, credential: { value: 'secret' }, config: {} } as SessionBootstrap);
    await pending; expect(h.opts.socketFactory).not.toHaveBeenCalled();
  });
  it('cleans up unexpected closes and ignores callbacks retained by an old socket', async () => {
    const h = harness(); await h.client.connect(); h.socket.open();
    const oldMessage = h.socket.onmessage; h.socket.onclose?.({ code: 1006 });
    await vi.waitFor(() => expect(h.client.connectionState).toBe('closed'));
    expect(h.mic.stop).toHaveBeenCalled(); expect(h.player.close).toHaveBeenCalled();
    const count = vi.mocked(h.opts.onEvent).mock.calls.length;
    oldMessage?.({ data: JSON.stringify({ type: 'response.created' }) });
    expect(h.opts.onEvent).toHaveBeenCalledTimes(count);
    expect(h.opts.onError).toHaveBeenCalledWith(expect.stringContaining('1006'));
  });
  it('sanitizes API error payloads and closes the rejected session', async () => {
    const h = harness(); await h.client.connect(); h.socket.open();
    h.socket.receive({ type: 'error', error: { message: 'permanent-secret' } });
    expect(vi.mocked(h.opts.onError).mock.calls.flat().join()).not.toContain('permanent-secret');
    expect(h.socket.close).toHaveBeenCalled();
  });
  it('reports bootstrap failures and releases audio resources', async () => {
    const h = harness({ bootstrap: async () => { throw new Error('Missing local credentials'); } });
    await h.client.connect(); expect(h.opts.onError).toHaveBeenCalledWith('Missing local credentials');
    expect(h.player.close).toHaveBeenCalled(); expect(h.client.connectionState).toBe('closed');
  });
  it('times out configuration acknowledgement and shuts down', async () => {
    vi.useFakeTimers(); const h = harness(); await h.client.connect(); h.socket.open();
    await vi.advanceTimersByTimeAsync(25001);
    expect(h.client.connectionState).toBe('closed'); expect(h.opts.onError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });
  it('keeps a microphone denial recoverable', async () => {
    const h = harness(); h.mic.start.mockRejectedValueOnce(new Error('permission denied'));
    await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' }); await h.client.toggleMic();
    expect(h.opts.onError).toHaveBeenCalledWith(expect.stringContaining('Allow microphone'));
    expect(h.client.connectionState).toBe('ready'); await h.client.disconnect();
  });
});
