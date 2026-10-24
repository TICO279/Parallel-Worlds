import { relationshipNames, type AdaptationData, type DynamicCharacterState, type JudgeResult, type JudgmentRecord, type RelationshipName, type VoiceRecord } from '../../shared/characterState';
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
import { debug, log } from '../log';
import { createDecider, MockDecider, splitSentences, type Decider, type EmotionChoice, type Judgment } from './decisions';
import { chooseVoiceEmotion, initialRelationship, relationshipTransition, updateRelationship } from './relationship';
import { printTurn, type TurnStory } from '../turnLog';

/** Completed lines of this trajectory before `beforeOrder`, newest `limit` kept. Branch replay has negative orders, so it comes first. */
export function appraisalContext(turns: Turn[], beforeOrder: number, sessionId?: string, limit = 6) {
  return turns.filter(t => t.order < beforeOrder && t.transcriptFinal && t.text && t.status === 'complete')
    .slice(-limit).map(t => ({ role: t.role, text: t.text!.slice(0, 2000), ...(sessionId && { turnId: t.order < 0 ? t.itemId : `${sessionId}/${t.itemId}` }) }));
}
export class AdaptationCoordinator {
  private queue = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private provider: AppraisalProvider; private decider: Decider;
  /** Used when the decision model fails (e.g. rate limited): keyword rules and the current mood instead of "neutral". */
  private fallback = new MockDecider();
  /** The turn being told in the log, per session; printed when its reply is spoken or the next turn starts. */
  private stories = new Map<string, TurnStory>(); private turnCounts = new Map<string, number>();
  constructor(private store: ConversationStore, private scenarios: Scenario[], private config: AdaptationConfig, provider?: AppraisalProvider, decider?: Decider) {
    this.provider = provider ?? createProvider(config);
    this.decider = decider ?? createDecider(config.decision);
    // In major-shift mode the full appraisal only runs when judgeTurn() asks for it.
    if (config.appraisalTrigger !== 'major_shift') store.subscribe((id, turn) => { if (turn.role === 'user') void this.enqueue(id); });
  }
  // Ember dates build their character per profile, so the store's copy wins over the fixed list.
  private scenarioOf(id: string) { const session = this.store.get(id); return this.store.scenario(id) ?? this.scenarios.find(s => s.id === session.scenarioId)!; }
  /** Completed lines of this trajectory (replayed branch + live session) before `beforeOrder`, up to the context cap. */
  private trajectory(id: string, beforeOrder = Infinity) {
    const session = this.store.get(id);
    return appraisalContext([...branchTurns(session.branch?.history), ...session.turns], beforeOrder, undefined, this.config.contextLines ?? 60)
      .map(t => ({ role: t.role, text: t.text }));
  }
  initialize(id: string, mode: 'static' | 'adaptive', restored?: DynamicCharacterState) {
    const session = this.store.get(id); const scenario = this.scenarioOf(id);
    const base = { ...initialState(scenario.character, id, Date.now()), relationship: restored?.relationship ?? initialRelationship(scenario.character) };
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
      memoryCapacity: this.config.memoryCapacity ?? 8, maxOutputTokens: this.config.maxOutputTokens ?? 1600, instructionHistory: [],
      ...(mode === 'adaptive' && { decision: { provider: this.decider.name, ...(this.decider.model && { model: this.decider.model }),
        majorThreshold: this.config.decision?.majorThreshold ?? 0.7 }, judgments: [], voices: [] }) });
  }
  get(id: string): AdaptationData {
    const data = this.store.get(id).adaptation;
    if (!data) throw new ApiError(404, 'Adaptive state not initialized.');
    return data;
  }
  current(id: string): DynamicCharacterState { return this.get(id).states.at(-1)!; }
  stateAtTurn(id: string, turnId: string) { return this.get(id).states.find(s => s.lastProcessedTurnId === turnId); }
  instructions(id: string) {
    const session = this.store.get(id); const scenario = this.scenarioOf(id);
    const state = this.current(id);
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
  /**
   * Step 0 of each turn: the decision model judges the user's line. A major shift runs the full DeepSeek
   * appraisal now (before the reply is spoken) and returns the new instructions for Higgs. Every line
   * updates the relationship indicators: a little normally, a lot on a major shift.
   */
  judgeTurn(id: string, turnId: string): Promise<JudgeResult> {
    let result!: Promise<JudgeResult>;
    // Serialized with appraisals so state versions stay ordered.
    const job = (this.queue.get(id) ?? Promise.resolve()).then(() => (result = this.runJudge(id, turnId)).then(() => {}, () => {}));
    this.queue.set(id, job); void job.finally(() => { if (this.queue.get(id) === job) this.queue.delete(id); });
    return job.then(() => result);
  }
  private async runJudge(id: string, turnId: string): Promise<JudgeResult> {
    const data = this.get(id);
    if (data.mode !== 'adaptive') throw new ApiError(409, 'Session uses static mode.');
    const turn = this.store.get(id).turns.find(t => t.itemId === turnId && t.role === 'user');
    if (!turn?.transcriptFinal || turn.status !== 'complete' || !turn.text?.trim()) throw new ApiError(409, 'Record the finalized user line before judging it.');
    const done = data.judgments?.find(j => j.turnId === turnId);
    if (done) return { major: done.major, majorShift: done.majorShift, event: done.event, stateVersion: this.current(id).version,
      ...(done.major && { instructions: this.instructions(id).instructions }) };
    const character = this.scenarioOf(id).character; const previous = this.current(id);
    const relationship = previous.relationship ?? initialRelationship(character);
    const threshold = this.config.decision?.majorThreshold ?? 0.7; const started = performance.now();
    const story = this.beginStory(id, turnId, turn.text, character.name);
    let judgment: Judgment; let error: string | undefined;
    try {
      judgment = await this.decider.judge({ character, relationship, conversation: this.trajectory(id, turn.order), line: turn.text.slice(0, 6000) },
        AbortSignal.timeout(this.config.decision?.timeoutMs ?? 4000));
    } catch (e) {
      error = e instanceof AppraisalProviderError ? e.message : 'Decision model failed.';
      judgment = await this.fallback.judge({ character, relationship, conversation: [], line: turn.text }, new AbortController().signal);
    }
    const latencyMs = Math.round(performance.now() - started); const major = judgment.majorShift >= threshold;
    story.judge = { provider: this.decider.name, ...(this.decider.model && { model: this.decider.model }), majorShift: judgment.majorShift, threshold, major,
      event: judgment.event, behavior: judgment.behavior, nudges: judgment.nudges, ms: latencyMs,
      ...(judgment.usage?.inputTokens !== undefined && { inputTokens: judgment.usage.inputTokens }), ...(judgment.usage?.cost !== undefined && { cost: judgment.usage.cost }),
      ...(error && { error }) };
    let appraised: JudgmentRecord['appraised'];
    if (major) {
      await this.process(id, turnId);
      const attempt = this.get(id).attempts.find(a => a.turnId === turnId);
      appraised = attempt?.status === 'committed' ? 'committed' : 'failed';
      const appraisal = attempt?.appraisal;
      story.appraisal = { provider: this.provider.name, ...(attempt?.model && { model: attempt.model }), ms: attempt?.latencyMs ?? 0, status: attempt?.status ?? 'failed',
        ...(attempt?.usage && { tokens: attempt.usage.totalTokens }), ...(attempt?.error && { error: attempt.error }),
        ...(appraisal && { tone: appraisal.tone, interpretation: appraisal.interpretation, guidance: appraisal.guidance }),
        ...(appraisal && 'schemaVersion' in appraisal && { move: appraisal.brief.move, memory: appraisal.memoryOperations.filter(o => o.action === 'add').map(o => `${o.category}: ${o.text}`) }) };
    }
    const fresh = this.get(id); const latest = fresh.states.at(-1)!;
    const next = updateRelationship(latest.relationship ?? relationship, { nudges: judgment.nudges, behavior: judgment.behavior, event: judgment.event, major, turnId, majorShift: judgment.majorShift });
    // A committed appraisal already created this turn's state version; otherwise the relationship gets its own.
    if (latest.lastProcessedTurnId === turnId) fresh.states[fresh.states.length - 1] = { ...latest, relationship: next };
    else if (turn.order > latest.lastProcessedOrder) fresh.states.push(relationshipTransition(latest, next, turn, Date.now()));
    fresh.judgments = [...(fresh.judgments ?? []), { turnId, provider: this.decider.name, ...(this.decider.model && { model: this.decider.model }),
      majorShift: judgment.majorShift, major, event: judgment.event, nudges: judgment.nudges, behavior: judgment.behavior, latencyMs, at: Date.now(),
      ...(appraised && { appraised }), ...(judgment.usage && { usage: judgment.usage }), ...(error && { error }) }].slice(-200);
    this.store.setAdaptation(id, fresh);
    const prepared = this.instructions(id); const state = this.current(id);
    story.state = { from: previous.version, to: state.version, before: relationship, after: state.relationship ?? next };
    return { major, majorShift: judgment.majorShift, event: judgment.event, stateVersion: state.version, ...(major && { instructions: prepared.instructions }) };
  }
  /** Step 2: one emotion per sentence of the drafted reply, and the tagged text for Higgs TTS 3. */
  async voice(id: string, replyItemId: string, text: string, signal: AbortSignal) {
    const character = this.scenarioOf(id).character; const state = this.current(id);
    const relationship = state.relationship ?? initialRelationship(character);
    const sentences = splitSentences(text);
    const conversation = this.trajectory(id);
    // The draft may already be recorded as the last line; it is sent separately as the reply.
    if (conversation.at(-1)?.role === 'assistant' && conversation.at(-1)!.text.trim() === text.trim()) conversation.pop();
    const started = performance.now(); let choices: EmotionChoice[]; let error: string | undefined; let usage: VoiceRecord['usage'];
    try {
      const decided = await this.decider.emotions({ character, relationship, conversation, sentences },
        AbortSignal.any([signal, AbortSignal.timeout(this.config.decision?.timeoutMs ?? 4000)]));
      choices = decided.choices; usage = decided.usage;
    } catch (e) {
      error = e instanceof AppraisalProviderError ? e.message : 'Decision model failed.';
      choices = (await this.fallback.emotions({ character, relationship, conversation, sentences }, new AbortController().signal)).choices;
    }
    const decisionMs = Math.round(performance.now() - started);
    // The mood reweights Jev's distribution, so a tense character does not sound neutral just because her words are polite.
    const picks = choices.map(c => chooseVoiceEmotion(c.probabilities ?? { [c.emotion]: c.probability }, relationship));
    const record: VoiceRecord = { replyItemId, provider: this.decider.name, ...(this.decider.model && { model: this.decider.model }),
      sentences: sentences.map((s, i) => ({ text: s, emotion: picks[i].emotion, probability: picks[i].probability })), decisionMs, at: Date.now(),
      ...(usage && { usage }), ...(error && { error }) };
    const data = this.get(id); data.voices = [...(data.voices ?? []), record].slice(-200); this.store.setAdaptation(id, data);
    const story = this.stories.get(id);
    if (story) story.voice = { provider: this.decider.name, ms: decisionMs, ...(usage?.cost !== undefined && { cost: usage.cost }), ...(error && { error }),
      sentences: sentences.map((text, i) => ({ text, emotion: picks[i].emotion, probability: picks[i].probability, jevChoice: picks[i].jevChoice, jevProbability: picks[i].jevProbability })) };
    // TTS 3 tags: a new delivery group replaces the previous one, so a tag is written only when the delivery changes; neutral resets.
    const groups = picks.map(p => p.emotion !== 'neutral' ? `<|emotion:${p.emotion}|>${p.expressive ? '<|prosody:expressive_high|>' : ''}` : '');
    const input = sentences.map((text, i) => {
      const previous = i > 0 ? groups[i - 1] : '';
      return `${groups[i] !== previous ? groups[i] || '<|reset|>' : ''}${text}`;
    }).join(' ');
    return { input, record };
  }
  private beginStory(id: string, userItemId: string, userText: string, character: string): TurnStory {
    this.flushStory(id);
    const turn = (this.turnCounts.get(id) ?? 0) + 1; this.turnCounts.set(id, turn);
    const story: TurnStory = { session: id, turn, character, userItemId, userText }; this.stories.set(id, story);
    return story;
  }
  /** Prints a turn that never reached speech (interrupted, abandoned, or the session ended). */
  flushStory(id: string) { const story = this.stories.get(id); if (story) { this.stories.delete(id); printTurn(story); } }
  /** Completes the turn story with what was actually spoken and prints it. */
  finishTurn(id: string, spoken: { reply: string; discardedDraft?: string; userItemId?: string; tts: NonNullable<TurnStory['tts']> }) {
    let story = this.stories.get(id);
    if (!story) {
      // No judgment ran (e.g. transcription failed): tell the turn from what was recorded.
      const user = this.store.get(id).turns.filter(t => t.role === 'user').at(-1);
      const turn = (this.turnCounts.get(id) ?? 0) + 1; this.turnCounts.set(id, turn);
      story = { session: id, turn, character: this.scenarioOf(id).character.name, userItemId: user?.itemId ?? '', userText: user?.text ?? '(not transcribed)' };
    }
    this.stories.delete(id);
    printTurn({ ...story, reply: spoken.reply, tts: spoken.tts, ...(spoken.discardedDraft !== undefined && { discardedDraft: spoken.discardedDraft }) });
  }
  recordVoiceTiming(id: string, replyItemId: string, timing: { ttsFirstAudioMs?: number; error?: string }) {
    const data = this.get(id); const record = data.voices?.filter(v => v.replyItemId === replyItemId).at(-1); if (!record) return;
    Object.assign(record, timing.ttsFirstAudioMs !== undefined && { ttsFirstAudioMs: timing.ttsFirstAudioMs }, timing.error && { error: timing.error });
    this.store.setAdaptation(id, data);
  }
  cancel(id: string) { this.controllers.get(id)?.abort(); this.flushStory(id); }
  enqueue(id: string): Promise<void> {
    const job = (this.queue.get(id) ?? Promise.resolve()).then(() => this.process(id)).catch(() => {});
    this.queue.set(id, job);
    void job.finally(() => { if (this.queue.get(id) === job) this.queue.delete(id); });
    return job;
  }
  private async process(id: string, onlyTurnId?: string) {
    let session = this.store.get(id);
    if (session.adaptation?.mode !== 'adaptive' || ['closed', 'error'].includes(session.status)) return;
    for (const turn of session.turns.filter(t => t.role === 'user').sort((a, b) => a.order - b.order)) {
      if (onlyTurnId && turn.itemId !== onlyTurnId) continue;
      const data = this.get(id);
      if (data.attempts.some(a => a.turnId === turn.itemId)) continue;
      if (turn.status === 'pending' || turn.status === 'streaming') break; // don't overtake delayed transcription
      if (!turn.transcriptFinal || turn.status !== 'complete' || !turn.text?.trim()) continue;
      const previous = data.states.at(-1)!;
      if (turn.order <= previous.lastProcessedOrder) {
        data.attempts.push({ turnId: turn.itemId, baseVersion: previous.version, provider: this.provider.name, status: 'stale', latencyMs: 0, at: Date.now(), error: 'Turn precedes the committed state.' });
        this.store.setAdaptation(id, data); continue;
      }
      const scenario = this.scenarioOf(id);
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
          utterance: turn.text.slice(0, 6000), context: appraisalContext(allTurns, turn.order, id, this.config.contextLines ?? 60) }, controller.signal), aborted]);
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
        const usage = telemetry.usage ? `, ${telemetry.usage.totalTokens} tokens` : '';
        debug('appraisal', `✓ ${this.provider.name} session ${id.slice(0, 8)} turn ${turn.itemId}: state v${previous.version} → v${state.version} (${Math.round(performance.now() - started)} ms${usage})`);
      } catch (error) {
        if (error instanceof AppraisalProviderError) telemetry = { ...telemetry, ...error.telemetry };
        const fresh = this.get(id); fresh.pending = false;
        fresh.attempts.push({ turnId: turn.itemId, baseVersion: previous.version, status: 'failed', provider: this.provider.name,
          latencyMs: Math.round(performance.now() - started), at: Date.now(), ...telemetry,
          error: controller.signal.aborted ? 'Appraisal timed out or was cancelled.' : error instanceof AppraisalProviderError ? error.message : 'Invalid, unavailable, or stale appraisal; previous state retained.' });
        this.store.setAdaptation(id, fresh);
        log('appraisal', `✗ ${this.provider.name} session ${id.slice(0, 8)} turn ${turn.itemId}: ${fresh.attempts.at(-1)!.error}; kept state v${previous.version}`);
      } finally { clearTimeout(timer); if (this.controllers.get(id) === controller) this.controllers.delete(id); }
      session = this.store.get(id);
      if (['closed', 'error'].includes(session.status)) break;
    }
  }
}
