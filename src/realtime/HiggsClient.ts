import type { ProtocolEvent, SessionBootstrap } from '../../shared/domain';
import { RingPlayer } from '../audio/playback';
import { MicCapture } from '../audio/capture';
import { describeClose, inputAudioAppend, truncateItem, WS_URL } from './protocol';
import type { LatencyRecord } from '../../shared/characterState';
import { SEED_PREFIX } from '../../shared/tree';
import { DirectedText } from './DirectedText';
import type { ResponsePlan } from '../../shared/behavior';
export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
export type Activity = 'idle' | 'listening' | 'thinking' | 'speaking';
export interface Player {
  resume(): Promise<void>; enqueueBase64(b64: string): void; reset(): void;
  flush(): Promise<number>; close(): Promise<void>;
}
export interface Microphone { active: boolean; start(): Promise<void>; stop(): Promise<void>; }
export interface ClientOptions {
  bootstrap(signal: AbortSignal): Promise<SessionBootstrap>;
  onBootstrap(data: SessionBootstrap): void;
  onState(state: ConnectionState): void; onActivity(activity: Activity): void;
  onEvent(event: ProtocolEvent): void; onError(message: string): void;
  onMic(active: boolean): void; onLevel(level: number): void;
  /** History to replay after the session is acknowledged and before any microphone audio. */
  seed?: () => ProtocolEvent[];
  onApplication?: (version: number, status: 'acknowledged' | 'failed' | 'deferred' | 'dispatched') => void;
  onLatency?: (metric: LatencyRecord) => void;
  prepareTypedResponse?: (turnId: string, signal: AbortSignal) => Promise<ResponsePlan>;
  recordResponsePlan?: (plan: ResponsePlan, status: ResponsePlan['status'], responseId?: string) => Promise<void>;
  onTypedBusy?: (busy: boolean) => void;
  socketFactory?: (url: string, protocols: string[]) => WebSocket;
  playerFactory?: (drained: () => void, failure: (m: string) => void, started: () => void) => Player;
  micFactory?: (chunk: (b64: string) => void, level: (rms: number) => void) => Microphone;
}
export class HiggsClient {
  private gen = 0; private ws: WebSocket | null = null; private controller?: AbortController;
  private player?: Player; private mic?: Microphone; private timeout?: ReturnType<typeof setTimeout>;
  private state: ConnectionState = 'idle'; private currentItem?: string;
  private blocked = new Set<string>(); private generating = false; private queued = false;
  private hadSession = false;
  private closing?: Promise<void>;
  private pendingInstructions?: { version: number; instructions: string; persistentInstructions?: string; epoch?: number };
  private applying?: { version: number; instructions: string; timer: ReturnType<typeof setTimeout> };
  private appliedVersion = 0; private updateFailed = false; private userSpeaking = false; private awaitingResponse = false;
  private latestUserId?: string; private currentResponseId?: string; private typedAt?: number;
  private metrics = new Map<string, LatencyRecord>(); private responseTurns = new Map<string, string>();
  private inputMs = 0; private inputClock: { startMs: number; endMs: number; at: number }[] = [];
  private userEpoch = 0; private guidanceOverlap = false;
  private directed: DirectedText; private typedOrdinal = 0;
  constructor(private options: ClientOptions) {
    this.directed = new DirectedText({ send: e => this.send(e),
      prepare: (id, signal) => options.prepareTypedResponse ? options.prepareTypedResponse(id, signal) : Promise.reject(new Error('Directed setup unavailable.')),
      record: (plan, status, responseId) => options.recordResponsePlan ? options.recordResponsePlan(plan, status, responseId) : Promise.reject(new Error('Directed recording unavailable.')),
      acknowledged: version => { this.appliedVersion = version;
        if ((this.pendingInstructions?.version ?? Infinity) <= version) this.pendingInstructions = undefined;
        options.onApplication?.(version, 'acknowledged'); },
      busy: value => options.onTypedBusy?.(value), notice: message => options.onError(message),
      failure: message => { options.onError(message); void this.disconnect(); } });
  }
  get connectionState() { return this.state; }
  private setState(s: ConnectionState) { this.state = s; this.options.onState(s); }
  private send(event: ProtocolEvent) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(event));
  }
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'ready' || this.state === 'closing') return;
    const gen = ++this.gen; this.setState('connecting'); this.blocked.clear(); this.hadSession = false;
    this.currentItem = undefined; this.generating = false; this.queued = false;
    this.appliedVersion = 0; this.updateFailed = false; this.userSpeaking = false; this.awaitingResponse = false;
    this.latestUserId = undefined; this.currentResponseId = undefined; this.typedAt = undefined; this.metrics.clear(); this.responseTurns.clear();
    this.inputMs = 0; this.inputClock = [];
    this.userEpoch = 0; this.guidanceOverlap = false;
    this.directed.close(); this.directed.enabled = false; this.typedOrdinal = 0;
    this.controller = new AbortController();
    const alive = () => gen === this.gen;
    const drained = () => { if (alive()) { this.queued = false; this.options.onActivity(this.generating ? 'thinking' : this.mic?.active ? 'listening' : 'idle'); this.applyWhenIdle(); } };
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
      this.directed.enabled = data.session.adaptation?.controlledText ?? false;
      const ws = this.options.socketFactory?.(WS_URL, ['realtime', `bai-client-secret.${data.credential.value}`])
        ?? new WebSocket(WS_URL, ['realtime', `bai-client-secret.${data.credential.value}`]);
      this.ws = ws;
      ws.onopen = () => { if (alive()) this.send(data.config); };
      ws.onmessage = ev => {
        if (!alive()) return;
        let event: ProtocolEvent;
        try { event = JSON.parse(String(ev.data)); } catch { return; }
        if (!event || typeof event.type !== 'string') return;
        try { this.handle(event, gen); } catch { fail('Could not process Boson audio. Disconnect and try again.'); }
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
  private handle(event: ProtocolEvent, gen: number) {
    if (!this.directed.accept(event)) return;
    this.options.onEvent(event);
    this.directed.observe(event);
    switch (event.type) {
      case 'session.created': case 'session.updated':
        if (this.state === 'connecting') {
          clearTimeout(this.timeout);
          for (const item of this.options.seed?.() ?? []) this.send(item);
          this.setState('ready');
        } else if (event.type === 'session.updated' && this.applying) {
          const instructions = (event.session as { instructions?: string } | undefined)?.instructions;
          if (instructions === this.applying.instructions) {
            clearTimeout(this.applying.timer); this.appliedVersion = this.applying.version;
            this.options.onApplication?.(this.applying.version, 'acknowledged'); this.applying = undefined; this.applyWhenIdle();
          }
        }
        break;
      case 'response.created': {
        this.generating = true; this.awaitingResponse = false; this.options.onActivity('thinking');
        const response = event.response as { id?: string } | undefined; this.currentResponseId = response?.id;
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
        if (item?.role === 'assistant' && item.id) this.currentItem = item.id; break;
      }
      case 'response.output_audio.delta': {
        const id = typeof event.item_id === 'string' ? event.item_id : this.currentItem;
        if (!id || this.blocked.has(id) || typeof event.delta !== 'string' || !event.delta) break;
        const responseId = typeof event.response_id === 'string' ? event.response_id : this.currentResponseId;
        const turnId = responseId ? this.responseTurns.get(responseId) : undefined;
        const metric = turnId ? this.metrics.get(turnId) : undefined;
        if (metric && metric.firstAudioAt === undefined) { metric.firstAudioAt = performance.now(); this.emitMetric(metric); }
        // Each item gets a fresh playback counter, even if output_item.added preceded audio.
        if (this.playbackItem !== id) { this.player?.reset(); this.playbackItem = id; }
        this.currentItem = id; this.queued = true;
        this.player?.enqueueBase64(event.delta); this.options.onActivity('speaking'); break;
      }
      case 'response.done':
        if (!(event.response as { id?: string } | undefined)?.id || (event.response as { id?: string }).id === this.currentResponseId) {
          this.generating = false; if (!this.queued) this.options.onActivity(this.mic?.active ? 'listening' : 'idle'); this.applyWhenIdle();
        } break;
      case 'input_audio_buffer.speech_started':
        this.newUserTurn();
        this.userSpeaking = true;
        if (typeof event.item_id === 'string') this.latestUserId = event.item_id;
        void this.bargeIn(gen); this.options.onActivity('listening'); break;
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
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.item_id === 'string') { const metric = this.metric(event.item_id); metric.transcriptFinalAt = performance.now(); this.emitMetric(metric); }
        break;
      case 'session.idle_timeout': case 'session.max_duration_reached':
        this.options.onError(event.type === 'session.idle_timeout' ? 'Session ended after inactivity. Connect again to start fresh.' : 'Boson session duration limit reached. Connect again to start fresh.');
        void this.disconnect(); break;
      case 'error':
        // Upstream error bodies may echo configuration or credentials. Never forward raw bodies.
        this.options.onError('Boson reported a session error. Check credentials, account credit, and the configured model/voice.');
        void this.disconnect(); break;
    }
  }
  private metric(id: string): LatencyRecord {
    let metric = this.metrics.get(id);
    if (!metric) { metric = { turnId: id, appliedStateVersion: this.appliedVersion }; this.metrics.set(id, metric); }
    return metric;
  }
  private emitMetric(metric: LatencyRecord) { this.options.onLatency?.({ ...metric }); }
  /** Async mode never suppresses VAD or requests an extra response. Latest state wins. */
  queueInstructions(version: number, instructions: string, context?: { persistentInstructions: string; triggerTurnId?: string }) {
    if (this.state !== 'ready' || this.updateFailed || version <= this.appliedVersion ||
      version <= (this.pendingInstructions?.version ?? 0) || version <= (this.applying?.version ?? 0)) return;
    const current = context?.triggerTurnId === this.latestUserId && this.typedAt === undefined && !this.userSpeaking;
    this.pendingInstructions = { version, instructions: context && !current ? context.persistentInstructions : instructions,
      persistentInstructions: context?.persistentInstructions, epoch: this.userEpoch };
    if (this.generating || this.queued || this.userSpeaking || this.awaitingResponse || this.applying) this.options.onApplication?.(version, 'deferred');
    this.applyWhenIdle();
  }
  private applyWhenIdle() {
    if (this.directed.busy) { if (!this.generating && !this.queued) this.directed.idle(); return; }
    if (this.state !== 'ready' || this.generating || this.queued || this.userSpeaking || this.awaitingResponse || this.applying || !this.pendingInstructions || this.updateFailed) return;
    const update = this.pendingInstructions; this.pendingInstructions = undefined;
    if (update.epoch !== this.userEpoch && update.persistentInstructions) update.instructions = update.persistentInstructions;
    this.applying = { ...update, timer: setTimeout(() => {
      this.options.onApplication?.(update.version, 'failed'); this.applying = undefined; this.updateFailed = true;
    }, 5000) };
    this.options.onApplication?.(update.version, 'dispatched');
    this.send({ type: 'session.update', event_id: `state-${this.gen}-${update.version}`, session: { instructions: update.instructions } });
  }
  private newUserTurn() {
    this.userEpoch++; this.guidanceOverlap = Boolean(this.applying);
    if (this.pendingInstructions?.persistentInstructions) this.pendingInstructions.instructions = this.pendingInstructions.persistentInstructions;
  }
  private playbackItem?: string;
  private async bargeIn(gen: number) {
    const id = this.currentItem; const player = this.player;
    if (!id || !player || (!this.queued && !this.generating)) return;
    this.blocked.add(id); this.queued = false;
    this.options.onEvent({ type: 'client.interrupted', item_id: id, played_ms: 0 });
    const played = this.playbackItem === id ? await player.flush() : (await player.flush(), 0);
    if (gen !== this.gen) return;
    this.options.onEvent({ type: 'client.interrupted', item_id: id, played_ms: played });
    this.send(truncateItem(id, played));
  }
  /** A typed turn, only while the microphone is off. Like speaking over the character, it interrupts any reply still playing. */
  sendText(text: string): boolean {
    if (this.state !== 'ready' || this.mic?.active || this.awaitingResponse || !text.trim()) return false;
    if (this.directed.enabled && (this.directed.busy || this.generating || this.queued || this.applying)) return false;
    this.newUserTurn();
    void this.bargeIn(this.gen);
    this.awaitingResponse = true; this.typedAt = performance.now();
    const id = this.directed.enabled ? `pwuser_${this.gen}_${++this.typedOrdinal}` : undefined;
    if (id) this.directed.begin(id);
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', ...(id && { id }), content: [{ type: 'input_text', text: text.trim() }] } });
    if (!this.directed.enabled) this.send({ type: 'response.create' });
    this.options.onActivity('thinking');
    return true;
  }
  async toggleMic(): Promise<void> {
    if (this.state !== 'ready' || !this.mic) return;
    if (this.directed.enabled) { this.options.onError('Directed mode is a typed experiment. Start an Adaptive or Static session to use the microphone.'); return; }
    const gen = this.gen; const mic = this.mic;
    try {
      if (mic.active) await mic.stop(); else await mic.start();
      if (gen === this.gen) { this.options.onMic(mic.active); this.options.onActivity(this.queued ? 'speaking' : this.generating ? 'thinking' : mic.active ? 'listening' : 'idle'); }
    } catch {
      if (gen === this.gen) this.options.onError('Microphone could not start. Allow microphone access and check your input device.');
    }
  }
  async disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    ++this.gen; clearTimeout(this.timeout); this.controller?.abort();
    this.directed.close();
    if (this.applying) { clearTimeout(this.applying.timer); this.options.onApplication?.(this.applying.version, 'failed'); }
    this.applying = undefined; this.pendingInstructions = undefined;
    this.setState('closing');
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; if (ws.readyState < 2) ws.close(1000, 'client disconnect'); }
    const player = this.player; const mic = this.mic; this.player = undefined; this.mic = undefined;
    const interrupted = this.currentItem && (this.queued || this.generating) ? this.currentItem : undefined;
    const hadSession = this.hadSession; this.hadSession = false;
    const flush = interrupted && player ? player.flush() : Promise.resolve(0);
    this.queued = false; this.generating = false; this.currentItem = undefined; this.playbackItem = undefined;
    this.options.onMic(false); this.options.onLevel(0); this.options.onActivity('idle');
    this.closing = (async () => {
      const stopMic = mic?.stop();
      // A suspended device must not prevent disconnecting forever.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const played = await Promise.race([flush.catch(() => 0), new Promise<number>(r => { timer = setTimeout(() => r(0), 250); })]);
      clearTimeout(timer);
      if (hadSession) {
        if (interrupted) this.options.onEvent({ type: 'client.interrupted', item_id: interrupted, played_ms: played });
        this.options.onEvent({ type: 'client.closed' });
      }
      await Promise.allSettled([stopMic, player?.close()]);
      this.setState('closed'); this.closing = undefined;
    })();
    return this.closing;
  }
}
