import { relationshipNames, type DynamicCharacterState, type Relationship, type RelationshipName } from '../../shared/characterState';
import type { Character, Turn } from '../../shared/domain';

/**
 * Relationship indicators.
 *
 * Slow layer (0–1): comfort, trust, interest, respect, closeness. Every user line nudges them a little;
 * a major emotional shift moves them a lot. Fast layer: tension (0–1) spikes on hurtful moments and halves
 * about every three user lines; warmth (−1…1) follows the recent direction of the conversation.
 *
 * Nudges come from the decision model as expected scores in −2…+2 per indicator.
 */
export const RELATIONSHIP_RULES = {
  /** Change per unit of nudge on an ordinary line, and the cap per line. */
  smallStep: 0.025, smallCap: 0.05,
  /** Change per unit of nudge on a major shift, and the cap per line. */
  bigStep: 0.06, bigCap: 0.15,
  /** Losses weigh more than gains. */
  negativity: 1.5,
  /** Trust only rises when the line shows trustworthy behaviour with at least this probability. */
  behaviorGate: 0.5,
  /** Closeness only rises once comfort and trust are both at least this high. */
  closenessGate: 0.5,
  /** Tension multiplier per user line (0.794³ ≈ 0.5: halves every three lines). */
  tensionDecay: 0.794,
} as const;
export const NEGATIVE_EVENTS: ReadonlySet<string> = new Set(['insult', 'offensive_joke', 'hostility', 'boundary_pressure']);

export function initialRelationship(character: Character): Relationship {
  // Alex starts as a reserved stranger on a first date; Morgan starts professionally at ease.
  return character.id === 'alex'
    ? { comfort: 0.35, trust: 0.4, interest: 0.55, respect: 0.5, closeness: 0.1, tension: 0, warmth: 0.1 }
    : { comfort: 0.6, trust: 0.5, interest: 0.5, respect: 0.5, closeness: 0.05, tension: 0, warmth: 0.1 };
}

const round = (n: number) => Number(n.toFixed(6));
/** Gains shrink near 1 and losses shrink near 0, so extremes are hard to reach and never overshoot. */
function soft(value: number, delta: number) {
  return round(Math.min(1, Math.max(0, value + (delta >= 0 ? delta * (1 - value) : delta * value))));
}

export interface RelationshipUpdate {
  nudges: Record<RelationshipName, number>; behavior: number; event: string; major: boolean; turnId: string;
  /** P(major shift): an insult that is not "major" still raises tension in proportion. */
  majorShift?: number;
}
export function updateRelationship(previous: Relationship, update: RelationshipUpdate): Relationship {
  const r = RELATIONSHIP_RULES;
  const [step, cap] = update.major ? [r.bigStep, r.bigCap] : [r.smallStep, r.smallCap];
  const next: Relationship = { ...previous };
  for (const name of relationshipNames) {
    let delta = (Number.isFinite(update.nudges[name]) ? update.nudges[name] : 0) * step;
    if (delta < 0) delta *= r.negativity;
    if (name === 'trust' && delta > 0 && update.behavior < r.behaviorGate) delta = 0;
    if (name === 'closeness' && delta > 0 && (previous.comfort < r.closenessGate || previous.trust < r.closenessGate)) delta = 0;
    next[name] = soft(previous[name], Math.max(-cap, Math.min(cap, delta)));
  }
  const negative = NEGATIVE_EVENTS.has(update.event);
  let tension = previous.tension * r.tensionDecay;
  if (negative) tension = update.major ? Math.max(tension, 0.8) : Math.max(tension, Math.min(0.79, 0.3 + 0.5 * (update.majorShift ?? 0)));
  next.tension = round(Math.min(1, Math.max(0, tension)));
  const mean = relationshipNames.reduce((sum, n) => sum + (update.nudges[n] ?? 0), 0) / relationshipNames.length;
  next.warmth = round(Math.min(1, Math.max(-1, previous.warmth * 0.7 + 0.3 * (mean / 2) - (negative ? 0.2 : 0))));
  if (update.major || negative) next.lastShift = { event: update.event, turnId: update.turnId, major: update.major };
  return next;
}

