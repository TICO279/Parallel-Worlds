import { afterEach, describe, expect, it, vi } from 'vitest';
import { HiggsClient, type ClientOptions } from '../src/realtime/HiggsClient';
import type { SessionBootstrap } from '../shared/domain';
import type { JudgeResult } from '../shared/characterState';
class Socket {
  readyState = 0; bufferedAmount = 0; sent: any[] = [];
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null; onerror: (() => void) | null = null;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close = vi.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.onopen?.(); }
  receive(e: any) { this.onmessage?.({ data: JSON.stringify(e) }); }
}
async function* pcm(...chunks: number[][]) { for (const c of chunks) yield new Uint8Array(c); }
const ordinary: JudgeResult = { major: false, majorShift: 0.1, event: 'neutral', stateVersion: 1 };
function harness(overrides: Partial<ClientOptions> = {}) {
  const socket = new Socket();
  const player = { resume: vi.fn(async () => {}), reset: vi.fn(), enqueuePcm: vi.fn(), flush: vi.fn(async () => 520), close: vi.fn(async () => {}) };
  const mic = { active: false, start: vi.fn(async () => { mic.active = true; }), stop: vi.fn(async () => { mic.active = false; }) };
  const pipeline = { judge: vi.fn(async (_id: string, _signal: AbortSignal): Promise<JudgeResult> => ordinary),
    speak: vi.fn(async (_reply: { itemId: string; text: string }, _signal: AbortSignal) => pcm([1, 2, 3, 4])) };
  let chunk: (a: string) => void = () => {};
  let drained = () => {}; let started = () => {};
  const opts = { bootstrap: vi.fn(async () => ({ session: { id: 'local' }, config: { type: 'session.update', session: { instructions: 'Base.' } }, credential: { value: 'bai-eph-test', expires_at: 9 } }) as unknown as SessionBootstrap),
    onBootstrap: vi.fn(), onState: vi.fn(), onActivity: vi.fn(), onEvent: vi.fn(), onError: vi.fn(), onMic: vi.fn(), onLevel: vi.fn(),
    onApplication: vi.fn(), onLatency: vi.fn(), pipeline,
    socketFactory: vi.fn(() => socket as unknown as WebSocket), playerFactory: (onDrain: () => void, _failure: (message: string) => void, onStart: () => void) => { drained = onDrain; started = onStart; return player; },
    micFactory: (send: (a: string) => void) => { chunk = send; return mic; }, ...overrides };
  const client = new HiggsClient(opts);
  return { client, opts, socket, player, mic, pipeline, chunk: (a: string) => chunk(a), drained: () => drained(), playbackStarted: () => started() };
}
type H = ReturnType<typeof harness>;
const ready = async (h: H) => { await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' }); };
/** A spoken user line through to its final transcript. */
const said = (h: H, id: string, text = 'Hello there.') => {
  h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: id });
  h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: id });
  h.socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text });
};
/** Higgs drafting a text reply (text mode: output_text.done carries no item_id). */
const draft = (h: H, r: string, a: string, text = 'Nice to meet you.', finish = true) => {
  h.socket.receive({ type: 'response.created', response: { id: r } });
  h.socket.receive({ type: 'response.output_item.added', response_id: r, item: { id: a, role: 'assistant' } });
  h.socket.receive({ type: 'response.output_text.delta', response_id: r, item_id: a, delta: text });
  if (finish) { h.socket.receive({ type: 'response.output_text.done', response_id: r, text }); h.socket.receive({ type: 'response.done', response: { id: r, status: 'completed' } }); }
};
const settle = () => new Promise(r => setTimeout(r, 0));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('Higgs adapter: connection lifecycle', () => {
  it('opens exactly once, configures on open, and waits for acknowledgement before mic audio', async () => {
    const h = harness(); await Promise.all([h.client.connect(), h.client.connect()]);
    expect(h.opts.socketFactory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.opts.socketFactory).mock.calls[0]?.[1]).toEqual(['realtime', 'bai-client-secret.bai-eph-test']);
    h.socket.open(); await h.client.toggleMic(); h.chunk('before');
    expect(h.mic.start).not.toHaveBeenCalled(); expect(h.socket.sent).toEqual([{ type: 'session.update', session: { instructions: 'Base.' } }]);
    h.socket.receive({ type: 'session.created', session: { id: 'upstream' } });
    await h.client.toggleMic(); h.chunk('after');
    expect(h.socket.sent[1]).toEqual({ type: 'input_audio_buffer.append', audio: 'after' });
    await h.client.disconnect();
  });
  it('cancels pending bootstrap and does not open a socket afterwards', async () => {
    let resolve!: (data: SessionBootstrap) => void;
    const h = harness({ bootstrap: () => new Promise(r => { resolve = r; }) });
    const pending = h.client.connect(); await Promise.resolve(); await h.client.disconnect();
    resolve({ session: { id: 'late' }, credential: { value: 'secret' }, config: {} } as unknown as SessionBootstrap);
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
  it('keeps the session when a cancel or delete raced the end of a reply', async () => {
    const h = harness(); await ready(h);
    h.socket.receive({ type: 'error', error: { code: 'response_cancel_not_active', message: 'x' } });
    h.socket.receive({ type: 'error', error: { code: 'item_not_found', message: 'x' } });
    expect(h.socket.close).not.toHaveBeenCalled(); expect(h.client.connectionState).toBe('ready'); await h.client.disconnect();
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
    await ready(h); await h.client.toggleMic();
    expect(h.opts.onError).toHaveBeenCalledWith(expect.stringContaining('Allow microphone'));
    expect(h.client.connectionState).toBe('ready'); await h.client.disconnect();
  });
  it('replays branch history after acknowledgement and before microphone audio', async () => {
    const item = { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_0', role: 'user', content: [] } };
    const h = harness({ seed: () => [item] }); await h.client.connect(); h.socket.open();
    expect(h.socket.sent).toHaveLength(1);
    h.socket.receive({ type: 'session.created' });
    expect(h.client.connectionState).toBe('connecting');
    expect(h.client.sendText('too early')).toBe(false);
    h.socket.receive({ type: 'conversation.item.added', item: item.item });
    await h.client.toggleMic(); h.chunk('pcm');
    expect(h.socket.sent.slice(1)).toEqual([item, { type: 'input_audio_buffer.append', audio: 'pcm' }]);
    await h.client.disconnect();
  });
  it('pins replay before async bootstrap and acknowledges each item once before allowing a retry', async () => {
    const user = { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_0', role: 'user', content: [{ type: 'input_text', text: 'Original opening' }] } };
    const assistant = { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_1', role: 'assistant', content: [{ type: 'text', text: 'Original reply' }] } };
    let seeds = [user, assistant];
    const h = harness({ seed: () => seeds });
    await h.client.connect(); seeds = []; h.socket.open(); h.socket.receive({ type: 'session.created' });
    expect(h.socket.sent.slice(1)).toEqual([user]); expect(h.client.sendText('not ready')).toBe(false);
    h.socket.receive({ type: 'conversation.item.added', item: user.item });
    expect(h.socket.sent.slice(1)).toEqual([user, assistant]);
    h.socket.receive({ type: 'conversation.item.added', item: user.item });
    h.socket.receive({ type: 'session.updated' });
    expect(h.client.connectionState).toBe('connecting');
    h.socket.receive({ type: 'conversation.item.added', item: assistant.item });
    expect(h.client.connectionState).toBe('ready');
    expect(h.pipeline.judge).not.toHaveBeenCalled(); expect(h.pipeline.speak).not.toHaveBeenCalled();
    expect(h.client.sendText('Replacement user line')).toBe(true);
    expect(h.socket.sent.filter(e => e.type === 'response.create')).toHaveLength(1);
    expect(h.socket.sent.some(e => e.type === 'conversation.item.delete')).toBe(false);
    await h.client.disconnect();
  });
  it('ends a session that never acknowledges replay rather than accepting input into partial history', async () => {
    vi.useFakeTimers();
    const h = harness({ seed: () => [{ type: 'conversation.item.create', item: { id: 'pwseed_0', role: 'user' } }] });
    await h.client.connect(); h.socket.open(); h.socket.receive({ type: 'session.created' });
    await vi.advanceTimersByTimeAsync(10001);
    expect(h.opts.onError).toHaveBeenCalledWith(expect.stringContaining('replay was not acknowledged'));
    expect(h.client.sendText('must not send')).toBe(false);
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
});
describe('Higgs adapter: one turn = Jev judgment + Higgs text draft + TTS', () => {
  it('speaks an ordinary turn: judges the recorded line, then voices the finished draft', async () => {
    const h = harness(); await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1', 'Nice to meet you.');
    await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalled());
    expect(h.pipeline.judge).toHaveBeenCalledWith('u1', expect.any(AbortSignal));
    expect(h.pipeline.speak).toHaveBeenCalledWith({ itemId: 'a1', text: 'Nice to meet you.', userItemId: 'u1' }, expect.any(AbortSignal));
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalled());
    // The transcript only learns of the reply when it is spoken, as one final line.
    expect(h.opts.onEvent).toHaveBeenCalledWith({ type: 'client.reply', item_id: 'a1', text: 'Nice to meet you.', previous_item_id: 'u1' });
    expect(vi.mocked(h.opts.onEvent).mock.calls.map(c => c[0].type)).not.toContain('response.output_text.delta');
    expect(h.socket.sent.some(e => e.type === 'response.cancel' || e.type === 'conversation.item.delete')).toBe(false);
    await h.client.disconnect();
  });
  it('does not show a reply before its voice starts', async () => {
    let release!: () => void;
    const h = harness(); h.pipeline.speak.mockImplementation(async () => (async function* () { await new Promise<void>(r => { release = r; }); yield new Uint8Array([1, 2]); })());
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1', 'Nice to meet you.');
    await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalled()); await settle();
    expect(vi.mocked(h.opts.onEvent).mock.calls.some(c => c[0].type === 'client.reply')).toBe(false);
    release(); await vi.waitFor(() => expect(h.opts.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'client.reply', item_id: 'a1' })));
    await h.client.disconnect();
  });
  it('waits for both the judgment and the draft before speaking', async () => {
    let judged!: (r: JudgeResult) => void;
    const h = harness(); h.pipeline.judge.mockImplementation(() => new Promise(r => { judged = r; }));
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1'); await settle();
    expect(h.pipeline.speak).not.toHaveBeenCalled();
    judged(ordinary); await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalled()); await h.client.disconnect();
  });
  it('keeps PCM16 samples whole when a network chunk splits one', async () => {
    const h = harness(); h.pipeline.speak.mockImplementation(async () => pcm([1, 2, 3], [4, 5, 6]));
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1');
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalledTimes(2));
    expect(h.player.enqueuePcm.mock.calls.map(c => [...new Uint8Array(c[0] as ArrayBuffer)])).toEqual([[1, 2], [3, 4, 5, 6]]);
    await h.client.disconnect();
  });
  it('on a major shift deletes the unheard draft, applies the post-appraisal instructions, and speaks the new draft', async () => {
    let judged!: (r: JudgeResult) => void;
    const h = harness(); h.pipeline.judge.mockImplementation(() => new Promise(r => { judged = r; }));
    await ready(h); said(h, 'u1', 'You are stupid, just kidding.'); draft(h, 'r1', 'a1', 'Haha, fair enough!', false);
    judged({ major: true, majorShift: 0.95, event: 'offensive_joke', stateVersion: 3, instructions: 'You are Alex. Hurt by the joke.' }); await settle();
    expect(h.socket.sent.at(-1)).toEqual({ type: 'response.cancel' });
    h.socket.receive({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
    expect(h.opts.onEvent).toHaveBeenCalledWith({ type: 'client.discarded', item_id: 'a1' });
    expect(h.socket.sent.slice(-2)).toEqual([{ type: 'conversation.item.delete', item_id: 'a1' },
      { type: 'session.update', session: { instructions: 'You are Alex. Hurt by the joke.' } }]);
    h.socket.receive({ type: 'session.updated', session: { instructions: 'You are Alex. Hurt by the joke.' } });
    expect(h.socket.sent.at(-1)).toEqual({ type: 'response.create' });
    expect(h.opts.onApplication).toHaveBeenCalledWith(3, 'acknowledged');
    draft(h, 'r2', 'a2', 'That was not funny.');
    await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalledTimes(1));
    expect(h.pipeline.speak).toHaveBeenCalledWith({ itemId: 'a2', text: 'That was not funny.', userItemId: 'u1', discardedDraft: 'Haha, fair enough!' }, expect.any(AbortSignal));
    // The discarded draft never reached the transcript; only the spoken reply did.
    const shown = vi.mocked(h.opts.onEvent).mock.calls.map(c => c[0]).filter(e => e.type === 'client.reply');
    await vi.waitFor(() => expect(vi.mocked(h.opts.onEvent).mock.calls.map(c => c[0]).filter(e => e.type === 'client.reply')).toHaveLength(1));
    expect(shown.every(e => e.item_id === 'a2')).toBe(true);
    await h.client.disconnect();
  });
  it('cancels the automatic draft when the major shift is known before Higgs starts it', async () => {
    const h = harness(); h.pipeline.judge.mockResolvedValue({ major: true, majorShift: 0.9, event: 'insult', stateVersion: 2, instructions: 'Hurt.' });
    await ready(h); expect(h.client.sendText('shut up')).toBe(true);
    h.socket.receive({ type: 'conversation.item.added', item: { id: 'u1', role: 'user' } }); await settle();
    draft(h, 'r1', 'a1', 'Sure!', false);
    expect(h.socket.sent.at(-1)).toEqual({ type: 'response.cancel' });
    h.socket.receive({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
    expect(h.socket.sent).toContainEqual({ type: 'conversation.item.delete', item_id: 'a1' });
    expect(h.pipeline.speak).not.toHaveBeenCalled(); await h.client.disconnect();
  });
  it('treats a failed judgment as an ordinary line and still speaks', async () => {
    const h = harness(); h.pipeline.judge.mockRejectedValue(new Error('jev down'));
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1');
    await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalled()); await h.client.disconnect();
  });
  it('speaks without judging when transcription failed', async () => {
    const h = harness(); await ready(h);
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    h.socket.receive({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'u1' });
    draft(h, 'r1', 'a1'); await vi.waitFor(() => expect(h.pipeline.speak).toHaveBeenCalled());
    expect(h.pipeline.judge).not.toHaveBeenCalled(); await h.client.disconnect();
  });
  it('barge-in stops the spoken reply and records how much was heard', async () => {
    let signal!: AbortSignal;
    const h = harness(); h.pipeline.speak.mockImplementation(async (_r, s) => { signal = s; return (async function* () { yield new Uint8Array([1, 2]); await new Promise(() => {}); })(); });
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1');
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalled());
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
    await vi.waitFor(() => expect(h.opts.onEvent).toHaveBeenCalledWith({ type: 'client.interrupted', item_id: 'a1', played_ms: 520 }));
    expect(signal.aborted).toBe(true); expect(h.player.flush).toHaveBeenCalled(); await h.client.disconnect();
  });
  it('deletes a finished draft that was never spoken when the user speaks again', async () => {
    const h = harness(); h.pipeline.judge.mockImplementation(() => new Promise(() => {}));
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1');
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
    expect(h.socket.sent).toContainEqual({ type: 'conversation.item.delete', item_id: 'a1' });
    expect(h.pipeline.speak).not.toHaveBeenCalled(); await h.client.disconnect();
  });
  it('deletes a still-generating draft abandoned by new speech once it ends', async () => {
    const h = harness(); h.pipeline.judge.mockImplementation(() => new Promise(() => {}));
    await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1', 'Half a', false);
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
    expect(h.socket.sent.some(e => e.type === 'response.cancel')).toBe(false);
    h.socket.receive({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
    expect(h.socket.sent).toContainEqual({ type: 'conversation.item.delete', item_id: 'a1' }); await h.client.disconnect();
  });
});
describe('Higgs adapter: instruction updates and timing', () => {
  it('defers updates until the turn is spoken and drained, and records only matching acknowledgements', async () => {
    const h = harness(); await ready(h); said(h, 'u1'); draft(h, 'r1', 'a1');
    h.client.queueInstructions(1, 'Warm but still Alex.');
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalled()); await settle();
    expect(h.socket.sent.some(e => e.session?.instructions === 'Warm but still Alex.')).toBe(false);
    h.drained(); expect(h.socket.sent.at(-1)).toMatchObject({ type: 'session.update', session: { instructions: 'Warm but still Alex.' } });
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Other instructions' } });
    expect(h.opts.onApplication).not.toHaveBeenCalledWith(1, 'acknowledged');
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Warm but still Alex.' } });
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'acknowledged');
    const count = h.socket.sent.length; h.client.queueInstructions(1, 'duplicate'); expect(h.socket.sent).toHaveLength(count);
    await h.client.disconnect();
  });
  it('does not resend instructions that are already active', async () => {
    const h = harness(); await ready(h);
    h.client.queueInstructions(2, 'Base.');
    expect(h.socket.sent).toHaveLength(1); expect(h.opts.onApplication).toHaveBeenCalledWith(2, 'acknowledged'); await h.client.disconnect();
  });
  it('does not update while the user speaks or while waiting for a reply', async () => {
    const h = harness(); await ready(h);
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' }); h.client.queueInstructions(1, 'Curious.');
    h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' }); expect(h.socket.sent).toHaveLength(1);
    await h.client.disconnect();
  });
  it('times out a guidance update without disrupting the voice connection', async () => {
    vi.useFakeTimers(); const h = harness(); await ready(h);
    h.client.queueInstructions(1, 'New guidance'); await vi.advanceTimersByTimeAsync(5001);
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'failed'); expect(h.client.connectionState).toBe('ready');
    const count = h.socket.sent.length; h.client.queueInstructions(2, 'Later guidance'); expect(h.socket.sent).toHaveLength(count);
    await h.client.disconnect();
  });
  it('coalesces queued state versions while keeping acknowledgements ordered', async () => {
    const h = harness(); await ready(h);
    h.client.queueInstructions(1, 'First'); h.client.queueInstructions(2, 'Second'); h.client.queueInstructions(3, 'Third');
    expect(h.socket.sent).toHaveLength(2);
    h.socket.receive({ type: 'session.updated', session: { instructions: 'First' } });
    expect(h.socket.sent.at(-1).session.instructions).toBe('Third');
    h.socket.receive({ type: 'session.updated', session: { instructions: 'Third' } });
    expect(h.opts.onApplication).toHaveBeenCalledWith(3, 'acknowledged');
    expect(h.socket.sent.some(e => e.session?.instructions === 'Second')).toBe(false); await h.client.disconnect();
  });
  it('cancels in-flight instruction application and ignores a late acknowledgement after disconnect', async () => {
    const h = harness(); await ready(h);
    h.client.queueInstructions(1, 'Warm'); const callback = h.socket.onmessage;
    await h.client.disconnect(); callback?.({ data: JSON.stringify({ type: 'session.updated', session: { instructions: 'Warm' } }) });
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'failed');
    expect(h.opts.onApplication).not.toHaveBeenCalledWith(1, 'acknowledged');
  });
  it('expires a queued turn-specific suggestion when a newer user turn begins', async () => {
    const h = harness(); await ready(h);
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    h.client.queueInstructions(1, 'Acknowledge the OLD apology now.', { triggerTurnId: 'u1', persistentInstructions: 'Maintain the unresolved boundary.' });
    said(h, 'u2'); draft(h, 'r2', 'a2');
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalled()); await settle(); h.drained();
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'session.update', session: { instructions: 'Maintain the unresolved boundary.' } });
    expect(JSON.stringify(h.socket.sent)).not.toContain('OLD apology');
    expect(h.opts.onApplication).toHaveBeenCalledWith(1, 'dispatched'); await h.client.disconnect();
  });
  it('measures event and playback timing with the monotonic clock and PCM position', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const h = harness(); await ready(h); await h.client.toggleMic();
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u1' }); h.chunk(Buffer.alloc(4800).toString('base64'));
    now.mockReturnValue(1500); h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1', audio_end_ms: 80 });
    now.mockReturnValue(1600); h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    now.mockReturnValue(1700); h.socket.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Hi.' });
    h.socket.receive({ type: 'response.output_item.added', response_id: 'r1', item: { id: 'a1', role: 'assistant' } });
    h.socket.receive({ type: 'response.output_text.done', response_id: 'r1', text: 'Hello.' });
    now.mockReturnValue(1800); h.socket.receive({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    await vi.waitFor(() => expect(h.player.enqueuePcm).toHaveBeenCalled());
    now.mockReturnValue(1830); h.playbackStarted();
    expect(h.opts.onLatency).toHaveBeenLastCalledWith({ turnId: 'u1', inputKind: 'audio', speechEndedAt: 980, speechStoppedAt: 1500,
      responseId: 'r1', responseCreatedAt: 1600, transcriptFinalAt: 1700, firstAudioAt: 1800, playbackStartedAt: 1830, appliedStateVersion: 0 });
    await h.client.disconnect();
  });
  it('attributes response latency to the echoed typed turn and ignores seed echoes', async () => {
    const h = harness(); await ready(h);
    expect(h.client.sendText('Hello')).toBe(true); expect(h.client.sendText('Duplicate click')).toBe(false);
    h.socket.receive({ type: 'conversation.item.added', item: { id: 'pwseed_0', role: 'user' } });
    expect(h.opts.onLatency).not.toHaveBeenCalled(); expect(h.pipeline.judge).not.toHaveBeenCalled();
    h.socket.receive({ type: 'conversation.item.added', item: { id: 'u1', role: 'user' } });
    h.socket.receive({ type: 'response.created', response: { id: 'r1' } });
    expect(h.opts.onLatency).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: 'u1', inputKind: 'text', responseId: 'r1', speechStoppedAt: expect.any(Number) }));
    expect(h.pipeline.judge).toHaveBeenCalledWith('u1', expect.any(AbortSignal)); await h.client.disconnect();
  });
  it('labels response attribution uncertain when a dispatched update overlaps new speech', async () => {
    const h = harness(); await ready(h);
    h.client.queueInstructions(1, 'Maintain a concern.');
    h.socket.receive({ type: 'input_audio_buffer.speech_started', item_id: 'u2' });
    h.socket.receive({ type: 'input_audio_buffer.speech_stopped', item_id: 'u2' });
    h.socket.receive({ type: 'response.created', response: { id: 'r2' } });
    expect(h.opts.onLatency).toHaveBeenLastCalledWith(expect.objectContaining({ turnId: 'u2', appliedStateVersion: 0, guidanceUncertain: true }));
    await h.client.disconnect();
  });
});
