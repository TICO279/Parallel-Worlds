import { describe, expect, it } from 'vitest';
import type { Scenario, StoredSession } from '../shared/domain';
import { isLive, latestSession, majorTurns, newestFirst, type EmberDate } from '../src/monitorData';
const session = (id: string, createdAt: number, updatedAt: number, status: StoredSession['status'] = 'closed', judgments: { turnId: string; major: boolean }[] = []) =>
  ({ schemaVersion: 1, id, scenarioId: 'ember-date:x', characterId: 'ember-date:x', status, createdAt, updatedAt, revision: 1, turns: [],
    adaptation: { judgments } }) as unknown as StoredSession;
const date = (id: string, sessions: StoredSession[]): EmberDate => ({ scenario: { id } as Scenario, sessions });
describe('date monitor', () => {
  it('follows the partner the phone touched most recently, and that date\'s newest session', () => {
    const amara = date('ember-date:amara', [session('a1', 1, 50), session('a2', 60, 70)]);
    const leo = date('ember-date:leo', [session('l1', 10, 90)]);
    expect(newestFirst([amara, leo]).map(d => d.scenario.id)).toEqual(['ember-date:leo', 'ember-date:amara']);
    expect(latestSession(amara)?.id).toBe('a2');
  });
  it('counts a connected phone as live until it goes quiet for too long', () => {
    expect(isLive(session('s', 0, 1000, 'active'), 2000)).toBe(true);
    expect(isLive(session('s', 0, 1000, 'connecting'), 2000)).toBe(true);
    expect(isLive(session('s', 0, 1000, 'closed'), 2000)).toBe(false);
    expect(isLive(session('s', 0, 1000, 'active'), 1000 + 16 * 60_000)).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });
  it('stars your lines the judge called a major shift, as tree node ids', () => {
    const stars = majorTurns([session('s1', 0, 0, 'closed', [{ turnId: 'u1', major: true }, { turnId: 'u2', major: false }]), session('s2', 0, 0)]);
    expect([...stars]).toEqual(['s1/u1']);
  });
});