/** A new state version that only advances the relationship (ordinary lines; no DeepSeek appraisal). */
export function relationshipTransition(previous: DynamicCharacterState, relationship: Relationship, turn: Turn, timestamp: number): DynamicCharacterState {
  if (turn.order <= previous.lastProcessedOrder || turn.itemId === previous.lastProcessedTurnId) throw new Error('Stale or duplicate relationship update.');
  const version = previous.version + 1;
  return Object.freeze({ ...previous, id: `${previous.sessionId}:main:${version}`, version, previousStateId: previous.id,
    lastProcessedTurnId: turn.itemId, lastProcessedOrder: turn.order, timestamp, relationship });
}

const band = (v: number) => v < 0.35 ? 'low' : v < 0.65 ? 'medium' : 'high';
/** Words, not numbers, for Higgs: bands only change occasionally, so instructions stay stable. */
export function describeRelationship(r: Relationship): string {
  const slow = relationshipNames.map(n => `${n} ${band(r[n])}`).join(', ');
  const tension = r.tension >= 0.5 ? `high, still affected by the user's ${r.lastShift?.event.replace(/_/g, ' ') ?? 'recent remark'}`
    : r.tension >= 0.2 ? 'lingering' : 'none';
  const warmth = r.warmth > 0.25 ? 'warm' : r.warmth < -0.25 ? 'cool' : 'neutral';
  return `Relationship so far (bands, not exact numbers): ${slow}. Current tension: ${tension}. Current warmth: ${warmth}. ` +
    'Let these shape how open, trusting and close you are; do not state them aloud.';
}

/**
 * Voice emotion under the current mood. Jev picks what fits the words; a tense or warm mood then reweights
 * its probabilities so the voice carries the feeling, not just the sentence. Weights blend in from tension 0.25
 * (none) to 0.6 (full) or as warmth falls from −0.1 to −0.4, and from warmth 0.3 to 0.8 for the warm side. "Expressive" adds TTS 3's expressive_high.
 */
// Anger leads: it is the negative emotion TTS 3 voices render most audibly; bitterness barely differs from neutral.
const TENSE_WEIGHTS: Record<string, number> = { anger: 3, bitterness: 1.2, disgust: 1.3, sadness: 1.4, fear: 1.1, determination: 0.7, contemplation: 0.8,
  confusion: 0.8, surprise: 0.8, shame: 0.8, helplessness: 0.9, neutral: 0.5 };
const WARM_WEIGHTS: Record<string, number> = { affection: 1.5, amusement: 1.4, contentment: 1.3, enthusiasm: 1.3, elation: 1.2, relief: 1.1,
  anger: 0.4, bitterness: 0.4, disgust: 0.4, sadness: 0.6, neutral: 0.8 };
export const NEGATIVE_VOICE: ReadonlySet<string> = new Set(['anger', 'bitterness', 'disgust', 'sadness', 'fear']);
const ANGER_LIKE: ReadonlySet<string> = new Set(['bitterness', 'disgust']);
export function chooseVoiceEmotion(probabilities: Record<string, number>, mood: Relationship) {
  const ranked = Object.entries(probabilities).sort((x, y) => y[1] - x[1]);
  const jev = ranked[0] ?? ['neutral', 0];
  // Tension (an unresolved hurt) or a cool mood (warmth below −0.1) both push the voice toward negative emotions.
  const tense = Math.min(1, Math.max(0, (mood.tension - 0.25) / 0.35, (-mood.warmth - 0.1) / 0.3)); const warm = Math.min(1, Math.max(0, (mood.warmth - 0.3) / 0.5));
  const weight = (e: string) => tense > 0 ? 1 + ((TENSE_WEIGHTS[e] ?? 0.25) - 1) * tense : warm > 0 ? 1 + ((WARM_WEIGHTS[e] ?? 1) - 1) * warm : 1;
  // Clearly tense: bitterness and disgust are voiced as anger (their probability joins anger's), so the hurt is audible.
  const candidates = tense < 0.6 ? ranked : Object.entries(ranked.reduce<Record<string, number>>((all, [e, p]) => {
    const key = ANGER_LIKE.has(e) ? 'anger' : e; all[key] = (all[key] ?? 0) + p; return all;
  }, {}));
  const [emotion, probability] = candidates.reduce((best, cur) => cur[1] * weight(cur[0]) > best[1] * weight(best[0]) ? cur : best, candidates[0] ?? jev);
  return { emotion, probability, jevChoice: jev[0], jevProbability: jev[1], expressive: NEGATIVE_VOICE.has(emotion) && tense >= 0.6 };
}
