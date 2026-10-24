import { characterStateSchema, metricNames, realismAppraisalSchema, type DynamicCharacterState, type MemoryNote } from '../../shared/characterState';
import type { Turn } from '../../shared/domain';
import { transitionState } from './engine';

export interface EvidenceSource { turnId: string; role: 'user' | 'assistant'; text: string; order: number; }
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** One atomic, deterministic state+memory transaction. No model-generated IDs or timestamps. */
export function transitionRealism(previous: DynamicCharacterState, raw: unknown, turn: Turn, timestamp: number,
  maxDelta: number, sources: EvidenceSource[], capacity = 8, textLimit = 160): DynamicCharacterState {
  const appraisal = realismAppraisalSchema.parse(raw); const currentId = `${previous.sessionId}/${turn.itemId}`;
  const sourceMap = new Map(sources.map(s => [s.turnId, s]));
  const validate = (evidence: { turnId: string; quote: string }[]) => {
    for (const e of evidence) {
      const source = sourceMap.get(e.turnId);
      if (!source || source.order > turn.order || !source.text.includes(e.quote)) throw new Error('Appraisal evidence is not grounded in a finalized turn.');
    }
  };
  validate(appraisal.evidence);
  if (!appraisal.evidence.some(e => e.turnId === currentId)) throw new Error('Appraisal must cite the triggering user turn.');
  const memory = structuredClone(previous.realism?.memory ?? []); const policy: string[] = []; const evicted: string[] = [];
  const deltas = { ...appraisal.deltas };
  const repeated = sources.some(s => s.role === 'user' && s.order < turn.order && normalized(s.text) === normalized(turn.text!));
  if (repeated) { for (const name of metricNames) deltas[name] = Math.min(0, deltas[name]); policy.push('Repeated wording is not new positive evidence.'); }
  const pressure = appraisal.event === 'boundary_pressure' || /you owe me|ignore your boundaries|shut up|idiot/i.test(turn.text!);
  const apology = appraisal.event === 'apology' || /\b(sorry|apologi[sz]e)\b/i.test(turn.text!);
  const activePressure = memory.filter(n => n.category === 'boundary_pressure' && n.status === 'active');
  const behavioralTrust = ['evidence', 'accountability', 'reciprocity', 'respectful_action'].includes(appraisal.event);
  if (deltas.trust > 0 && (!behavioralTrust || apology || pressure || activePressure.length > 0 || appraisal.uncertainty.level === 'high')) {
    deltas.trust = 0; policy.push('Trust requires behavioral evidence; claims, apologies, high uncertainty and unresolved pressure do not restore it.');
  }
  // Only an observed change of topic/behavior can advance repair, never a promise or apology alone.
  const respectful = appraisal.event === 'respectful_action' && !pressure && !apology && !repeated &&
    /\?|\b(reading|book|sketch|project|decision|result)\b/i.test(turn.text!);
  for (const note of activePressure) if (respectful && !note.evidence.some(e => e.turnId === currentId)) {
    note.progress = Math.min(2, note.progress + 1); note.updatedOrder = turn.order;
    note.evidence = [...note.evidence, ...appraisal.evidence.filter(e => e.turnId === currentId)].slice(-8);
  }
  for (const operation of appraisal.memoryOperations) {
    validate(operation.evidence);
    if (operation.action === 'resolve') {
      const note = memory.find(n => n.id === operation.targetId && n.status === 'active');
      if (!note || note.category !== operation.category) throw new Error('Unknown or stale memory resolution.');
      if (note.category === 'boundary_pressure' && (note.progress < 2 || pressure || apology || !respectful)) {
        policy.push('Boundary concern retained: sustained respectful behavior has not been demonstrated.'); continue;
      }
      note.status = 'resolved'; note.updatedOrder = turn.order;
      note.evidence = [...note.evidence, ...operation.evidence].slice(-8); continue;
    }
    if (operation.targetId !== null || !operation.evidence.some(e => e.turnId === currentId)) throw new Error('New memory must cite this turn and use a backend-assigned ID.');
    const text = operation.text.slice(0, textLimit);
    const duplicate = memory.find(n => n.status === 'active' && n.category === operation.category &&
      (normalized(n.text) === normalized(text) || (pressure && n.category === 'boundary_pressure')));
    if (duplicate) {
      duplicate.updatedOrder = turn.order;
      duplicate.evidence = [...duplicate.evidence, ...operation.evidence].filter((e, i, all) => all.findIndex(a => a.turnId === e.turnId && a.quote === e.quote) === i).slice(-8);
      if (pressure && duplicate.category === 'boundary_pressure') duplicate.progress = 0;
      continue;
    }
    if (memory.length >= capacity) {
      const priority = (n: MemoryNote) => ['boundary', 'question'].includes(n.category) ? 1 : 0;
      const candidates = memory.filter(n => !(n.category === 'boundary_pressure' && n.status === 'active'))
        .sort((a, b) => Number(a.status !== 'resolved') - Number(b.status !== 'resolved') || priority(a) - priority(b) || a.updatedOrder - b.updatedOrder);
      if (!candidates.length) { policy.push('Memory capacity reached; active boundary concerns were preserved.'); continue; }
      const victim = candidates[0]; memory.splice(memory.indexOf(victim), 1); evicted.push(victim.id);
    }
    memory.push({ id: `${previous.sessionId}:memory:${previous.version + 1}:${memory.length}:${appraisal.memoryOperations.indexOf(operation)}`,
      category: operation.category, text, evidence: operation.evidence, status: 'active', progress: 0, createdOrder: turn.order, updatedOrder: turn.order });
  }
  // Pressure cannot be forgotten simply because the model omitted a memory operation.
  if (pressure && !memory.some(n => n.category === 'boundary_pressure' && n.status === 'active')) {
    const note: MemoryNote = { id: `${previous.sessionId}:memory:${previous.version + 1}:boundary`, category: 'boundary_pressure',
      text: 'Pressure to override the character’s boundaries remains unresolved.'.slice(0, textLimit), evidence: appraisal.evidence.filter(e => e.turnId === currentId),
      createdOrder: turn.order, updatedOrder: turn.order, progress: 0, status: 'active' };
    if (memory.length >= capacity) {
      const victim = memory.filter(n => n.category !== 'boundary_pressure' || n.status === 'resolved')
        .sort((a, b) => Number(a.status !== 'resolved') - Number(b.status !== 'resolved') ||
          Number(['boundary', 'question'].includes(a.category)) - Number(['boundary', 'question'].includes(b.category)) || a.updatedOrder - b.updatedOrder)[0];
      if (victim) { memory.splice(memory.indexOf(victim), 1); evicted.push(victim.id); }
    }
    if (memory.length < capacity) memory.push(note);
  }
  if (pressure) for (const note of memory.filter(n => n.category === 'boundary_pressure' && n.status === 'active')) note.progress = 0;
  const next = transitionState(previous, { ...appraisal, deltas }, turn, previous.version, timestamp, maxDelta);
  const { memoryOperations: _operations, deltas: _deltas, ...assessment } = appraisal;
  return Object.freeze(characterStateSchema.parse({ ...next, realism: { schemaVersion: 2, memory, assessment,
    policy: [...new Set(policy)].slice(0, 12), evictedMemoryIds: evicted, briefTurnId: currentId,
    profileVersion: 'realism-1', compilerVersion: 'realism-1' } }));
}
