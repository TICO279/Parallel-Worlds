import type { ProtocolEvent, SessionBootstrap } from '../../shared/domain';
import { RingPlayer } from '../audio/playback';
import { MicCapture } from '../audio/capture';
import { describeClose, inputAudioAppend, truncateItem, WS_URL } from './protocol';
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
  /** Start the microphone as soon as the session is ready, so one click starts a spoken conversation. */
  autoMic?: boolean;
  socketFactory?: (url: string, protocols: string[]) => WebSocket;
  playerFactory?: (drained: () => void, failure: (m: string) => void) => Player;
  micFactory?: (chunk: (b64: string) => void, level: (rms: number) => void) => Microphone;
}
export class HiggsClient {
  private gen = 0; private ws: WebSocket | null = null; private controller?: AbortController;
  private player?: Player; private mic?: Microphone; private timeout?: ReturnType<typeof setTimeout>;
  private state: ConnectionState = 'idle'; private currentItem?: string;
  private blocked = new Set<string>(); private generating = false; private queued = false;
  private hadSession = false;
  private closing?: Promise<void>;
  constructor(private options: ClientOptions) {}
  get connectionState() { return this.state; }
  private setState(s: ConnectionState) { this.state = s; this.options.onState(s); }
  private send(event: ProtocolEvent) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(event));
  }
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'ready' || this.state === 'closing') return;
    const gen = ++this.gen; this.setState('connecting'); this.blocked.clear(); this.hadSession = false;
    this.currentItem = undefined; this.generating = false; this.queued = false;
    this.controller = new AbortController();
    const alive = () => gen === this.gen;
    const drained = () => { if (alive()) { this.queued = false; this.options.onActivity(this.generating ? 'thinking' : this.mic?.active ? 'listening' : 'idle'); } };
    const fail = (message: string) => { if (alive()) { this.options.onError(message); void this.disconnect(); } };
    const player = this.options.playerFactory?.(drained, fail) ?? new RingPlayer(speaking => { if (!speaking) drained(); }, fail);
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
    this.send(inputAudioAppend(audio));
  }
  private handle(event: ProtocolEvent, gen: number) {
    this.options.onEvent(event);
    switch (event.type) {
      case 'session.created': case 'session.updated':
        if (this.state === 'connecting') {
          clearTimeout(this.timeout);
          for (const item of this.options.seed?.() ?? []) this.send(item);
          this.setState('ready');
          if (this.options.autoMic) void this.toggleMic();
        }
        break;
      case 'response.created': this.generating = true; this.options.onActivity('thinking'); break;
      case 'response.output_item.added': {
        const item = event.item as { id?: string; role?: string } | undefined;
        if (item?.role === 'assistant' && item.id) this.currentItem = item.id; break;
      }
      case 'response.output_audio.delta': {
        const id = typeof event.item_id === 'string' ? event.item_id : this.currentItem;
        if (!id || this.blocked.has(id) || typeof event.delta !== 'string' || !event.delta) break;
        // Each item gets a fresh playback counter, even if output_item.added preceded audio.
        if (this.playbackItem !== id) { this.player?.reset(); this.playbackItem = id; }
        this.currentItem = id; this.queued = true;
        this.player?.enqueueBase64(event.delta); this.options.onActivity('speaking'); break;
      }
      case 'response.done': this.generating = false; if (!this.queued) this.options.onActivity(this.mic?.active ? 'listening' : 'idle'); break;
      case 'input_audio_buffer.speech_started': void this.bargeIn(gen); this.options.onActivity('listening'); break;
      case 'input_audio_buffer.speech_stopped': this.options.onActivity('thinking'); break;
      case 'session.idle_timeout': case 'session.max_duration_reached':
        this.options.onError(event.type === 'session.idle_timeout' ? 'Session ended after inactivity. Connect again to start fresh.' : 'Boson session duration limit reached. Connect again to start fresh.');
        void this.disconnect(); break;
      case 'error':
        // Upstream error bodies may echo configuration or credentials. Never forward raw bodies.
        this.options.onError('Boson reported a session error. Check credentials, account credit, and the configured model/voice.');
        void this.disconnect(); break;
    }
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
  /** A typed turn. Like speaking over the character, it interrupts any reply still playing. */
  sendText(text: string): boolean {
    if (this.state !== 'ready' || !text.trim()) return false;
    void this.bargeIn(this.gen);
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
      if (gen === this.gen) { this.options.onMic(mic.active); this.options.onActivity(this.queued ? 'speaking' : this.generating ? 'thinking' : mic.active ? 'listening' : 'idle'); }
    } catch {
      if (gen === this.gen) this.options.onError('Microphone could not start. Allow microphone access and check your input device.');
    }
  }
  async disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    ++this.gen; clearTimeout(this.timeout); this.controller?.abort();
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
