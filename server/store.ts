import { randomUUID } from 'node:crypto';
import type { Scenario, StoredSession, Turn } from '../shared/domain';
import type { CompletedTurnListener } from './orchestrator';
import { ApiError } from './higgs';
import type { AdaptationData } from '../shared/characterState';
const fail = () => { throw new ApiError(400, 'Invalid conversation snapshot.'); };
/** Explicit allowlist prevents credentials or arbitrary protocol payloads entering exports. */
export function parseTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw) || raw.length > 2000) return fail();
  const ids = new Set<string>();
  return raw.map((t, order) => {
    if (!t || typeof t !== 'object' || typeof t.itemId !== 'string' || !t.itemId || t.itemId.length > 200 || ids.has(t.itemId) ||
      !['user', 'assistant'].includes(t.role) || !(t.text === null || typeof t.text === 'string' && t.text.length <= 100000) ||
      typeof t.transcriptFinal !== 'boolean' || !['pending', 'streaming', 'complete', 'interrupted', 'incomplete'].includes(t.status) ||
      !Number.isFinite(t.startedAt) || !Number.isFinite(t.updatedAt) ||
      (t.previousItemId !== undefined && t.previousItemId !== null && typeof t.previousItemId !== 'string') ||
      (t.responseId !== undefined && typeof t.responseId !== 'string') ||
      (t.playedMs !== undefined && (!Number.isFinite(t.playedMs) || t.playedMs < 0))) return fail();
    ids.add(t.itemId);
    return { itemId: t.itemId, role: t.role, text: t.text, transcriptFinal: t.transcriptFinal,
      status: t.status, order, startedAt: t.startedAt, updatedAt: t.updatedAt,
      ...(t.responseId !== undefined && { responseId: t.responseId }),
      ...(t.previousItemId !== undefined && { previousItemId: t.previousItemId }),
      ...(Number.isFinite(t.completedAt) && { completedAt: t.completedAt }),
      ...(t.playedMs !== undefined && { playedMs: t.playedMs }),
      ...(t.transcriptionFailed === true && { transcriptionFailed: true }),
    } as Turn;
  });
}
export class ConversationStore {
  private sessions = new Map<string, StoredSession>();
  private notified = new Set<string>();
  private listeners: CompletedTurnListener[] = [];
  constructor(private completed?: CompletedTurnListener) {}
  subscribe(listener: CompletedTurnListener) { this.listeners.push(listener); }
  setAdaptation(id: string, data: AdaptationData) {
    const session = this.sessions.get(id);
    if (!session) throw new ApiError(404, 'Session not found.');
    session.adaptation = structuredClone(data); session.updatedAt = Date.now();
  }
  create(scenario: Scenario): StoredSession {
    const now = Date.now(); const s: StoredSession = { schemaVersion: 1, id: randomUUID(), scenarioId: scenario.id,
      characterId: scenario.character.id, status: 'connecting', createdAt: now, updatedAt: now, revision: 0, turns: [] };
    this.sessions.set(s.id, s); return structuredClone(s);
  }
  get(id: string): StoredSession {
    const s = this.sessions.get(id); if (!s) throw new ApiError(404, 'Session not found. The backend may have restarted.');
    return structuredClone(s);
  }
  lifecycle(id: string, raw: unknown): StoredSession {
    const s = this.get(id); const b = raw as Record<string, unknown>;
    if (!b || !['connecting', 'active', 'closed', 'error'].includes(String(b.status)) ||
      (b.bosonSessionId !== undefined && (typeof b.bosonSessionId !== 'string' || b.bosonSessionId.length > 200)))
      throw new ApiError(400, 'Invalid session lifecycle.');
    // A late active notification cannot resurrect a closed session.
    if (!(['closed', 'error'].includes(s.status) && b.status === 'active')) s.status = b.status as StoredSession['status'];
    if (typeof b.bosonSessionId === 'string') s.bosonSessionId = b.bosonSessionId;
    s.updatedAt = Date.now(); this.sessions.set(id, s); return structuredClone(s);
  }
  snapshot(id: string, revision: unknown, raw: unknown): StoredSession {
    const s = this.get(id);
    if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new ApiError(400, 'Invalid revision.');
    const turns = parseTurns(raw);
    if (Number(revision) <= s.revision) return s; // retries and older requests are idempotent
    s.revision = Number(revision); s.turns = turns; s.updatedAt = Date.now(); this.sessions.set(id, s);
    for (const t of turns) {
      const key = `${id}:${t.itemId}`;
      if (t.transcriptFinal && !this.notified.has(key)) {
        this.notified.add(key);
        try { this.completed?.(id, Object.freeze(structuredClone(t))); } catch { /* observers never break recording */ }
        for (const listener of this.listeners) {
          try { listener(id, Object.freeze(structuredClone(t))); } catch { /* async observers handle their own failures */ }
        }
      }
    }
    return structuredClone(s);
  }
}
