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
  let drained = () => {}; let started = () => {};
  const opts = { bootstrap: vi.fn(async () => ({ session: { id: 'local' }, config: { type: 'session.update' }, credential: { value: 'bai-eph-test', expires_at: 9 } }) as SessionBootstrap),
    onBootstrap: vi.fn(), onState: vi.fn(), onActivity: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onMic: vi.fn(), onLevel: vi.fn(),
    onApplication: vi.fn(), onLatency: vi.fn(),
    socketFactory: vi.fn(() => socket as unknown as WebSocket), playerFactory: (onDrain: () => void, _failure: (message: string) => void, onStart: () => void) => { drained = onDrain; started = onStart; return player; },
    micFactory: (send: (a: string) => void) => { chunk = send; return mic; }, ...overrides };
  const client = new HiggsClient(opts);
  return { client, opts, socket, player, mic, chunk: (a: string) => chunk(a), drained: () => drained(), playbackStarted: () => started() };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('Higgs adapter with mocked transport and audio', () => {
  it('defers adaptive updates through generation and playback, and records only matching acknowledgements', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    h.socket.receive({ type: 'response.output_audio.delta', item_id: 'a1', delta: 'pcm' });
    h.client.queueInstructions(1, 'Warm but still Alex.');
    expect(h.socket.sent).toHaveLength(1);
    h.socket.receive({ type: 'response.done', response: { id: 'r1' } }); expect(h.socket.sent).toHaveLength(1);
    h.drained(); expect(h.socket.sent.at(-1)).toMatchObject({ type: 'session.update', session: { instructions: 'Warm but still Alex.' } });
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Other instructions' } });
    expect(h.opts.onApplication).not.toHaveBeenCalledWith(1, 'acknowledged');
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Warm but still Alex.' } });
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'acknowledged');
    const count = h.socket.sent.length; h.client.queueInstructions(1, 'duplicate'); expect(h.socket.sent).toHaveLength(count);
    expect(h.socket.sent.some(e => e.type === 'response.create')).toBe(false); await h.client.disconnect();
  });
  it('does not update while the user speaks or while waiting for an automatic response', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' }); h.client.queueInstructions(1, 'Curious.');
    h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' }); expect(h.socket.sent).toHaveLength(1);
    h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    h.socket.receive({ type: 'response.done', response: { id: 'r1' } }); expect(h.socket.sent).toHaveLength(2);
    await h.client.disconnect();
  });
  it('times out a guidance update without disrupting the voice connection', async () => {
    vi.useFakeTimers(); const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.client.queueInstructions(1, 'New guidance'); await vi.advanceTimersByTimeAsync(5001);
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'failed'); expect(h.client.connectionState).toBe('ready');
    const count = h.socket.sent.length; h.client.queueInstructions(2, 'Later guidance'); expect(h.socket.sent).toHaveLength(count);
    await h.client.disconnect();
  });
  it('coalesces queued state versions while keeping acknowledgements ordered', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.client.queueInstructions(1, 'First'); h.client.queueInstructions(2, 'Second'); h.client.queueInstructions(3, 'Third');
    expect(h.socket.sent).toHaveLength(2);
    h.socket.receive({ type: 'session.updated', session: { instructions: 'First' } });
    expect(h.socket.sent.at(-1).session.instructions).toBe('Third');
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Third' } });
    expect(h.opts.onApplication).toHaveBeenCalledWith(3, 'acknowledged');
    expect(h.socket.sent.some(e => e.session?.instructions === 'Second')).toBe(false); await h.client.disconnect();
  });
  it('cancels in-flight instruction application and ignores a late acknowledgement after disconnect', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.client.queueInstructions(1, 'Warm'); const callback = h.socket.onmessage;
    await h.client.disconnect(); callback?.({ data: JSON.stringify({ type: 'session.updated', session: { instructions: 'Warm' } }) });
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'failed');
    expect(h.opts.onApplication).not.toHaveBeenCalledWith(1, 'acknowledged');
  });
  it('measures actual event and playback timing using the monotonic clock and PCM position', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' }); await h.client.toggleMic();
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' }); h.chunk(Buffer.alloc(4800).toString('base64'));
    now.mockReturnValue(1500); h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1', audio_end_ms: 80 });
    now.mockReturnValue(1600); h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    now.mockReturnValue(1700); h.socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1' });
    now.mockReturnValue(1800); h.socket.receive({ type: 'response.output_audio.delta', response_id: 'r1', item_id: 'a1', delta: 'pcm' });
    now.mockReturnValue(1830); h.playbackStarted();
    expect(h.opts.onLatency).toHaveBeenLastCalledWith({ turnId: 'u1', speechEndedAt: 980, speechStoppedAt: 1500,
      responseId: 'r1', responseCreatedAt: 1600, transcriptFinalAt: 1700, firstAudioAt: 1800, playbackStartedAt: 1830, appliedStateVersion: 0 });
    await h.client.disconnect();
  });
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
  it('replays branch history after acknowledgement and before microphone audio', async () => {
    const item = { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_0', role: 'user', content: [] } };
    const h = harness({ seed: () => [item] }); await h.client.connect(); h.socket.open();
    expect(h.socket.sent).toEqual([{ type: 'session.update' }]);
    h.socket.receive({ type: 'session.created' }); await h.client.toggleMic(); h.chunk('pcm');
    expect(h.socket.sent).toEqual([{ type: 'session.update' }, item, { type: 'input_audio_buffer.append', audio: 'pcm' }]);
    await h.client.disconnect();
  });
  it('sends a typed turn only while the session is ready and the microphone is off', async () => {
    const h = harness(); await h.client.connect(); h.socket.open();
    expect(h.client.sendText('hi')).toBe(false);
    h.socket.receive({ type: 'session.created' });
    expect(h.client.sendText('   ')).toBe(false); expect(h.client.sendText('  Hello there ')).toBe(true);
    expect(h.socket.sent.slice(1)).toEqual([
      { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello there' }] } },
      { type: 'response.create' }]);
    await h.client.toggleMic(); expect(h.client.sendText('typed while speaking')).toBe(false);
    expect(h.socket.sent).toHaveLength(3); await h.client.disconnect();
  });
  it('attributes response latency to the echoed typed turn', async () => {
    const h = harness(); await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    h.client.sendText('Hello');
    h.socket.receive({ type: 'conversation.item.added', item: { id: 'u1', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] } });
    h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    expect(h.opts.onLatency).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: 'u1', responseId: 'r1', speechStoppedAt: expect.any(Number) }));
    await h.client.disconnect();
  });
});
