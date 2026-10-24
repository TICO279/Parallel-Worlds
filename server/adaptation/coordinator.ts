import type { AdaptationData, DynamicCharacterState } from '../../shared/characterState';
import type { Scenario, Turn } from '../../shared/domain';
import { ConversationStore } from '../store';
import { buildContext } from '../orchestrator';
import { ApiError } from '../higgs';
import type { AdaptationConfig } from './config';
import { initialState, transitionState } from './engine';
import { createProvider, type AppraisalProvider } from './providers';
import { AppraisalProviderError, unpackAppraisalResult, type AppraisalTelemetry } from './results';
import { branchTurns } from '../branching';
import { transitionRealism, type EvidenceSource } from './realism';
import { createHash } from 'node:crypto';

export function appraisalContext(turns: Turn[], beforeOrder: number, sessionId?: string) {
  return turns.filter(t => t.order < beforeOrder && t.transcriptFinal && t.text && t.status === 'complete')
    .slice(-6).map(t => ({ role: t.role, text: t.text!.slice(0, 2000), ...(sessionId && { turnId: t.order < 0 ? t.itemId : `${sessionId}/${t.itemId}` }) }));
}
export class AdaptationCoordinator {
  private queue = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private provider: AppraisalProvider;
  constructor(private store: ConversationStore, private scenarios: Scenario[], private config: AdaptationConfig, provider?: AppraisalProvider) {
    this.provider = provider ?? createProvider(config);
    store.subscribe((id, turn) => { if (turn.role === 'user') void this.enqueue(id); });
  }
  initialize(id: string, mode: 'static' | 'adaptive', restored?: DynamicCharacterState) {
    const session = this.store.get(id); const scenario = this.scenarios.find(s => s.id === session.scenarioId)!;
    const base = initialState(scenario.character, id, Date.now());
    const state = restored ? { ...base, comfort: restored.comfort, trust: restored.trust, curiosity: restored.curiosity,
      engagement: restored.engagement, tone: restored.tone, goal: restored.goal, guidance: restored.guidance,
      ...(restored.realism && { realism: { ...structuredClone(restored.realism), memory: restored.realism.memory.filter(n =>
        n.evidence.every(e => session.branch?.history.some(h => h.nodeId === e.turnId))).map(n => {
          const orders = n.evidence.map(e => session.branch!.history.findIndex(h => h.nodeId === e.turnId) - session.branch!.history.length);
          return { ...structuredClone(n), createdOrder: Math.min(...orders), updatedOrder: Math.max(...orders) };
        }) } }) } : base;
    this.store.setAdaptation(id, { mode, timingMode: 'asynchronous', provider: this.provider.name,
      ...(this.provider.name !== 'mock' && { model: this.config.model }),
      appraisalTimeoutMs: this.config.timeoutMs, maxStateDelta: this.config.maxDelta,
      states: [state], attempts: [], applications: [], latencies: [], appliedVersion: 0, pending: false,
      memoryCapacity: this.config.memoryCapacity ?? 8, maxOutputTokens: this.config.maxOutputTokens ?? 1600, instructionHistory: [] });
  }
  get(id: string): AdaptationData {
    const data = this.store.get(id).adaptation;
    if (!data) throw new ApiError(404, 'Adaptive state not initialized.');
    return data;
  }
  current(id: string): DynamicCharacterState { return this.get(id).states.at(-1)!; }
  stateAtTurn(id: string, turnId: string) { return this.get(id).states.find(s => s.lastProcessedTurnId === turnId); }
  instructions(id: string) {
    const session = this.store.get(id); const scenario = this.scenarios.find(s => s.id === session.scenarioId)!;
    const state = this.current(id);
    // Delivery-only appraisal never compiles dynamic guidance into Realtime wording.
    if (session.speechMode === 'tts') {
      const instructions = buildContext(scenario).instructions;
      return { version: state.version, instructions, persistentInstructions: instructions, turnInstructions: instructions,
        contextHash: createHash('sha256').update(instructions).digest('hex'), triggerTurnId: state.lastProcessedTurnId ?? undefined };
    }
    const context = appraisalContext([...branchTurns(session.branch?.history), ...session.turns], state.lastProcessedOrder + 1);
    // Automatic replies may already exist: never dispatch an acknowledgement of a past utterance.
    const dynamic = this.get(id).mode === 'adaptive' ? state : {};
    const instructions = buildContext(scenario, dynamic, context).instructions;
    const turnInstructions = buildContext(scenario, dynamic, context, { includeTurnBrief: true }).instructions;
    const contextHash = createHash('sha256').update(instructions).digest('hex');
    const data = this.get(id);
    if (!data.instructionHistory?.some(r => r.version === state.version && r.contextHash === contextHash)) {
      data.instructionHistory ??= []; data.instructionHistory.push({ version: state.version, contextHash, instructions,
        persistentInstructions: instructions, turnInstructions, triggerTurnId: state.lastProcessedTurnId ?? undefined, at: Date.now(), compilerVersion: 'realism-1' });
      this.store.setAdaptation(id, data);
    }
    return { version: state.version, instructions, persistentInstructions: instructions, turnInstructions, contextHash, triggerTurnId: state.lastProcessedTurnId ?? undefined };
  }
  cancel(id: string) { this.controllers.get(id)?.abort(); }
  enqueue(id: string): Promise<void> {
    const job = (this.queue.get(id) ?? Promise.resolve()).then(() => this.process(id)).catch(() => {});
    this.queue.set(id, job);
    void job.finally(() => { if (this.queue.get(id) === job) this.queue.delete(id); });
    return job;
  }
  private async process(id: string) {
    let session = this.store.get(id);
    if (session.adaptation?.mode !== 'adaptive' || ['closed', 'error'].includes(session.status)) return;
    for (const turn of session.turns.filter(t => t.role === 'user').sort((a, b) => a.order - b.order)) {
      const data = this.get(id);
      if (data.attempts.some(a => a.turnId === turn.itemId)) continue;
      if (turn.status === 'pending' || turn.status === 'streaming') break; // don't overtake delayed transcription
      if (!turn.transcriptFinal || turn.status !== 'complete' || !turn.text?.trim()) continue;
      const previous = data.states.at(-1)!;
      if (turn.order <= previous.lastProcessedOrder) {
        data.attempts.push({ turnId: turn.itemId, baseVersion: previous.version, provider: this.provider.name, status: 'stale', latencyMs: 0, at: Date.now(), error: 'Turn precedes the committed state.' });
        this.store.setAdaptation(id, data); continue;
      }
      const scenario = this.scenarios.find(s => s.id === session.scenarioId)!;
      const controller = new AbortController(); this.controllers.set(id, controller);
      const started = performance.now(); data.pending = true; this.store.setAdaptation(id, data);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let telemetry: AppraisalTelemetry = this.provider.name === 'mock' ? {} : { model: this.config.model };
      try {
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Appraisal timed out or was cancelled.')), { once: true });
          timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        });
        const allTurns = [...branchTurns(session.branch?.history), ...session.turns];
        const output = await Promise.race([this.provider.appraise({ character: scenario.character, previous: structuredClone(previous), turnId: `${id}/${turn.itemId}`,
          utterance: turn.text.slice(0, 6000), context: appraisalContext(allTurns, turn.order, id) }, controller.signal), aborted]);
        const result = unpackAppraisalResult(output); telemetry = { ...telemetry, ...result.telemetry };
        const fresh = this.get(id); session = this.store.get(id);
        if (controller.signal.aborted || ['closed', 'error'].includes(session.status) || fresh.states.at(-1)!.version !== previous.version || session.turns.find(t => t.itemId === turn.itemId)?.text !== turn.text)
          throw new Error('Appraisal became stale or the session ended.');
        const appraisal = result.appraisal;
        const sources: EvidenceSource[] = allTurns.filter(t => t.order <= turn.order && t.status === 'complete' && t.transcriptFinal && t.text)
          .map(t => ({ turnId: t.order < 0 ? t.itemId : `${id}/${t.itemId}`, role: t.role, text: t.text!, order: t.order }));
        const state = 'schemaVersion' in appraisal ? transitionRealism(previous, appraisal, turn, Date.now(), this.config.maxDelta, sources, this.config.memoryCapacity ?? 8, this.config.memoryTextLimit ?? 160) :
          transitionState(previous, appraisal, turn, previous.version, Date.now(), this.config.maxDelta);
        fresh.states.push(state); fresh.pending = false;
        fresh.attempts.push({ turnId: turn.itemId, baseVersion: previous.version, status: 'committed', provider: this.provider.name,
          latencyMs: Math.round(performance.now() - started), at: Date.now(), appraisal, stateVersion: state.version, ...telemetry });
        this.store.setAdaptation(id, fresh);
        this.instructions(id);
      } catch (error) {
        if (error instanceof AppraisalProviderError) telemetry = { ...telemetry, ...error.telemetry };
        const fresh = this.get(id); fresh.pending = false;
        fresh.attempts.push({ turnId: turn.itemId, baseVersion: previous.version, status: 'failed', provider: this.provider.name,
          latencyMs: Math.round(performance.now() - started), at: Date.now(), ...telemetry,
          error: controller.signal.aborted ? 'Appraisal timed out or was cancelled.' : error instanceof AppraisalProviderError ? error.message : 'Invalid, unavailable, or stale appraisal; previous state retained.' });
        this.store.setAdaptation(id, fresh);
      } finally { clearTimeout(timer); if (this.controllers.get(id) === controller) this.controllers.delete(id); }
      session = this.store.get(id);
      if (['closed', 'error'].includes(session.status)) break;
    }
  }
}
