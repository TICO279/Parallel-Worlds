import type { ConversationTree, ProtocolEvent, TreeNode, Turn } from './domain';
/** The tree is the source of truth; each Higgs session only replays one path of it. */
export const SEED_PREFIX = 'pwseed_';
export const emptyTree = (): ConversationTree => ({ nodes: {}, headId: null });
export function pathTo(tree: ConversationTree, id: string | null): TreeNode[] {
  const path: TreeNode[] = []; const seen = new Set<string>();
  for (let n = id ? tree.nodes[id] : undefined; n && !seen.has(n.id); n = n.parentId ? tree.nodes[n.parentId] : undefined) {
    seen.add(n.id); path.push(n);
  }
  return path.reverse();
}
export function childMap(tree: ConversationTree): Map<string | null, TreeNode[]> {
  const map = new Map<string | null, TreeNode[]>();
  for (const n of Object.values(tree.nodes)) map.set(n.parentId, [...(map.get(n.parentId) ?? []), n]);
  for (const list of map.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return map;
}
/** Rebuilds one session's chain under the node that was HEAD when it started. Idempotent, so it can run after every event. */
export function syncSession(tree: ConversationTree, baseId: string | null, sessionId: string, turns: Turn[]): ConversationTree {
  const nodes = Object.fromEntries(Object.entries(tree.nodes).filter(([, n]) => n.sessionId !== sessionId));
  let parentId = baseId;
  for (const t of turns) {
    // Speech or replies that ended without any text are not lines you can revert to or replay.
    if (!t.text && (t.status === 'incomplete' || t.status === 'interrupted')) continue;
    const id = `${sessionId}/${t.itemId}`;
    nodes[id] = { id, parentId, sessionId, role: t.role, text: t.text ?? '', status: t.status, createdAt: t.startedAt,
      ...(t.playedMs !== undefined && { playedMs: t.playedMs }), ...(t.transcriptionFailed && { transcriptionFailed: true }) };
    parentId = id;
  }
  return { nodes, headId: parentId };
}
/** Only your own lines can be reverted: the new branch starts right before what you said. */
export function revertTo(tree: ConversationTree, nodeId: string): ConversationTree {
  const n = tree.nodes[nodeId];
  return n?.role === 'user' ? { ...tree, headId: n.parentId } : tree;
}
/** Text-only replay for a fresh Higgs session: Boson skips audio content and rejects system messages. */
export function seedEvents(path: TreeNode[]): ProtocolEvent[] {
  return path.filter(n => n.text.trim()).map((n, i) => ({ type: 'conversation.item.create', item: {
    type: 'message', id: `${SEED_PREFIX}${i}`, role: n.role,
    content: [{ type: n.role === 'user' ? 'input_text' : 'text', text: n.text }] } }));
}
/** Replayed items echo back as conversation.item.added; they already live in the tree. */
export const isSeedEcho = (e: ProtocolEvent) =>
  e.type === 'conversation.item.added' && String((e.item as { id?: unknown } | undefined)?.id ?? '').startsWith(SEED_PREFIX);
