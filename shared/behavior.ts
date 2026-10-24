import { z } from 'zod';
export const behaviorActionSchema = z.enum(['acknowledge', 'answer', 'disagree', 'probe', 'challenge', 'boundary', 'credit']);
export const actingContractSchema = z.strictObject({ action: behaviorActionSchema, objective: z.string().min(1).max(400),
  endorsement: z.enum(['none', 'specific-evidence']), maxQuestions: z.number().int().min(0).max(1),
  maxSentences: z.number().int().min(1).max(4), delivery: z.string().min(1).max(160) });
export type ActingContract = z.infer<typeof actingContractSchema>;
const unit = z.number().finite().min(0).max(1);
export const behaviorSnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), policyVersion: z.literal('agency-1'),
  seed: z.string().min(1).max(128), variation: unit, ordinal: z.number().int().nonnegative(), investment: unit,
  disposition: z.strictObject({ directness: unit, initiative: unit, positiveExpressiveness: unit }),
  history: z.array(z.strictObject({ turnId: z.string(), action: behaviorActionSchema, event: z.string().max(40).optional() })).max(8),
  decision: z.strictObject({ turnId: z.string(), ordinal: z.number().int().positive(), draw: unit, action: behaviorActionSchema,
    candidates: z.array(z.strictObject({ action: behaviorActionSchema, score: z.number().finite(), reason: z.string(), eligible: z.boolean() })).max(7),
    contract: actingContractSchema }).optional() });
export type BehaviorSnapshot = z.infer<typeof behaviorSnapshotSchema>;
export interface ResponsePlan {
  id: string; sessionId: string; turnId: string; stateVersion: number; contextHash: string; instructions: string; persistentInstructions: string;
  createdAt: number; expiresAt: number; contract: ActingContract; policyVersion: string;
  status: 'prepared' | 'dispatched' | 'created' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
  events: { status: ResponsePlan['status']; at: number; responseId?: string }[];
}
