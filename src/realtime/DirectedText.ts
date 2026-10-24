import type { ProtocolEvent } from '../../shared/domain';
import type { ResponsePlan } from '../../shared/behavior';
type Phase = 'echo' | 'planning' | 'updating' | 'authorizing' | 'requested' | 'created' | 'draining' | 'restoring';
type Pending = { turnId: string; phase: Phase; controller: AbortController; plan?: ResponsePlan; responseId?: string; timer?: ReturnType<typeof setTimeout> };
/** Typed-only response authorization. A complete session update is acknowledged before one metadata-only response.create. */
export class DirectedText {
  private pending?: Pending;
  private queue = Promise.resolve();
  private finishedResponses = new Set<string>();
  enabled = false;
  constructor(private options: {
    send(event: ProtocolEvent): void;
    prepare(turnId: string, signal: AbortSignal): Promise<ResponsePlan>;
    record(plan: ResponsePlan, status: ResponsePlan['status'], responseId?: string): Promise<void>;
    acknowledged(version: number): void; busy(value: boolean): void;
    failure(message: string): void; notice(message: string): void;
  }) {}
  get busy() { return Boolean(this.pending); }
  begin(turnId: string) {
    if (this.pending) throw new Error('A directed response is already active.');
    const p: Pending = { turnId, phase: 'echo', controller: new AbortController() }; this.pending = p;
    this.options.busy(true); this.deadline(p, 10000);
  }
  private deadline(p: Pending, ms: number) {
    clearTimeout(p.timer); p.timer = setTimeout(() => this.fail(p, p.phase === 'requested' ?
      'Reply creation is uncertain. Reconnect; do not resend the same response intent.' : 'Directed reply setup timed out. No automatic retry was made; reconnect to continue.'), ms);
  }
  private record(p: Pending, status: ResponsePlan['status']) {
    if (!p.plan) return Promise.resolve();
    const plan = p.plan; const responseId = p.responseId;
    const next = this.queue.catch(() => {}).then(() => this.options.record(plan, status, responseId));
    this.queue = next; return next;
  }
  private background(p: Pending, status: ResponsePlan['status']) {
    void this.record(p, status).catch(() => this.options.notice('Could not record a directed response lifecycle event. Export may have incomplete attribution.'));
  }
  private fail(p: Pending, message: string) {
    if (this.pending !== p) return;
    clearTimeout(p.timer); p.controller.abort();
    if (p.plan && !['draining', 'restoring'].includes(p.phase)) this.background(p, p.phase === 'requested' ? 'uncertain' : p.phase === 'created' ? 'cancelled' : 'failed');
    this.pending = undefined; this.options.busy(false); this.options.failure(message);
  }
  /** Called before transcript/playback handling; an uncorrelated response is never released. */
  accept(event: ProtocolEvent): boolean {
    const p = this.pending; if (!this.enabled) return true;
    if (!p) {
      if (event.type === 'response.created' || event.type === 'response.output_audio.delta') {
        const id = event.type === 'response.created' ? (event.response as { id?: string })?.id : event.response_id;
        if (typeof id === 'string' && this.finishedResponses.has(id)) return false;
        this.options.failure('An unrequested directed response was blocked. Reconnect before continuing.'); return false;
      }
      return true;
    }
    if (event.type === 'response.created') {
      const r = event.response as { id?: string; metadata?: { intentId?: string; contextHash?: string } } | undefined;
      if (p.phase === 'created' && r && r.id === p.responseId && r.metadata?.intentId === p.plan?.id && r.metadata?.contextHash === p.plan?.contextHash)
        return false; // duplicate creation notification; do not reset timing or re-authorize
      if (p.phase !== 'requested' || !p.plan || !r?.id || r.metadata?.intentId !== p.plan.id || r.metadata?.contextHash !== p.plan.contextHash) {
        this.fail(p, 'Response context did not match its saved intent. Playback was blocked; reconnect.'); return false;
      }
      clearTimeout(p.timer); p.phase = 'created'; p.responseId = r.id; this.background(p, 'created'); return true;
    }
    if (event.type === 'response.output_audio.delta' && (p.phase !== 'created' || event.response_id !== p.responseId)) {
      this.fail(p, 'Uncorrelated audio was blocked. Reconnect before continuing.'); return false;
    }
    return true;
  }
  observe(event: ProtocolEvent) {
    const p = this.pending; if (!this.enabled || !p) return;
    const item = event.item as { id?: string; role?: string } | undefined;
    if (event.type === 'conversation.item.added' && p.phase === 'echo' && item?.id === p.turnId && item.role === 'user') {
      p.phase = 'planning'; this.deadline(p, 25000);
      void this.options.prepare(p.turnId, p.controller.signal).then(plan => {
        if (this.pending !== p || p.controller.signal.aborted) { void this.options.record(plan, 'cancelled').catch(() => {}); return; }
        if (plan.turnId !== p.turnId || plan.expiresAt <= Date.now()) throw new Error('Expired or mismatched response plan.');
        p.plan = plan; p.phase = 'updating'; this.deadline(p, 5000);
        this.options.send({ type: 'session.update', session: { instructions: plan.instructions } });
      }).catch(() => this.fail(p, 'The directed reply could not be prepared or recorded. No reply was requested; any committed state remains saved. Reconnect to continue.'));
    }
    if (event.type === 'session.updated') {
      const instructions = (event.session as { instructions?: string } | undefined)?.instructions;
      if (p.phase === 'updating' && instructions === p.plan?.instructions) {
        clearTimeout(p.timer); p.phase = 'authorizing'; this.deadline(p, 5000);
        void this.record(p, 'dispatched').then(() => {
          if (this.pending !== p || p.controller.signal.aborted) return;
          if (p.plan!.expiresAt <= Date.now()) throw new Error('Response plan expired.');
          this.options.acknowledged(p.plan!.stateVersion); p.phase = 'requested'; this.deadline(p, 10000);
          this.options.send({ type: 'response.create', response: { metadata: { intentId: p.plan!.id, contextHash: p.plan!.contextHash } } });
        }).catch(() => this.fail(p, 'Could not authorize the saved reply. No automatic retry was made; reconnect.'));
      } else if (p.phase === 'restoring' && instructions === p.plan?.persistentInstructions) {
        if (p.responseId) this.finishedResponses.add(p.responseId);
        if (this.finishedResponses.size > 8) this.finishedResponses.delete(this.finishedResponses.values().next().value!);
        clearTimeout(p.timer); this.pending = undefined; this.options.busy(false);
      }
    }
    if (event.type === 'response.done' && p.phase === 'created' && (event.response as { id?: string })?.id === p.responseId) {
      const status = (event.response as { status?: string }).status;
      this.background(p, status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed');
      if (status !== 'completed' && status !== 'cancelled') this.options.notice('Boson did not complete this directed reply. Its intent is recorded as failed.');
      p.phase = 'draining';
    }
  }
  idle() {
    const p = this.pending;
    if (p?.phase === 'draining' && p.plan) { p.phase = 'restoring'; this.deadline(p, 5000);
      this.options.send({ type: 'session.update', session: { instructions: p.plan.persistentInstructions } }); }
  }
  close() {
    const p = this.pending; if (!p) return;
    clearTimeout(p.timer); p.controller.abort();
    if (p.plan && !['draining', 'restoring'].includes(p.phase)) this.background(p, p.phase === 'requested' ? 'uncertain' : 'cancelled');
    this.pending = undefined; this.options.busy(false);
  }
}
