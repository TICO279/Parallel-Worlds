import { appraisalSchema, characterStateSchema, metricNames, type DynamicCharacterState } from '../../shared/characterState';
import type { Character, Turn } from '../../shared/domain';
export function initialState(character: Character, sessionId: string, timestamp: number): DynamicCharacterState {
  const alex = character.id === 'alex';
  return characterStateSchema.parse({ id: `${sessionId}:main:0`, characterId: character.id, sessionId, branchId: 'main',
    version: 0, previousStateId: null, lastProcessedTurnId: null, lastProcessedOrder: -1, timestamp,
    comfort: alex ? .35 : .60, trust: alex ? .40 : .50, curiosity: alex ? .65 : .50, engagement: alex ? .60 : .70,
    tone: alex ? 'reserved' : 'focused', goal: character.goals[0], guidance: '' });
}
/** Pure transition: caller supplies time and expected version; the model supplies no IDs. */
export function transitionState(previous: DynamicCharacterState, raw: unknown, turn: Turn,
  expectedVersion: number, timestamp: number, maxDelta: number): DynamicCharacterState {
  characterStateSchema.parse(previous);
  if (previous.version !== expectedVersion || turn.itemId === previous.lastProcessedTurnId || turn.order <= previous.lastProcessedOrder)
    throw new Error('Stale or duplicate state transition.');
  if (turn.role !== 'user' || !turn.transcriptFinal || turn.status !== 'complete' || !turn.text?.trim()) throw new Error('A finalized user turn is required.');
  if (!Number.isFinite(maxDelta) || maxDelta < 0 || maxDelta > 1) throw new Error('Invalid state delta limit.');
  const appraisal = appraisalSchema.parse(raw); const version = previous.version + 1;
  const next = { ...previous, id: `${previous.sessionId}:main:${version}`, version, previousStateId: previous.id,
    lastProcessedTurnId: turn.itemId, lastProcessedOrder: turn.order, timestamp,
    tone: appraisal.tone, goal: appraisal.goal, guidance: appraisal.guidance };
  for (const name of metricNames) next[name] = Number(Math.min(1, Math.max(0,
    previous[name] + Math.max(-maxDelta, Math.min(maxDelta, appraisal.deltas[name])))).toFixed(6));
  return Object.freeze(characterStateSchema.parse(next));
}
