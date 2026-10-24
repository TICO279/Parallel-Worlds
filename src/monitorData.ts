import type { Scenario, StoredSession } from '../shared/domain';
/** One partner's dates as the server recorded them (GET /api/ember/dates). */
export interface EmberDate { scenario: Scenario; sessions: StoredSession[] }
/** A phone that vanished without saying goodbye stops counting as live after this long. */
const STALE_MS = 15 * 60_000;
export const lastActivity = (date: EmberDate) => Math.max(0, ...date.sessions.map(s => s.updatedAt));
export const newestFirst = (dates: EmberDate[]) => [...dates].sort((a, b) => lastActivity(b) - lastActivity(a));
export const latestSession = (date: EmberDate) => [...date.sessions].sort((a, b) => a.createdAt - b.createdAt).at(-1);
export const isLive = (session: StoredSession | undefined, now = Date.now()) =>
  (session?.status === 'connecting' || session?.status === 'active') && now - session.updatedAt < STALE_MS;
/** Tree node ids of your lines the judge called a major shift (the phone's ★). */
export function majorTurns(sessions: StoredSession[]): Set<string> {
  return new Set(sessions.flatMap(s => (s.adaptation?.judgments ?? []).filter(j => j.major).map(j => `${s.id}/${j.turnId}`)));
}
