import { z } from 'zod';
import type { BranchContext, BranchHistoryItem, Scenario, Turn } from '../shared/domain';
import { ConversationStore } from './store';
import { ApiError } from './higgs';
import type { DynamicCharacterState } from '../shared/characterState';

const historySchema = z.array(z.strictObject({ nodeId: z.string().min(1).max(450), sessionId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200), role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(100000) })).max(2000);
export function prepareBranch(raw: unknown, scenario: Scenario, store: ConversationStore, adaptive: boolean): {
  branch?: BranchContext; restored?: DynamicCharacterState;
} {
  if (raw === undefined) return {};
  const result = historySchema.safeParse(raw);
  if (!result.success || new Set(result.data.map(n => n.nodeId)).size !== result.data.length) throw new ApiError(400, 'Invalid branch history.');
  const history = result.data;
  if (!history.length) return {};
  // Restore only from authoritative server snapshots, never client-provided scores.
  let restored: DynamicCharacterState | undefined; let restoredFrom: BranchContext['restoredFrom'];
  let latestUserFound = false; let unavailable = false;
  for (const entry of [...history].reverse()) {
    try {
      const source = store.get(entry.sessionId);
      if (source.scenarioId !== scenario.id) throw new ApiError(400, 'Branch history belongs to a different scenario.');
      const original = source.turns.find(t => t.itemId === entry.itemId);
      if (!original || original.role !== entry.role || original.text?.trim() !== entry.text || original.status !== 'complete') throw new ApiError(400, 'Branch history does not match its recorded turn.');
      if (entry.role !== 'user') continue;
      const state = source.adaptation?.states.filter(s => s.lastProcessedOrder <= original.order).at(-1);
      if (!latestUserFound && state) { restored = state; restoredFrom = { sessionId: source.id, turnId: entry.itemId, stateVersion: state.version }; }
      if (!latestUserFound && !state && source.adaptation?.mode === 'adaptive') unavailable = true;
      latestUserFound = true;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      if (entry.role === 'user') { if (!latestUserFound) unavailable = true; latestUserFound = true; }
    }
  }
  const notice = adaptive && (unavailable || !restored) ? 'Dialogue replayed, but the saved character checkpoint is unavailable or was not appraised. Character scores start from their initial values.' : undefined;
  return { branch: { history, ...(adaptive && restoredFrom && { restoredFrom }), ...(notice && { notice }) }, ...(adaptive && restored && { restored }) };
}
export function branchTurns(history: BranchHistoryItem[] = []): Turn[] {
  return history.map((n, i) => ({ itemId: n.nodeId, role: n.role, text: n.text, order: i - history.length,
    transcriptFinal: true, status: 'complete', startedAt: 0, updatedAt: 0 }));
}
