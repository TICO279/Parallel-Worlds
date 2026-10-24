import { z } from 'zod';
import { scenarioFromPartner } from './partner';
export const reviewTurnSchema = z.strictObject({ nodeId: z.string().min(1).max(450), role: z.enum(['user', 'assistant']), text: z.string().min(1).max(2000) });
export const datingReviewRequestSchema = z.strictObject({ scenarioId: z.string().max(100), partner: z.record(z.string(), z.string().max(2000)).optional(), turns: z.array(reviewTurnSchema).min(2).max(60) }).refine(data => data.scenarioId === 'alex-first-date' || (data.partner && scenarioFromPartner(data.partner)?.id === data.scenarioId), 'Review partner must match the conversation.');
const evidence = { nodeId: z.string().min(1).max(450), quote: z.string().min(1).max(240), explanation: z.string().min(1).max(500) };
export const datingReviewSchema = z.strictObject({
  strength: z.strictObject({ ...evidence, title: z.string().min(1).max(100) }).nullable(),
  suggestions: z.array(z.strictObject({ ...evidence, title: z.string().min(1).max(100), alternative: z.string().min(1).max(350) })).max(3),
});
export type DatingReview = z.infer<typeof datingReviewSchema>;
export type ReviewTurn = z.infer<typeof reviewTurnSchema>;
/** Quotes and targets must belong to the submitted branch, never an invented or assistant turn. */
export function validateDatingReview(raw: unknown, turns: ReviewTurn[]): DatingReview {
  const result = datingReviewSchema.parse(raw);
  const ids = new Set(turns.map(t => t.nodeId));
  if (ids.size !== turns.length) throw new Error('Duplicate turn IDs.');
  for (const item of [result.strength, ...result.suggestions]) {
    if (!item) continue;
    const turn = turns.find(t => t.nodeId === item.nodeId);
    if (!turn || turn.role !== 'user' || !turn.text.includes(item.quote)) throw new Error('Review evidence does not match a user turn.');
  }
  return result;
}
