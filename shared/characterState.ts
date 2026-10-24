import { z } from 'zod';
import { behaviorSnapshotSchema, type ResponsePlan } from './behavior';
export const metricNames = ['comfort', 'trust', 'curiosity', 'engagement'] as const;
export const toneSchema = z.enum(['reserved', 'warm', 'guarded', 'playful', 'neutral', 'focused']);
const score = z.number().finite().min(0).max(1);
export const legacyAppraisalSchema = z.strictObject({
  interpretation: z.string().min(1).max(500),
  deltas: z.strictObject({ comfort: z.number().finite(), trust: z.number().finite(), curiosity: z.number().finite(), engagement: z.number().finite() }),
  tone: toneSchema, goal: z.string().min(1).max(200), guidance: z.string().min(1).max(400),
});
export type Appraisal = z.infer<typeof legacyAppraisalSchema>;
export const evidenceSchema = z.strictObject({ turnId: z.string().min(1).max(450), quote: z.string().min(1).max(160) });
export const memoryCategorySchema = z.enum(['preference', 'claim', 'interaction', 'boundary', 'boundary_pressure', 'question', 'repair']);
export const responseBriefSchema = z.strictObject({ intent: z.string().min(1).max(160), stance: z.string().min(1).max(120),
  concern: z.string().max(160), expression: z.enum(['restrained', 'measured', 'open']),
  move: z.enum(['acknowledge', 'disclose', 'probe', 'challenge', 'deflect', 'boundary', 'change_topic', 'disengage']),
  scope: z.enum(['persistent', 'turn']), avoid: z.string().max(160) });
export const realismAppraisalSchema = legacyAppraisalSchema.extend({ schemaVersion: z.literal(2),
  event: z.enum(['neutral', 'interest', 'disclosure', 'humor', 'disagreement', 'claim', 'evidence', 'accountability', 'reciprocity', 'boundary_setting', 'boundary_pressure', 'apology', 'respectful_action']),
  evidence: z.array(evidenceSchema).min(1).max(4),
  uncertainty: z.strictObject({ level: z.enum(['low', 'medium', 'high']), reason: z.string().min(1).max(160) }),
  reaction: z.strictObject({ positive: z.string().max(160), negative: z.string().max(160), unresolved: z.string().max(160) }),
  expectation: z.strictObject({ prior: z.string().max(160), update: z.string().max(160), alternative: z.string().max(160) }),
  motives: z.strictObject({ approach: z.string().max(120), protect: z.string().max(120) }),
  brief: responseBriefSchema,
  memoryOperations: z.array(z.strictObject({ action: z.enum(['add', 'resolve']), category: memoryCategorySchema,
    text: z.string().min(1).max(160), evidence: z.array(evidenceSchema).min(1).max(3), targetId: z.string().nullable() })).max(3),
});
export type RealismAppraisal = z.infer<typeof realismAppraisalSchema>;
// Legacy provider fixtures and old exported records remain readable. Live version-2
// requests additionally require realismAppraisalSchema at the adapter boundary.
export const appraisalSchema = z.union([realismAppraisalSchema, legacyAppraisalSchema]);
export const memoryNoteSchema = z.strictObject({ id: z.string(), category: memoryCategorySchema, text: z.string().max(160),
  evidence: z.array(evidenceSchema).min(1).max(8), createdOrder: z.number().int(), updatedOrder: z.number().int(),
  status: z.enum(['active', 'resolved']), progress: z.number().int().min(0).max(2) });
export type MemoryNote = z.infer<typeof memoryNoteSchema>;
export const realismStateSchema = z.strictObject({ schemaVersion: z.literal(2), memory: z.array(memoryNoteSchema).max(32),
  assessment: realismAppraisalSchema.omit({ memoryOperations: true, deltas: true }),
  policy: z.array(z.string().max(200)).max(12), evictedMemoryIds: z.array(z.string()).max(32),
  briefTurnId: z.string(), profileVersion: z.string(), compilerVersion: z.string() });
export const characterStateSchema = z.strictObject({
  id: z.string(), characterId: z.string(), sessionId: z.string(), branchId: z.literal('main'),
  version: z.number().int().nonnegative(), previousStateId: z.string().nullable(),
  lastProcessedTurnId: z.string().nullable(), lastProcessedOrder: z.number().int(), timestamp: z.number().finite(),
  comfort: score, trust: score, curiosity: score, engagement: score,
  tone: toneSchema, goal: z.string(), guidance: z.string(),
  realism: realismStateSchema.optional(),
  behavior: behaviorSnapshotSchema.optional(),
});
export type DynamicCharacterState = z.infer<typeof characterStateSchema>;
export const tokenUsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative().safe(), outputTokens: z.number().int().nonnegative().safe(),
  totalTokens: z.number().int().nonnegative().safe(), cachedInputTokens: z.number().int().nonnegative().safe().optional(),
  reasoningTokens: z.number().int().nonnegative().safe().optional(),
}).refine(u => u.totalTokens === u.inputTokens + u.outputTokens && (u.cachedInputTokens ?? 0) <= u.inputTokens && (u.reasoningTokens ?? 0) <= u.outputTokens);
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export interface AppraisalAttempt {
  turnId: string; baseVersion: number; status: 'committed' | 'failed' | 'stale';
  provider: string; latencyMs: number; at: number; error?: string; appraisal?: Appraisal | RealismAppraisal; stateVersion?: number;
  model?: string; usage?: TokenUsage;
  validationIssues?: string[];
  schemaProfile?: string;
}
export interface ApplicationRecord { version: number; at: number; status: 'acknowledged' | 'failed' | 'deferred' | 'dispatched'; }
export interface InstructionRecord { version: number; contextHash: string; instructions: string; persistentInstructions: string;
  turnInstructions?: string; triggerTurnId?: string; at: number; compilerVersion: string; }
export interface LatencyRecord {
  inputKind?: 'text' | 'audio';
  turnId: string; responseId?: string; speechEndedAt?: number; speechStoppedAt?: number; transcriptFinalAt?: number;
  responseCreatedAt?: number; firstAudioAt?: number; playbackStartedAt?: number;
  endToEndMs?: number; firstAudioMs?: number; transcriptDelayMs?: number; appliedStateVersion: number;
  guidanceUncertain?: boolean;
}
export interface AdaptationData {
  mode: 'static' | 'adaptive'; timingMode: 'asynchronous'; provider: string; model?: string;
  appraisalTimeoutMs: number; maxStateDelta: number;
  states: DynamicCharacterState[]; attempts: AppraisalAttempt[]; applications: ApplicationRecord[];
  latencies: LatencyRecord[]; appliedVersion: number; pending: boolean;
  memoryCapacity?: number; maxOutputTokens?: number; instructionHistory?: InstructionRecord[];
  controlledText?: boolean; responsePlans?: ResponsePlan[]; profileVersion?: string;
}
