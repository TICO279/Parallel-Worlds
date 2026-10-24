import { describe, expect, it } from 'vitest';
import type { StoredSession, Turn } from '../shared/domain';
import { childMap, emptyTree, isSeedEcho, pathTo, revertTo, seedEvents, syncSession, treeFromSessions } from '../shared/tree';
const turn = (itemId: string, role: Turn['role'], text: string | null, startedAt: number, status: Turn['status'] = 'complete'): Turn =>
  ({ itemId, role, text, transcriptFinal: status === 'complete', status, order: 0, startedAt, updatedAt: startedAt });
const texts = (tree: ReturnType<typeof emptyTree>) => pathTo(tree, tree.headId).map(n => n.text);
// "How are you?" "Not bad." "I'm good as well." "Glad to hear that."
const first = [turn('u1', 'user', 'How are you?', 1), turn('a1', 'assistant', 'Not bad.', 2),
  turn('u2', 'user', "I'm good as well.", 3), turn('a2', 'assistant', 'Glad to hear that.', 4)];
describe('conversation tree', () => {
  it('chains a session under its base and is idempotent across repeated syncs', () => {
    const once = syncSession(emptyTree(), null, 's1', first);
    expect(syncSession(once, null, 's1', first)).toEqual(once);
    expect(texts(once)).toEqual(['How are you?', 'Not bad.', "I'm good as well.", 'Glad to hear that.']);
  });
  it('reverting your line starts a sibling branch from the line before it', () => {
    const tree = syncSession(emptyTree(), null, 's1', first);
    const mine = pathTo(tree, tree.headId)[2];
    const reverted = revertTo(tree, mine.id);
    expect(texts(reverted)).toEqual(['How are you?', 'Not bad.']);
    const base = reverted.headId;
    const branched = syncSession(reverted, base, 's2', [turn('u3', 'user', 'What did you do today?', 10), turn('a3', 'assistant', 'Golfing.', 11)]);
    expect(texts(branched)).toEqual(['How are you?', 'Not bad.', 'What did you do today?', 'Golfing.']);
    expect(childMap(branched).get(base)?.map(n => n.text)).toEqual(["I'm good as well.", 'What did you do today?']);
    expect(Object.keys(branched.nodes)).toHaveLength(6);
  });
  it("cannot revert the other person's line", () => {
    const tree = syncSession(emptyTree(), null, 's1', first);
    expect(revertTo(tree, pathTo(tree, tree.headId)[1].id)).toBe(tree);
  });
  it('reverting your first line leaves an empty path that still keeps the old branch', () => {
    const tree = syncSession(emptyTree(), null, 's1', first);
    const reverted = revertTo(tree, pathTo(tree, tree.headId)[0].id);
    expect(reverted.headId).toBeNull(); expect(Object.keys(reverted.nodes)).toHaveLength(4);
  });
  it('drops turns that ended without text but keeps in-progress placeholders', () => {
    const tree = syncSession(emptyTree(), null, 's1', [turn('u1', 'user', null, 1, 'incomplete'), turn('a1', 'assistant', '', 2, 'interrupted'),
      turn('u2', 'user', null, 3, 'pending')]);
    expect(pathTo(tree, tree.headId).map(n => n.status)).toEqual(['pending']);
  });
  it('replays a path as text items Boson accepts and recognizes their echoes', () => {
    const tree = syncSession(emptyTree(), null, 's1', [...first.slice(0, 2), turn('u9', 'user', null, 5, 'pending')]);
    const events = seedEvents(pathTo(tree, tree.headId));
    expect(events).toEqual([
      { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_0', role: 'user', content: [{ type: 'input_text', text: 'How are you?' }] } },
      { type: 'conversation.item.create', item: { type: 'message', id: 'pwseed_1', role: 'assistant', content: [{ type: 'text', text: 'Not bad.' }] } },
    ]);
    expect(isSeedEcho({ type: 'conversation.item.added', item: { id: 'pwseed_1' } })).toBe(true);
    expect(isSeedEcho({ type: 'conversation.item.added', item: { id: 'item_live' } })).toBe(false);
  });
  it('rebuilds the phone\'s branches from server sessions, newest branch as HEAD', () => {
    const session = (id: string, createdAt: number, turns: Turn[], history: string[] = []) => ({ schemaVersion: 1, id, scenarioId: 'ember-date:amara',
      characterId: 'ember-date:amara', status: 'closed', createdAt, updatedAt: createdAt, revision: 1, turns,
      branch: history.length ? { history: history.map(nodeId => ({ nodeId, sessionId: 's1', itemId: nodeId.slice(3), role: 'user', text: 'x' })) } : undefined }) as StoredSession;
    // s2 rewound to just after her first reply and said something else.
    const tree = treeFromSessions([session('s2', 2, [turn('u9', 'user', 'Actually, tell me about you.', 5)], ['s1/u1', 's1/a1']), session('s1', 1, first)]);
    expect(texts(tree)).toEqual(['How are you?', 'Not bad.', 'Actually, tell me about you.']);
    expect(childMap(tree).get('s1/a1')?.map(n => n.text)).toEqual(["I'm good as well.", 'Actually, tell me about you.']);
  });
});
