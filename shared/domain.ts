export type TurnStatus = 'pending' | 'streaming' | 'complete' | 'interrupted' | 'incomplete';
export interface CharacterState { guidance?: string; }
export interface Character {
  id: string; name: string; description: string; traits: string[];
  values: string[]; motivation: string; speakingStyle: string; voice: string;
}
export interface Scenario { id: string; title: string; setting: string; character: Character; }
export interface SessionSpec { instructions: string; voice: string; language: string; }
export interface Turn {
  itemId: string; responseId?: string; previousItemId?: string | null;
  role: 'user' | 'assistant'; text: string | null; transcriptFinal: boolean;
  transcriptionFailed?: boolean; status: TurnStatus; order: number;
  startedAt: number; updatedAt: number; completedAt?: number; playedMs?: number;
  branchId?: string; parentBranchId?: string; forkTurnId?: string; characterStateSnapshot?: CharacterState;
}
export interface Conversation { order: string[]; items: Record<string, Turn>; seen: Record<string, true>; }
export type SessionStatus = 'connecting' | 'active' | 'closed' | 'error';
export interface StoredSession {
  schemaVersion: 1; id: string; bosonSessionId?: string; scenarioId: string; characterId: string;
  createdAt: number; updatedAt: number; status: SessionStatus; revision: number; turns: Turn[];
}
export interface ProtocolEvent { type: string; event_id?: string; [key: string]: unknown; }
export interface SessionBootstrap {
  session: StoredSession; config: ProtocolEvent; credential: { value: string; expires_at: number };
}
