import { z } from 'zod';
import type { DynamicCharacterState } from './characterState';
import type { Scenario, StoredSession, Turn } from './domain';

export const idSchema = z.string().min(1).max(450);
export const revisionSchema = z.number().int().nonnegative().safe();
export const conversationInput = z.strictObject({ scenarioId: idSchema });
export const forkInput = z.strictObject({ sourceBranchId: idSchema, targetUserTurnId: idSchema, expectedSourceRevision: revisionSchema });
export const restoreInput = z.strictObject({ branchId: idSchema, expectedConversationRevision: revisionSchema, expectedActiveEpoch: revisionSchema });
export const restoreEvent = z.strictObject({ attemptId: idSchema, status: z.enum(['ready', 'failed']), prefixHash: z.string().length(64) });
export interface DurableConversation {
  schemaVersion: 1; id: string; scenario: Scenario; createdAt: number; revision: number;
  rootBranchId: string; activeBranchId: string; activeEpoch: number;
}
export interface DurableBranch {
  schemaVersion: 1; id: string; conversationId: string; parentBranchId: string | null;
  forkTurnId: string | null; parentRevision: number | null; characterId: string; createdAt: number;
  revision: number; turnIds: string[]; initialCheckpointId: string; checkpointId: string;
}
export interface DurableTurn { id: string; sessionId: string; branchId: string; turn: Turn; checkpointId?: string; }
export interface Attachment {
  sessionId: string; owner: string; conversationId: string; branchId: string; epoch: number;
  baseTurnIds: string[]; restoreId: string; status: 'preparing' | 'active' | 'closed';
}
export interface Restoration {
  schemaVersion: 1; id: string; conversationId: string; branchId: string; branchRevision: number;
  previousBranchId: string; expectedConversationRevision: number; epoch: number;
  prefixHash: string; checkpointId: string; status: 'prepared' | 'connecting' | 'ready' | 'failed';
  createdAt: number; expiresAt: number; attemptId?: string; sessionId?: string;
}
export interface TimelineNode {
  id: string; role: Turn['role']; text: string | null; status: Turn['status']; rewindable: boolean; reason?: string;
}
export interface Timeline { schemaVersion: 1; branchId: string; revision: number; nodes: TimelineNode[]; nextCursor: number | null; }
export interface RestoreQualification {
  protocolVersion: 'restore-1'; contextQualified: boolean; testedAt: string | null;
  preForkRecall: boolean; postForkAbsent: boolean; noDuplicateQuestion: boolean; noUnsolicitedResponse: boolean;
  physicalMicrophoneTested: boolean;
  scenarioHashes?: Record<string,string>;
}
export const restoreQualificationSchema=z.strictObject({protocolVersion:z.literal('restore-1'),contextQualified:z.boolean(),testedAt:z.string().max(60).nullable(),
  preForkRecall:z.boolean(),postForkAbsent:z.boolean(),noDuplicateQuestion:z.boolean(),noUnsolicitedResponse:z.boolean(),physicalMicrophoneTested:z.boolean(),
  scenarioHashes:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/)).optional()});
export const unqualifiedRestore: RestoreQualification = { protocolVersion: 'restore-1', contextQualified: false,
  testedAt: null, preForkRecall: false, postForkAbsent: false, noDuplicateQuestion: false,
  noUnsolicitedResponse: false, physicalMicrophoneTested: false };
export interface DurableBootstrap {
  session: StoredSession; config: import('./domain').ProtocolEvent;
  credential: { value: string; expires_at: number };
  restoration: Restoration; attachment: Attachment; history: import('./domain').BranchHistoryItem[];
}
export interface Checkpoint { id: string; state: DynamicCharacterState; }
export interface Phase { id: string; label: string; startTurnId: string; endTurnId: string; turnIds: string[]; }
