import type { ProtocolEvent, SessionBootstrap } from '../../shared/domain';
import { RingPlayer } from '../audio/playback';
import { MicCapture } from '../audio/capture';
import { describeClose, inputAudioAppend, WS_URL } from './protocol';
import type { JudgeResult, LatencyRecord } from '../../shared/characterState';
import { SEED_PREFIX } from '../../shared/tree';
export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
export type Activity = 'idle' | 'listening' | 'thinking' | 'speaking';
export interface Player {
  resume(): Promise<void>; enqueuePcm(bytes: ArrayBuffer): void; reset(): void;
  flush(): Promise<number>; close(): Promise<void>;
}
export interface Microphone { active: boolean; start(): Promise<void>; stop(): Promise<void>; }
/**
 * The server side of each turn. `judge`: the decision model's verdict on a recorded user line (a major shift
 * returns new instructions, applied before the reply). `speak`: emotion choice + Higgs TTS 3, as PCM16 24 kHz.
 */
export interface TurnPipeline {
  judge(userItemId: string, signal: AbortSignal): Promise<JudgeResult>;
  speak(reply: { itemId: string; text: string; userItemId?: string; discardedDraft?: string }, signal: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}
export interface ClientOptions {
  bootstrap(signal: AbortSignal): Promise<SessionBootstrap>;
  onBootstrap(data: SessionBootstrap): void;
  onState(state: ConnectionState): void; onActivity(activity: Activity): void;
  onEvent(event: ProtocolEvent): void; onError(message: string): void;
  onMic(active: boolean): void; onLevel(level: number): void;
  pipeline: TurnPipeline;
  /** Longest wait for a judgment (a major shift includes the full appraisal) before replying as an ordinary turn. */
  judgeTimeoutMs?: number;
  /** History to replay after the session is acknowledged and before any microphone audio. */
  seed?: () => ProtocolEvent[];
  /** Asked once the session is ready: true when the character speaks first (an outgoing date with nothing said yet). */
  opens?: () => boolean;
  onApplication?: (version: number, status: 'acknowledged' | 'failed' | 'deferred' | 'dispatched') => void;
  onLatency?: (metric: LatencyRecord) => void;
  socketFactory?: (url: string, protocols: string[]) => WebSocket;
  playerFactory?: (drained: () => void, failure: (m: string) => void, started: () => void) => Player;
  micFactory?: (chunk: (b64: string) => void, level: (rms: number) => void) => Microphone;
}
/**
 * One user turn. Higgs (text mode) drafts a reply as soon as the turn ends while the decision model judges the
 * line in parallel. Ordinary → the draft is spoken. Major shift → the draft is cancelled and deleted unheard,
 * the session switches to the post-appraisal instructions, and Higgs drafts again before anything is spoken.
 */
interface UserTurn {
  epoch: number; userItemId?: string; verdict: 'pending' | 'ordinary' | 'major';
  stage: 'drafting' | 'cancelling' | 'updating' | 'redrafting' | 'speaking' | 'done';
  draft?: { responseId?: string; itemId?: string; text: string; done: boolean; cancelled: boolean };
  instructions?: string; stateVersion?: number; judge?: AbortController; judgeTimer?: ReturnType<typeof setTimeout>;
  /** The first draft deleted after a major shift, kept only for the server's turn log. */
  discardedDraft?: string;
}
/**
 * Drafts are not shown: the transcript only gets a reply when its voice starts (client.reply).
 * These events describe drafts, including ones that are later discarded, so they stay inside the client.
 */
const DRAFT_EVENTS: ReadonlySet<string> = new Set(['response.output_text.delta', 'response.output_text.done', 'response.output_item.added', 'response.output_item.done']);
export class HiggsClient {
  private replayItems: ProtocolEvent[] = []; private replayIndex = 0; private replayStarted = false;
  private sendReplayItem() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.options.onError('Conversation history replay was not acknowledged. Reconnect to try again.');
      void this.disconnect();
    }, 10000);
    this.send(this.replayItems[this.replayIndex]);
  }
  private gen = 0; private ws: WebSocket | null = null; private controller?: AbortController;
  private player?: Player; private mic?: Microphone; private timeout?: ReturnType<typeof setTimeout>;
  private state: ConnectionState = 'idle'; private generating = false; private queued = false;
  private hadSession = false;
  private closing?: Promise<void>;
  private pendingInstructions?: { version: number; instructions: string; persistentInstructions?: string; epoch?: number };
  private applying?: { version: number; instructions: string; timer: ReturnType<typeof setTimeout> };
  private appliedVersion = 0; private updateFailed = false; private userSpeaking = false; private awaitingResponse = false;
  private latestUserId?: string; private currentResponseId?: string; private typedAt?: number;
  private metrics = new Map<string, LatencyRecord>(); private responseTurns = new Map<string, string>();
  private inputMs = 0; private inputClock: { startMs: number; endMs: number; at: number }[] = [];
  private userEpoch = 0; private guidanceOverlap = false;
  private turn?: UserTurn;
  /** The reply being spoken through TTS; `ended` once its audio stream finished arriving. */
  private speaking?: { itemId: string; controller: AbortController; ended: boolean };
  /** Responses abandoned by an interruption; their items are deleted once they finish. */
  private orphanResponses = new Set<string>(); private responseItems = new Map<string, string>();
  /** The instructions Higgs is currently using. */
  private sessionInstructions?: string;
  constructor(private options: ClientOptions) {}
  get connectionState() { return this.state; }
  private setState(s: ConnectionState) { this.state = s; this.options.onState(s); }
  private send(event: ProtocolEvent) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(event));
  }
  private idleActivity(): Activity { return this.queued ? 'speaking' : this.generating || this.turn && this.turn.stage !== 'done' ? 'thinking' : this.mic?.active ? 'listening' : 'idle'; }
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'ready' || this.state === 'closing') return;
    const gen = ++this.gen; this.setState('connecting'); this.hadSession = false;
    this.generating = false; this.queued = false;
    this.appliedVersion = 0; this.updateFailed = false; this.userSpeaking = false; this.awaitingResponse = false;
    this.latestUserId = undefined; this.currentResponseId = undefined; this.typedAt = undefined; this.metrics.clear(); this.responseTurns.clear();
    this.inputMs = 0; this.inputClock = [];
    this.userEpoch = 0; this.guidanceOverlap = false; this.endTurn(); this.speaking = undefined;
    this.orphanResponses.clear(); this.responseItems.clear();
    this.replayItems = structuredClone(this.options.seed?.() ?? []); this.replayIndex = 0; this.replayStarted = false;
    this.controller = new AbortController();
    const alive = () => gen === this.gen;
    const drained = () => {
      if (!alive()) return;
      this.queued = false;
      if (this.speaking?.ended) this.speaking = undefined;
      this.options.onActivity(this.idleActivity()); this.applyWhenIdle();
    };
    const fail = (message: string) => { if (alive()) { this.options.onError(message); void this.disconnect(); } };
    const playbackStarted = () => {
      if (!alive()) return;
      const id = this.currentResponseId ? this.responseTurns.get(this.currentResponseId) : undefined;
      const metric = id ? this.metrics.get(id) : undefined;
      if (metric && metric.playbackStartedAt === undefined) { metric.playbackStartedAt = performance.now(); this.emitMetric(metric); }
    };
    const player = this.options.playerFactory?.(drained, fail, playbackStarted) ?? new RingPlayer(speaking => { if (!speaking) drained(); }, fail, playbackStarted);
    this.player = player;
    this.mic = this.options.micFactory?.(audio => this.appendAudio(audio), this.options.onLevel)
      ?? new MicCapture(audio => this.appendAudio(audio), this.options.onLevel);
    this.timeout = setTimeout(() => fail('Session initialization timed out. Check your network and try again.'), 25000);
    try {
      // Start playback initialization inside the Connect gesture, before network I/O.
      const audioReady = player.resume();
      await audioReady;
      if (!alive()) { await player.close(); return; }
      const data = await this.options.bootstrap(this.controller.signal);
      if (!alive()) return;
      this.hadSession = true; this.options.onBootstrap(data);
      const ws = this.options.socketFactory?.(WS_URL, ['realtime', `bai-client-secret.${data.credential.value}`])
        ?? new WebSocket(WS_URL, ['realtime', `bai-client-secret.${data.credential.value}`]);
      this.ws = ws;
      this.sessionInstructions = (data.config.session as { instructions?: string } | undefined)?.instructions;
      ws.onopen = () => { if (alive()) this.send(data.config); };
      ws.onmessage = ev => {
        if (!alive()) return;
        let event: ProtocolEvent;
        try { event = JSON.parse(String(ev.data)); } catch { return; }
        if (!event || typeof event.type !== 'string') return;
        try { this.handle(event); } catch { fail('Could not process a Boson event. Disconnect and try again.'); }
      };
      ws.onerror = () => { if (alive()) this.options.onError('WebSocket connection failed. Check network, account access, and the session status.'); };
      ws.onclose = ev => {
        if (!alive()) return;
        if (ev.code !== 1000) this.options.onError(describeClose(ev.code));
        this.options.onEvent({ type: 'client.session_end', message: describeClose(ev.code) });
        void this.disconnect();
      };
    } catch (error) {
      if (alive()) {
        this.options.onError(error instanceof Error ? error.message : 'Session initialization failed.');
        await this.disconnect();
      }
    }
  }
  private appendAudio(audio: string) {
    if (this.state !== 'ready') return;
    if ((this.ws?.bufferedAmount ?? 0) > 512000) {
      this.options.onError('The network cannot keep up with microphone audio. Reconnect on a stable connection.');
      void this.disconnect(); return;
    }
    const duration = (Math.floor(audio.length * 3 / 4) - (audio.endsWith('==') ? 2 : audio.endsWith('=') ? 1 : 0)) / 48;
    this.inputClock.push({ startMs: this.inputMs, endMs: this.inputMs + duration, at: performance.now() });
    this.inputMs += duration; if (this.inputClock.length > 300) this.inputClock.shift();
    this.send(inputAudioAppend(audio));
  }
  private handle(raw: ProtocolEvent) {
    if (raw.type === 'conversation.item.added') {
      const item = raw.item as { id?: string; role?: string } | undefined;
      if (item?.id?.startsWith(SEED_PREFIX)) {
        const expected = this.replayItems[this.replayIndex]?.item as { id?: string; role?: string } | undefined;
        if (this.state === 'connecting' && this.replayStarted && item.id === expected?.id && item.role === expected.role) {
          this.replayIndex++;
          if (this.replayIndex < this.replayItems.length) this.sendReplayItem();
          else { clearTimeout(this.timeout); this.historyReady(); }
        }
        // Replay echoes are history, never new user turns or candidate replies.
        return;
      }
    }
    // Text mode's final event has no item_id; attribute it to the draft so the transcript can use it.
    const event = raw.type === 'response.output_text.done' && typeof raw.item_id !== 'string' && this.turn?.draft?.itemId
      ? { ...raw, item_id: this.turn.draft.itemId } : raw;
    const assistantItem = event.type === 'conversation.item.added' && (event.item as { role?: string } | undefined)?.role === 'assistant';
    if (!DRAFT_EVENTS.has(event.type) && !assistantItem) this.options.onEvent(event);
    const t = this.turn;
    switch (event.type) {
      case 'session.created': case 'session.updated':
        if (this.state === 'connecting') {
          if (this.replayStarted) break;
          this.replayStarted = true;
          if (this.replayItems.length) this.sendReplayItem();
          else { clearTimeout(this.timeout); this.historyReady(); }
        } else if (event.type === 'session.updated' && t?.stage === 'updating') {
          // The post-appraisal instructions are now active: ask Higgs to draft again.
          this.sessionInstructions = t.instructions;
          if (t.stateVersion !== undefined && t.stateVersion > this.appliedVersion) {
            this.appliedVersion = t.stateVersion; this.options.onApplication?.(t.stateVersion, 'acknowledged');
          }
          t.stage = 'redrafting'; this.awaitingResponse = true; this.send({ type: 'response.create' });
        } else if (event.type === 'session.updated' && this.applying) {
          const instructions = (event.session as { instructions?: string } | undefined)?.instructions;
          if (instructions === this.applying.instructions) {
            clearTimeout(this.applying.timer); this.appliedVersion = this.applying.version; this.sessionInstructions = instructions;
            this.options.onApplication?.(this.applying.version, 'acknowledged'); this.applying = undefined; this.applyWhenIdle();
          }
        }
        break;
      case 'response.created': {
        this.generating = true; this.awaitingResponse = false; this.options.onActivity('thinking');
        const response = event.response as { id?: string } | undefined; this.currentResponseId = response?.id;
        if (t && t.stage !== 'speaking' && t.stage !== 'done' && t.stage !== 'updating') {
          t.draft = { responseId: response?.id, text: '', done: false, cancelled: false };
          // A major shift arrived before the automatic draft started: stop it now.
          if (t.stage === 'cancelling') this.send({ type: 'response.cancel' });
        }
        if (response?.id && this.latestUserId) {
          this.responseTurns.set(response.id, this.latestUserId);
          const metric = this.metric(this.latestUserId); metric.responseId = response.id;
          metric.responseCreatedAt = performance.now(); metric.appliedStateVersion = this.appliedVersion; this.emitMetric(metric);
          if (this.applying || this.guidanceOverlap) { metric.guidanceUncertain = true; this.emitMetric(metric); }
        }
        break;
      }
      case 'response.output_item.added': {
        const item = event.item as { id?: string; role?: string } | undefined;
        const responseId = typeof event.response_id === 'string' ? event.response_id : this.currentResponseId;
        if (item?.role === 'assistant' && item.id) {
          if (responseId) this.responseItems.set(responseId, item.id);
          if (t?.draft && !t.draft.itemId && (!t.draft.responseId || t.draft.responseId === responseId)) t.draft.itemId = item.id;
        }
        break;
      }
      case 'response.output_text.delta':
        if (t?.draft && typeof event.delta === 'string' && (!t.draft.itemId || event.item_id === t.draft.itemId)) t.draft.text += event.delta;
        break;
      case 'response.output_text.done':
        if (t?.draft && typeof event.text === 'string' && event.item_id === t.draft.itemId) t.draft.text = event.text;
        break;
      case 'response.done': {
        const response = event.response as { id?: string; status?: string } | undefined;
        if (response?.id && this.orphanResponses.delete(response.id)) {
          const item = this.responseItems.get(response.id); if (item) this.discard(item);
        }
        if (!response?.id || response.id === this.currentResponseId) {
          this.generating = false;
          if (t?.draft && (!t.draft.responseId || t.draft.responseId === response?.id)) {
            t.draft.done = true; if (response?.status === 'cancelled' && t.stage !== 'cancelling') t.draft.cancelled = true;
          }
          this.advance(); this.options.onActivity(this.idleActivity()); this.applyWhenIdle();
        }
        break;
      }
      case 'input_audio_buffer.speech_started':
        this.newUserTurn(typeof event.item_id === 'string' ? event.item_id : undefined);
        this.userSpeaking = true; this.options.onActivity('listening'); break;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false; this.awaitingResponse = true; this.options.onActivity('thinking');
        if (typeof event.item_id === 'string') {
          const metric = this.metric(event.item_id); metric.inputKind = 'audio'; metric.speechStoppedAt = performance.now();
          if (typeof event.audio_end_ms === 'number') {
            const endMs = event.audio_end_ms;
            const segment = this.inputClock.find(s => endMs >= s.startMs && endMs <= s.endMs);
            if (segment) metric.speechEndedAt = segment.at - (segment.endMs - endMs);
          }
          this.emitMetric(metric);
        }
        break;
      case 'conversation.item.added': {
        // The echo of a typed turn carries its item id; the send time stands in for the end of speech.
        const item = event.item as { id?: string; role?: string } | undefined;
        if (this.typedAt !== undefined && item?.role === 'user' && item.id && !item.id.startsWith(SEED_PREFIX)) {
          this.latestUserId = item.id; const metric = this.metric(item.id);
          metric.inputKind = 'text'; metric.speechStoppedAt = this.typedAt; this.typedAt = undefined; this.emitMetric(metric);
          if (t && !t.userItemId) { t.userItemId = item.id; this.startJudge(t); }
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.item_id === 'string') { const metric = this.metric(event.item_id); metric.transcriptFinalAt = performance.now(); this.emitMetric(metric); }
        if (t && event.item_id === t.userItemId) {
          if (typeof event.transcript === 'string' && event.transcript.trim()) this.startJudge(t); else this.settle(t, { major: false });
        }
        break;
      case 'conversation.item.input_audio_transcription.failed':
        if (t && event.item_id === t.userItemId) this.settle(t, { major: false });
        break;
      case 'session.idle_timeout': case 'session.max_duration_reached':
        this.options.onError(event.type === 'session.idle_timeout' ? 'Session ended after inactivity. Connect again to start fresh.' : 'Boson session duration limit reached. Connect again to start fresh.');
        void this.disconnect(); break;
      case 'error': {
        // A cancel or delete that raced the end of a reply is harmless; anything else ends the session.
        const code = (event.error as { code?: unknown } | undefined)?.code;
        if (typeof code === 'string' && /cancel|not_active|no_active|not_found/i.test(code)) break;
        // Upstream error bodies may echo configuration or credentials. Never forward raw bodies.
        this.options.onError('Boson reported a session error. Check credentials, account credit, and the configured model/voice.');
        void this.disconnect(); break;
      }
    }
  }
  private startJudge(t: UserTurn) {
    if (t.judge || t.verdict !== 'pending' || !t.userItemId) return;
    const controller = new AbortController(); t.judge = controller; const gen = this.gen;
    t.judgeTimer = setTimeout(() => controller.abort(), this.options.judgeTimeoutMs ?? 12000);
    this.options.pipeline.judge(t.userItemId, controller.signal).then(result => {
      if (gen === this.gen && this.turn === t) this.settle(t, result);
    }, () => { if (gen === this.gen && this.turn === t) this.settle(t, { major: false }); });
  }
  private settle(t: UserTurn, result: Partial<JudgeResult> & { major: boolean }) {
    if (t.verdict !== 'pending') return;
    clearTimeout(t.judgeTimer);
    if (result.major && result.instructions) {
      t.verdict = 'major'; t.instructions = result.instructions; t.stateVersion = result.stateVersion; t.stage = 'cancelling';
      // Stop the draft written before the appraisal; it is deleted unheard once it ends.
      if (this.generating && t.draft && !t.draft.done) this.send({ type: 'response.cancel' });
    } else t.verdict = 'ordinary';
    this.advance();
  }
  /** Moves the current turn forward once the judgment and the draft it needs are both in. */
  private advance() {
    const t = this.turn; if (!t || t.verdict === 'pending') return;
    if (t.stage === 'cancelling') {
      if (this.generating || this.awaitingResponse && !t.draft) return;
      if (t.draft?.itemId) { this.discard(t.draft.itemId); t.discardedDraft = t.draft.text; }
      t.draft = undefined; t.stage = 'updating'; this.awaitingResponse = true; this.options.onActivity('thinking');
      this.send({ type: 'session.update', session: { instructions: t.instructions } });
      return;
    }
    if ((t.stage === 'drafting' || t.stage === 'redrafting') && t.draft?.done) {
      if (t.draft.cancelled || !t.draft.itemId || !t.draft.text.trim()) { this.endTurn(); return; }
      void this.speak(t, t.draft.itemId, t.draft.text);
    }
  }
  private async speak(t: UserTurn, itemId: string, text: string) {
    t.stage = 'speaking';
    const controller = new AbortController(); const speaking = { itemId, controller, ended: false }; this.speaking = speaking;
    const gen = this.gen; const player = this.player;
    player?.reset();
    // The line enters the transcript when her voice starts, never before.
    let shown = false;
    const show = () => { if (!shown && gen === this.gen) { shown = true; this.options.onEvent({ type: 'client.reply', item_id: itemId, text, ...(t.userItemId && { previous_item_id: t.userItemId }) }); } };
    try {
      const stream = await this.options.pipeline.speak({ itemId, text, ...(t.userItemId && { userItemId: t.userItemId }),
        ...(t.discardedDraft !== undefined && { discardedDraft: t.discardedDraft }) }, controller.signal);
      let carry: Uint8Array | undefined;
      for await (const chunk of stream) {
        if (gen !== this.gen || controller.signal.aborted) break;
        let bytes = carry ? concat(carry, chunk) : chunk; carry = undefined;
        // PCM16 samples are 2 bytes; a network chunk can split one.
        if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.slice(0, -1); }
        if (!bytes.length) continue;
        if (!this.queued) {
          const metric = this.latestUserId ? this.metrics.get(this.latestUserId) : undefined;
          if (metric && metric.firstAudioAt === undefined) { metric.firstAudioAt = performance.now(); this.emitMetric(metric); }
        }
        this.queued = true; this.options.onActivity('speaking'); show();
        player?.enqueuePcm(bytes.slice().buffer);
      }
    } catch {
      if (gen === this.gen && !controller.signal.aborted) {
        this.options.onError('The reply could not be spoken. Check the server log for the text-to-speech error.');
        show(); // still show what she meant to say, alongside the error
      }
    } finally {
      speaking.ended = true;
      if (this.speaking === speaking && !this.queued) this.speaking = undefined;
      if (this.turn === t) this.endTurn();
      if (gen === this.gen) { this.options.onActivity(this.idleActivity()); this.applyWhenIdle(); }
    }
  }
  /** Her opening line before anyone has spoken: drafted and voiced like a reply, with no user line to judge. */
  private historyReady() {
    const opens = this.options.opens?.();
    this.setState('ready');
    if (opens && !this.awaitingResponse && !this.turn) this.open();
  }
  private open() {
    this.userEpoch++;
    this.turn = { epoch: this.userEpoch, verdict: 'ordinary', stage: 'drafting' };
    this.awaitingResponse = true; this.send({ type: 'response.create' }); this.options.onActivity('thinking');
  }
  /** A reply nobody heard must not stay in Higgs's history. */
  private discard(itemId: string) {
    this.options.onEvent({ type: 'client.discarded', item_id: itemId });
    this.send({ type: 'conversation.item.delete', item_id: itemId });
  }
  private endTurn() {
    const t = this.turn; if (!t) return;
    clearTimeout(t.judgeTimer); t.stage = 'done'; this.turn = undefined;
  }
  /** A new user line: stop what is being said, abandon the previous turn's unspoken draft, start fresh. */
  private newUserTurn(userItemId?: string) {
    const previous = this.turn;
    if (previous) {
      previous.judge?.abort();
      if (previous.draft && previous.stage !== 'speaking') {
        if (!previous.draft.done && previous.draft.responseId) {
          // Speech already makes Higgs cancel the reply in flight; a typed line has to ask.
          this.orphanResponses.add(previous.draft.responseId); if (!userItemId && this.generating) this.send({ type: 'response.cancel' });
        } else if (previous.draft.itemId && !previous.draft.cancelled) this.discard(previous.draft.itemId);
      }
      this.endTurn();
    }
    void this.interrupt();
    this.userEpoch++; this.guidanceOverlap = Boolean(this.applying);
    if (this.pendingInstructions?.persistentInstructions) this.pendingInstructions.instructions = this.pendingInstructions.persistentInstructions;
    if (userItemId) this.latestUserId = userItemId;
    this.turn = { epoch: this.userEpoch, ...(userItemId && { userItemId }), verdict: 'pending', stage: 'drafting' };
  }
  /** Barge-in: cut the spoken reply and record how much was heard. */
  private async interrupt() {
    const speaking = this.speaking; const player = this.player; if (!speaking) return;
    this.speaking = undefined; speaking.controller.abort();
    this.options.onEvent({ type: 'client.interrupted', item_id: speaking.itemId, played_ms: 0 });
    const gen = this.gen; const played = player ? await player.flush() : 0;
    if (gen !== this.gen) return;
    this.queued = false;
    // Text mode has no audio truncation; Higgs keeps the full reply text even though only part was heard.
    this.options.onEvent({ type: 'client.interrupted', item_id: speaking.itemId, played_ms: played });
  }
  private metric(id: string): LatencyRecord {
    let metric = this.metrics.get(id);
    if (!metric) { metric = { turnId: id, appliedStateVersion: this.appliedVersion }; this.metrics.set(id, metric); }
    return metric;
  }
  private emitMetric(metric: LatencyRecord) { this.options.onLatency?.({ ...metric }); }
  private busy() { return this.generating || this.queued || Boolean(this.speaking) || this.userSpeaking || this.awaitingResponse || Boolean(this.turn); }
  /** Ordinary instruction updates wait for a quiet moment. Latest state wins. */
  queueInstructions(version: number, instructions: string, context?: { persistentInstructions: string; triggerTurnId?: string }) {
    if (this.state !== 'ready' || this.updateFailed || version <= this.appliedVersion ||
      version <= (this.pendingInstructions?.version ?? 0) || version <= (this.applying?.version ?? 0)) return;
    const current = context?.triggerTurnId === this.latestUserId && this.typedAt === undefined && !this.userSpeaking;
    this.pendingInstructions = { version, instructions: context && !current ? context.persistentInstructions : instructions,
      persistentInstructions: context?.persistentInstructions, epoch: this.userEpoch };
    if (this.busy() || this.applying) this.options.onApplication?.(version, 'deferred');
    this.applyWhenIdle();
  }
  private applyWhenIdle() {
    if (this.state !== 'ready' || this.busy() || this.applying || !this.pendingInstructions || this.updateFailed) return;
    const update = this.pendingInstructions; this.pendingInstructions = undefined;
    if (update.epoch !== this.userEpoch && update.persistentInstructions) update.instructions = update.persistentInstructions;
    // Already active (e.g. applied by a major shift, or only the numbers moved within a band): nothing to send.
    if (update.instructions === this.sessionInstructions) {
      this.appliedVersion = update.version; this.options.onApplication?.(update.version, 'acknowledged'); return;
    }
    this.applying = { ...update, timer: setTimeout(() => {
      this.options.onApplication?.(update.version, 'failed'); this.applying = undefined; this.updateFailed = true;
    }, 5000) };
    this.options.onApplication?.(update.version, 'dispatched');
    this.send({ type: 'session.update', event_id: `state-${this.gen}-${update.version}`, session: { instructions: update.instructions } });
  }
  /** A typed turn, only while the microphone is off. Like speaking over the character, it interrupts the reply being spoken. */
  sendText(text: string): boolean {
    if (this.state !== 'ready' || this.mic?.active || this.awaitingResponse || !text.trim()) return false;
    this.newUserTurn();
    this.awaitingResponse = true; this.typedAt = performance.now();
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: text.trim() }] } });
    this.send({ type: 'response.create' });
    this.options.onActivity('thinking');
    return true;
  }
  async toggleMic(): Promise<void> {
    if (this.state !== 'ready' || !this.mic) return;
    const gen = this.gen; const mic = this.mic;
    try {
      if (mic.active) await mic.stop(); else await mic.start();
      if (gen === this.gen) { this.options.onMic(mic.active); this.options.onActivity(this.idleActivity()); }
    } catch {
      if (gen === this.gen) this.options.onError('Microphone could not start. Allow microphone access and check your input device.');
    }
  }
  async disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    ++this.gen; clearTimeout(this.timeout); this.controller?.abort();
    if (this.applying) { clearTimeout(this.applying.timer); this.options.onApplication?.(this.applying.version, 'failed'); }
    this.applying = undefined; this.pendingInstructions = undefined;
    this.turn?.judge?.abort(); this.endTurn();
    this.setState('closing');
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; if (ws.readyState < 2) ws.close(1000, 'client disconnect'); }
    const player = this.player; const mic = this.mic; this.player = undefined; this.mic = undefined;
    const speaking = this.speaking; this.speaking = undefined; speaking?.controller.abort();
    const hadSession = this.hadSession; this.hadSession = false;
    const flush = speaking && player ? player.flush() : Promise.resolve(0);
    this.queued = false; this.generating = false;
    this.options.onMic(false); this.options.onLevel(0); this.options.onActivity('idle');
    this.closing = (async () => {
      const stopMic = mic?.stop();
      // A suspended device must not prevent disconnecting forever.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const played = await Promise.race([flush.catch(() => 0), new Promise<number>(r => { timer = setTimeout(() => r(0), 250); })]);
      clearTimeout(timer);
      if (hadSession) {
        if (speaking) this.options.onEvent({ type: 'client.interrupted', item_id: speaking.itemId, played_ms: played });
        this.options.onEvent({ type: 'client.closed' });
      }
      await Promise.allSettled([stopMic, player?.close()]);
      this.setState('closed'); this.closing = undefined;
    })();
    return this.closing;
  }
}
function concat(a: Uint8Array, b: Uint8Array) { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
