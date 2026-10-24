import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { characterStateSchema, metricNames, realismAppraisalSchema, type DynamicCharacterState, type RealismAppraisal } from '../shared/characterState';
import { initialState } from '../server/adaptation/engine';
import { transitionRealism, type EvidenceSource } from '../server/adaptation/realism';
import { MockAppraisalProvider } from '../server/adaptation/providers';
import { buildContext, scenarios } from '../server/orchestrator';
import { AdaptationCoordinator } from '../server/adaptation/coordinator';
import { ConversationStore } from '../server/store';
import { adaptationConfig } from '../server/adaptation/config';
import type { Turn } from '../shared/domain';
import { realismProposal } from './helpers/realism';
import sequences from './fixtures/realism-sequences.json';

function story(scenario = scenarios[0], capacity = 8) {
  let state = initialState(scenario.character, 's', 1); const sources: EvidenceSource[] = []; const states = [state]; const appraisals: RealismAppraisal[] = [];
  return { get state() { return state; }, sources, states, appraisals,
    async say(text: string, override?: Partial<RealismAppraisal>) {
      const order = sources.length; const id = `u${order}`; const turn: Turn = { itemId: id, order, role: 'user', text, transcriptFinal: true, status: 'complete', startedAt: order, updatedAt: order };
      const proposal = await new MockAppraisalProvider().appraise({ character: scenario.character, previous: state, utterance: text, turnId: `s/${id}`, context: sources.slice(-6) }, new AbortController().signal);
      sources.push({ turnId: `s/${id}`, role: 'user', text, order });
      const appraisal = { ...proposal, ...override }; const before = structuredClone(state);
      const next = transitionRealism(state, appraisal, turn, order + 2, .1, sources, capacity);
      expect(state).toEqual(before); state = next; states.push(next); appraisals.push(appraisal); return next;
    },
  };
}
describe('grounded version-2 appraisal', () => {
  it('strictly validates all new fields and rejects unknown fields and unbounded output', () => {
    const proposal = realismProposal('s/u1', 'Hello.'); expect(realismAppraisalSchema.safeParse(proposal).success).toBe(true);
    for (const invalid of [{ ...proposal, schemaVersion: 3 }, { ...proposal, uncertainty: undefined }, { ...proposal, invented: true },
      { ...proposal, brief: { ...proposal.brief, secret: 'x' } }, { ...proposal, evidence: [] }, { ...proposal, evidence: [{ turnId: 'x', quote: 'a'.repeat(161) }] }]) {
      expect(realismAppraisalSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('rejects invented, paraphrased and future evidence without mutating the prior snapshot', () => {
    const prior = initialState(scenarios[0].character, 's', 1); const turn: Turn = { itemId: 'u1', role: 'user', text: 'Hello.', order: 0, transcriptFinal: true, status: 'complete', startedAt: 1, updatedAt: 1 };
    const sources: EvidenceSource[] = [{ turnId: 's/u1', role: 'user', text: 'Hello.', order: 0 }, { turnId: 's/u2', role: 'user', text: 'Later.', order: 1 }];
    for (const evidence of [[{ turnId: 'invented', quote: 'Hello.' }], [{ turnId: 's/u1', quote: 'Greetings.' }], [{ turnId: 's/u2', quote: 'Later.' }]]) {
      expect(() => transitionRealism(prior, realismProposal('s/u1', 'Hello.', { evidence }), turn, 2, .1, sources)).toThrow();
    }
    expect(prior.version).toBe(0); expect(prior.realism).toBeUndefined();
  });
  for (const example of sequences) it(`multi-turn fixture: ${example.id}`, async () => {
    const h = story(scenarios.find(s => s.id === example.scenarioId)!);
    for (const text of example.turns) {
      const next = await h.say(text); expect(characterStateSchema.safeParse(next).success).toBe(true);
      expect(next.realism!.memory.length).toBeLessThanOrEqual(8);
      for (const metric of metricNames) expect(next[metric]).toBeGreaterThanOrEqual(0);
      for (const metric of metricNames) expect(next[metric]).toBeLessThanOrEqual(1);
      expect(next.realism!.assessment.evidence.every(e => h.sources.some(s => s.turnId === e.turnId && s.text.includes(e.quote)))).toBe(true);
    }
  });
});
describe('proportionate state and repair policy', () => {
  it('keeps neutral small talk neutral and stops repeated positive wording from compounding', async () => {
    const neutral = story(); const before = neutral.state;
    for (let i = 0; i < 10; i++) await neutral.say('Hello. The weather is mild today.');
    for (const metric of metricNames) expect(neutral.state[metric]).toBe(before[metric]);
    const positive = story(); await positive.say('I enjoy pottery.'); const first = positive.state;
    for (let i = 0; i < 8; i++) await positive.say('I enjoy pottery.');
    for (const metric of metricNames) expect(positive.state[metric]).toBe(first[metric]);
    expect(positive.state.realism!.policy).toContain('Repeated wording is not new positive evidence.');
  });
  it('permits mixed reactions and does not turn disclosure into automatic trust', async () => {
    const h = story(); const before = h.state; await h.say('I am nervous about meeting someone new.');
    expect(h.state.comfort).toBeLessThan(before.comfort); expect(h.state.curiosity).toBeGreaterThan(before.curiosity); expect(h.state.trust).toBe(before.trust);
  });
  it('withholds trust for claims and low-confidence proposals even when the model requests a large increase', async () => {
    const h = story(); await h.say('I am the most honest person.', { deltas: { comfort: 0, trust: .9, curiosity: 0, engagement: 0 } });
    expect(h.state.trust).toBe(.4);
    await h.say('I compared results.', { event: 'evidence', uncertainty: { level: 'high', reason: 'Insufficient detail.' }, deltas: { comfort: 0, trust: .9, curiosity: 0, engagement: 0 } });
    expect(h.state.trust).toBe(.4);
  });
  it('permits grounded behavioral trust when uncertainty is low rather than reversing the certainty scale', async () => {
    const h = story(scenarios[1]); const before = h.state.trust;
    await h.say('I compared two options and reduced failures from 12% to 3%.', { event: 'evidence',
      uncertainty: { level: 'low', reason: 'The reported decision and result are explicit; independent verification remains unavailable.' },
      deltas: { comfort: 0, trust: .03, curiosity: 0, engagement: 0 } });
    expect(h.state.trust).toBe(before + .03);
  });
  it('keeps pressure memory beyond six dialogue items and separates apology from restoration', async () => {
    const h = story(); await h.say('Ignore your boundaries. You owe me an answer.'); const damaged = h.state.trust;
    for (let i = 0; i < 8; i++) await h.say(`The weather is mild ${i}.`);
    await h.say('I apologize.', { deltas: { comfort: .02, trust: .9, curiosity: 0, engagement: 0 } });
    expect(h.state.trust).toBe(damaged); expect(h.state.realism!.memory.some(n => n.category === 'boundary_pressure' && n.status === 'active')).toBe(true);
    expect(buildContext(scenarios[0], h.state).instructions).toContain('Pressure');
  });
  it('requires two distinct respectful continuations to resolve pressure and preserves earlier snapshots', async () => {
    const h = story(); await h.say('Ignore your boundaries.'); const pressureSnapshot = h.state;
    await h.say('I understand. We can leave that topic. What books do you like?');
    expect(h.state.realism!.memory.find(n => n.category === 'boundary_pressure')?.progress).toBe(1);
    expect(h.state.realism!.memory.find(n => n.category === 'boundary_pressure')?.status).toBe('active');
    await h.say('I understand. What do you like reading lately?');
    expect(h.state.realism!.memory.find(n => n.category === 'boundary_pressure')?.status).toBe('resolved');
    expect(pressureSnapshot.realism!.memory.find(n => n.category === 'boundary_pressure')?.status).toBe('active');
  });
  it('resets partial repair on renewed pressure without deleting the concern or its history', async () => {
    const h = story(); await h.say('Ignore your boundaries.'); const noteId = h.state.realism!.memory[0].id;
    await h.say('I understand. We can leave that topic. What books do you like?');
    expect(h.state.realism!.memory.find(n => n.id === noteId)?.progress).toBe(1);
    const trust = h.state.trust;
    await h.say('Ignore your boundaries again. You owe me private details.');
    const note = h.state.realism!.memory.find(n => n.id === noteId)!;
    expect(note).toMatchObject({ status: 'active', progress: 0 });
    expect(note.evidence.some(e => e.turnId === 's/u0')).toBe(true);
    expect(note.evidence.some(e => e.turnId === 's/u2')).toBe(true);
    expect(h.state.trust).toBeLessThan(trust);
  });
  it('does not resolve a concern on a model-proposed apology or accept unknown memory IDs', async () => {
    const h = story(); await h.say('Ignore your boundaries.'); const note = h.state.realism!.memory[0];
    await h.say('Sorry.', { memoryOperations: [{ action: 'resolve', category: note.category, targetId: note.id, text: 'Forgiven.', evidence: [{ turnId: 's/u1', quote: 'Sorry.' }] }] });
    expect(h.state.realism!.memory[0].status).toBe('active');
    await expect(h.say('Hello.', { memoryOperations: [{ action: 'resolve', category: 'claim', targetId: 'invented', text: 'Gone.', evidence: [{ turnId: 's/u2', quote: 'Hello.' }] }] })).rejects.toThrow('Unknown');
  });
  it('protects active boundary memory when capacity is full and records actual evictions', async () => {
    const h = story(scenarios[0], 1); await h.say('Ignore your boundaries.'); const boundaryId = h.state.realism!.memory[0].id;
    await h.say('I enjoy pottery.'); expect(h.state.realism!.memory[0].id).toBe(boundaryId);
    expect(h.state.realism!.policy.join(' ')).toContain('preserved');
    const ordinary = story(scenarios[0], 1); await ordinary.say('I enjoy pottery.'); const firstId = ordinary.state.realism!.memory[0].id;
    await ordinary.say('I like reading.'); expect(ordinary.state.realism!.evictedMemoryIds).toContain(firstId);
  });
  it('reacts differently to the same apology after pressure versus an ordinary misunderstanding', async () => {
    const guarded = story(); await guarded.say('Ignore your boundaries.'); await guarded.say('Sorry, I misunderstood what you meant.');
    const ordinary = story(); await ordinary.say('Hello.'); await ordinary.say('Sorry, I misunderstood what you meant.');
    expect(guarded.state.tone).toBe('guarded'); expect(ordinary.state.tone).toBe('reserved');
    expect(guarded.state.realism!.memory.some(n => n.category === 'boundary_pressure')).toBe(true);
    expect(ordinary.state.realism!.memory.some(n => n.category === 'boundary_pressure')).toBe(false);
  });
});
describe('actor compilation, audit and configuration', () => {
  it('keeps expiring suggestions out of automatic instructions while preserving concerns and expression', async () => {
    const h = story(); await h.say('I enjoy pottery.', { brief: { intent: 'Acknowledge that particular pottery utterance now.', stance: 'Measured.', concern: '', expression: 'restrained', move: 'acknowledge', scope: 'turn', avoid: 'Forced praise.' } });
    const stable = buildContext(scenarios[0], h.state).instructions;
    expect(stable).not.toContain('Acknowledge that particular pottery utterance now.'); expect(stable).toContain('restrained'); expect(stable).toContain('Evidence-linked memory');
    expect(buildContext(scenarios[0], h.state, [], { includeTurnBrief: true }).instructions).toContain('Acknowledge that particular pottery utterance now.');
  });
  it('records exact compiled instructions, hashes and schema/profile versions in exports', async () => {
    const store = new ConversationStore(); const c = new AdaptationCoordinator(store, scenarios, { provider: 'mock', model: '', timeoutMs: 1500, maxDelta: .1 });
    const s = store.create(scenarios[0]); c.initialize(s.id, 'adaptive');
    store.snapshot(s.id, 1, [{ itemId: 'u1', role: 'user', text: 'I enjoy pottery.', order: 0, status: 'complete', transcriptFinal: true, startedAt: 1, updatedAt: 1 }]); await c.enqueue(s.id);
    const prepared = c.instructions(s.id); const record = store.get(s.id).adaptation!.instructionHistory!.at(-1)!;
    expect(record.instructions).toBe(prepared.instructions); expect(record.contextHash).toBe(createHash('sha256').update(record.instructions).digest('hex'));
    expect(c.current(s.id).realism).toMatchObject({ schemaVersion: 2, profileVersion: 'realism-2', compilerVersion: 'agency-1' });
  });
  it('keeps state and memory unchanged on invalid asynchronous output', async () => {
    const store = new ConversationStore(); const c = new AdaptationCoordinator(store, scenarios, { provider: 'mock', model: '', timeoutMs: 1500, maxDelta: .1 }, {
      name: 'invalid', appraise: async () => realismProposal('invented', 'Not from this conversation.'),
    });
    const s = store.create(scenarios[0]); c.initialize(s.id, 'adaptive');
    store.snapshot(s.id, 1, [{ itemId: 'u1', role: 'user', text: 'Hello.', order: 0, status: 'complete', transcriptFinal: true, startedAt: 1, updatedAt: 1 }]); await c.enqueue(s.id);
    expect(c.get(s.id).states).toHaveLength(1); expect(c.get(s.id).attempts[0].status).toBe('failed'); expect(c.current(s.id).realism).toBeUndefined();
  });
  it('validates configurable output and memory budgets without activating a live provider', () => {
    expect(adaptationConfig({ CHARACTER_MEMORY_CAPACITY: '4', CHARACTER_MEMORY_TEXT_LIMIT: '80', APPRAISAL_MAX_OUTPUT_TOKENS: '1800' })).toMatchObject({ provider: 'mock', memoryCapacity: 4, memoryTextLimit: 80, maxOutputTokens: 1800 });
    for (const env of [{ CHARACTER_MEMORY_CAPACITY: '0' }, { CHARACTER_MEMORY_TEXT_LIMIT: '200' }, { APPRAISAL_MAX_OUTPUT_TOKENS: '20' }]) expect(() => adaptationConfig(env)).toThrow();
  });
});
