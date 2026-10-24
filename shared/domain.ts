export type TurnStatus = 'pending' | 'streaming' | 'complete' | 'interrupted' | 'incomplete';
export interface CharacterState { guidance?: string; }
export interface Character {
  id: string; name: string; description: string; traits: string[];
  values: string[]; motivation: string; goals: string[]; boundaries: string[]; speakingStyle: string; voice: string;
  realism?: { version: string; preferences: string[]; priorities: string[]; sensitivities: string[]; conflictingMotives: string[]; disagreementStyle: string };
}
export interface Scenario { id: string; title: string; setting: string; character: Character; /** Profile photo path (Ember partners). */ image?: string; }
export interface SessionSpec { instructions: string; voice: string; language: string; }
export interface Turn {
  itemId: string; responseId?: string; previousItemId?: string | null;
  role: 'user' | 'assistant'; text: string | null; transcriptFinal: boolean;
  transcriptionFailed?: boolean; status: TurnStatus; order: number;
  startedAt: number; updatedAt: number; completedAt?: number; playedMs?: number;
  branchId?: string; parentBranchId?: string; forkTurnId?: string; characterStateSnapshot?: CharacterState;
}
export interface Conversation { order: string[]; items: Record<string, Turn>; seen: Record<string, true>; discarded?: Record<string, true>; }
/** One line in the rehearsal tree. Siblings are alternative branches from the same point. */
export interface TreeNode {
  id: string; parentId: string | null; sessionId: string; role: 'user' | 'assistant';
  text: string; status: TurnStatus; createdAt: number; playedMs?: number; transcriptionFailed?: boolean;
  itemId?: string; stateAfter?: DynamicCharacterState;
}
export interface ConversationTree { nodes: Record<string, TreeNode>; headId: string | null; }
export interface BranchHistoryItem { nodeId: string; sessionId: string; itemId: string; role: 'user' | 'assistant'; text: string; }
export interface BranchContext {
  history: BranchHistoryItem[];
  restoredFrom?: { sessionId: string; turnId: string; stateVersion: number };
  notice?: string;
}
export type SessionStatus = 'connecting' | 'active' | 'closed' | 'error';
export interface StoredSession {
  schemaVersion: 1; id: string; bosonSessionId?: string; scenarioId: string; characterId: string;
  createdAt: number; updatedAt: number; status: SessionStatus; revision: number; turns: Turn[];
  adaptation?: AdaptationData;
  branch?: BranchContext;
}
export interface ProtocolEvent { type: string; event_id?: string; [key: string]: unknown; }
export interface SessionBootstrap {
  session: StoredSession; config: ProtocolEvent; credential: { value: string; expires_at: number };
}
import type { AdaptationData, DynamicCharacterState } from './characterState';
