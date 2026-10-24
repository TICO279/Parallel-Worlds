import { createHash } from 'node:crypto';
import { behaviorSnapshotSchema, type ActingContract, type BehaviorSnapshot } from '../../shared/behavior';
import type { Character } from '../../shared/domain';
import type { DynamicCharacterState } from '../../shared/characterState';
import { boundaryPressure } from './constraints';
const bounded = (n: number) => Number(Math.max(0, Math.min(1, n)).toFixed(6));
/** Independent keyed draws: retries/polling never advance a mutable global PRNG. */
export function behaviorDraw(seed: string, namespace: string, ordinal: number) {
  return createHash('sha256').update(JSON.stringify(['agency-1', seed, namespace, ordinal])).digest().readUInt32BE(0) / 0x100000000;
}
export function initialBehavior(character: Character, seed: string, variation = 0): BehaviorSnapshot {
  const p = character.behavior ?? { directness: .6, initiative: .4, positiveExpressiveness: .3, investment: .5 };
  const offset = (name: string) => (behaviorDraw(seed, name, 0) - .5) * variation * .3;
  return behaviorSnapshotSchema.parse({ schemaVersion: 1, policyVersion: 'agency-1', seed, variation, ordinal: 0, investment: p.investment,
    disposition: { directness: bounded(p.directness + offset('directness')), initiative: bounded(p.initiative + offset('initiative')),
      positiveExpressiveness: bounded(p.positiveExpressiveness + offset('expression')) }, history: [] });
}
/** All observations come from the validated state. Randomness changes action choice, never evidence/scores. */
export function decideBehavior(character: Character, state: DynamicCharacterState, text: string, previous: BehaviorSnapshot): BehaviorSnapshot {
  const qualifiedTurn = `${state.sessionId}/${state.lastProcessedTurnId}`;
  if (previous.decision?.turnId === qualifiedTurn) throw new Error('Behavior decision already committed for this turn.');
  const a = state.realism?.assessment; const event = a?.event ?? 'neutral';
  const boundary = boundaryPressure(text, event, state.realism?.memory.some(n => n.category === 'boundary_pressure' && n.status === 'active') ?? false);
  const userBoundary = event === 'boundary_setting'; const interview = character.id === 'morgan';
  const clubConflict = !interview && /\b(?:i|we)\s+(?:love|like|enjoy|prefer)\s+(?:loud\s+)?(?:night)?clubs\b/i.test(text);
  const assumedAgreement = !interview && /\b(?:just agree with me|you (?:must|have to|obviously) agree|(?:we(?:'re| are)|you and i are) (?:a )?perfect (?:match|couple)|(?:tell me|say) (?:that )?i(?:'m| am) right)\b/i.test(text);
  const explicitPreferenceConflict = clubConflict || assumedAgreement;
  const question = /\?|^(what|why|how|can|could|tell|do|does|is|are)\b/i.test(text.trim());
  // A normal question is participation, not evidence deserving an endorsement.
  const supported = ['evidence', 'accountability'].includes(event) && a?.uncertainty.level !== 'high';
  let evasions = event === 'claim' ? 1 : 0;
  if (event === 'claim') for (const prior of [...previous.history].reverse()) { if (prior.event !== 'claim') break; evasions++; }
  // No penalty for ordinary small talk, nervousness, transcription failure or a single short answer.
  const investment = bounded(previous.investment + (interview && event === 'claim' && evasions > 1 ? -.06 : event === 'reciprocity' || event === 'respectful_action' ? .005 : 0));
  const proposals: { action: ActingContract['action']; score: number; reason: string; eligible: boolean }[] = [
    { action: 'acknowledge', score: (event === 'neutral' && !question) || userBoundary ? 5 : event === 'interest' && !question ? (investment < .3 ? 4.8 : 4.4) : 3.5, reason: 'An ordinary exchange or stated limit does not need conversational rescue.', eligible: !boundary && !explicitPreferenceConflict },
    { action: 'answer', score: question || ['interest', 'reciprocity', 'disclosure', 'humor'].includes(event) ? 5 : 4.4, reason: 'Answer or disclose selectively without inventing shared interests.', eligible: !boundary && !userBoundary && !(interview && event === 'claim') && !explicitPreferenceConflict },
    { action: 'disagree', score: 6, reason: clubConflict ? 'Keep the authored quiet-place preference rather than mirroring loud-club enthusiasm.' : 'Assumed agreement or compatibility has not been established.', eligible: explicitPreferenceConflict && !boundary && !userBoundary },
    { action: 'probe', score: interview && event === 'claim' ? 5.5 : supported ? 4.8 : 4.4, reason: 'Seek a relevant missing detail; at most one question.', eligible: !boundary && !userBoundary && !explicitPreferenceConflict && (interview && ['claim', 'evidence', 'accountability'].includes(event) || event === 'interest' && !question && investment > .3) },
    { action: 'challenge', score: evasions > 1 ? 5.7 : 5.1, reason: 'Name the missing personal ownership without praising the unsupported claim.', eligible: interview && event === 'claim' && !boundary && !userBoundary },
    { action: 'boundary', score: 8, reason: 'Maintain the explicit boundary without rewarding pressure.', eligible: boundary },
    { action: 'credit', score: 4.9, reason: 'A specific reported decision may merit a factual acknowledgement, retaining uncertainty and any unresolved gap.', eligible: supported && !boundary && !userBoundary && !explicitPreferenceConflict },
  ];
  for (const p of proposals) if (p.eligible && previous.history.slice(-2).every(h => h.action === p.action) && previous.history.length >= 2)
    p.score -= .2; // small repetition cost, never overrides a boundary or grounded eligibility
  const eligible = proposals.filter(p => p.eligible).sort((a,b) => b.score-a.score || a.action.localeCompare(b.action));
  if (!eligible.length) throw new Error('No eligible character action.');
  const plausible = eligible.filter(p => p.score >= eligible[0].score - .75);
  const ordinal = previous.ordinal + 1; const draw = behaviorDraw(previous.seed, 'action', ordinal);
  let selected = plausible[0];
  if (previous.variation > 0 && plausible.length > 1) {
    const weights = plausible.map(p => Math.exp((p.score - plausible[0].score) / previous.variation));
    let remaining = draw * weights.reduce((s,n) => s+n,0);
    for (let i=0;i<plausible.length;i++) { remaining -= weights[i]; if (remaining <= 0) { selected = plausible[i]; break; } }
  }
  const objectives: Record<ActingContract['action'], string> = {
    acknowledge: userBoundary ? 'Respect the user’s stated limit without demanding an explanation or praising it. A brief acknowledgement is enough.' : 'Briefly acknowledge the ordinary remark. Do not rescue it with praise, an invented topic or a compulsory question.',
    answer: 'Answer the current user directly, with your own specific perspective. Keep shared interests and intimacy unassumed. A statement can end without a question.',
    disagree: clubConflict ? 'State that you prefer quieter places and do not enjoy loud clubs. Do not criticize their taste or pretend to share it.' : 'Reject the assumption of agreement or romantic compatibility directly. Do not offer a reassuring yes, invent a shared preference or soften the disagreement into assent.',
    probe: interview ? 'Ask for one concrete decision, tradeoff or missing piece of evidence. Withhold unsupported approval; use the current question and already supplied detail.' : 'Ask one relevant follow-up about the offered interest, without assuming you share it or manufacturing compatibility.',
    challenge: 'Identify what the answer still fails to establish about personal ownership or reasoning. Request a specific revision without a praise sandwich or personal attack.',
    boundary: 'Decline the pressure firmly and briefly. Do not apologize, thank them for the demand, offer intimacy or add a rescue question.',
    credit: 'Acknowledge only the specific supported decision in factual language. Do not add a compliment, general approval or reassurance. Keep reported outcomes unverified and state any material remaining gap.',
  };
  const contract: ActingContract = { action: selected.action, objective: objectives[selected.action], endorsement: selected.action === 'credit' ? 'specific-evidence' : 'none',
    maxQuestions: selected.action === 'probe' || selected.action === 'challenge' ? 1 : 0, maxSentences: selected.action === 'acknowledge' ? 1 : 3,
    delivery: previous.disposition.directness > .7 ? 'level, direct, professional and matter-of-fact' : 'understated, calm and conversational; no forced enthusiasm' };
  return behaviorSnapshotSchema.parse({ ...previous, ordinal, investment,
    history: [...previous.history, { turnId: state.realism?.briefTurnId ?? `${state.sessionId}/${state.lastProcessedTurnId}`, action: selected.action, event }].slice(-8),
    decision: { turnId: qualifiedTurn, ordinal, draw, action: selected.action, candidates: proposals, contract } });
}
