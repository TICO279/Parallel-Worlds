import { z } from 'zod';
export const metricNames = ['comfort', 'trust', 'curiosity', 'engagement'] as const;
export const toneSchema = z.enum(['reserved', 'warm', 'guarded', 'playful', 'neutral', 'focused']);
const score = z.number().finite().min(0).max(1);
export const appraisalSchema = z.strictObject({
  interpretation: z.string().min(1).max(500),
  deltas: z.strictObject({ comfort: z.number().finite(), trust: z.number().finite(), curiosity: z.number().finite(), engagement: z.number().finite() }),
  tone: toneSchema, goal: z.string().min(1).max(200), guidance: z.string().min(1).max(400),
});
export type Appraisal = z.infer<typeof appraisalSchema>;
export const characterStateSchema = z.strictObject({
  id: z.string(), characterId: z.string(), sessionId: z.string(), branchId: z.literal('main'),
  version: z.number().int().nonnegative(), previousStateId: z.string().nullable(),
  lastProcessedTurnId: z.string().nullable(), lastProcessedOrder: z.number().int(), timestamp: z.number().finite(),
  comfort: score, trust: score, curiosity: score, engagement: score,
  tone: toneSchema, goal: z.string(), guidance: z.string(),
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
  provider: string; latencyMs: number; at: number; error?: string; appraisal?: Appraisal; stateVersion?: number;
  model?: string; usage?: TokenUsage;
}
export interface ApplicationRecord { version: number; at: number; status: 'acknowledged' | 'failed' | 'deferred'; }
export interface LatencyRecord {
  turnId: string; responseId?: string; speechEndedAt?: number; speechStoppedAt?: number; transcriptFinalAt?: number;
  responseCreatedAt?: number; firstAudioAt?: number; playbackStartedAt?: number;
  endToEndMs?: number; firstAudioMs?: number; transcriptDelayMs?: number; appliedStateVersion: number;
}
export interface AdaptationData {
  mode: 'static' | 'adaptive'; timingMode: 'asynchronous'; provider: string; model?: string;
  appraisalTimeoutMs: number; maxStateDelta: number;
  states: DynamicCharacterState[]; attempts: AppraisalAttempt[]; applications: ApplicationRecord[];
  latencies: LatencyRecord[]; appliedVersion: number; pending: boolean;
}
