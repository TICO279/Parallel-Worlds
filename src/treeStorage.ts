import type { ConversationTree } from '../shared/domain';
import { z } from 'zod';
import { characterStateSchema } from '../shared/characterState';
const KEY = 'parallel-worlds.trees.v1';
const nodeSchema = z.object({ id: z.string().min(1), itemId: z.string().optional(), parentId: z.string().nullable(),
  sessionId: z.string().min(1), role: z.enum(['user', 'assistant']), text: z.string(),
  status: z.enum(['pending', 'streaming', 'complete', 'interrupted', 'incomplete']), createdAt: z.number().finite(),
  playedMs: z.number().finite().nonnegative().optional(), transcriptionFailed: z.boolean().optional(), stateAfter: characterStateSchema.optional() });
const treeSchema = z.object({ nodes: z.record(z.string(), nodeSchema), headId: z.string().nullable() });
export function parseSavedTree(raw: unknown): ConversationTree | null {
  const parsed = treeSchema.safeParse(raw); if (!parsed.success) return null;
  const tree = parsed.data;
  if (tree.headId !== null && !Object.hasOwn(tree.nodes, tree.headId)) return null;
  const complete = new Set<string>();
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (id !== node.id || (node.parentId !== null && !Object.hasOwn(tree.nodes, node.parentId))) return null;
    if (node.stateAfter && (node.role !== 'user' || node.stateAfter.sessionId !== node.sessionId)) return null;
    const visiting = new Set<string>(); let current: string | null = id;
    while (current !== null && !complete.has(current)) {
      if (visiting.has(current)) return null;
      visiting.add(current); current = tree.nodes[current]?.parentId ?? null;
    }
    for (const item of visiting) complete.add(item);
  }
  return tree;
}
/** Trees stay in this browser. Storage can be unavailable (private windows), so failures fall back to memory only. */
export function loadTrees(key = KEY): Record<string, ConversationTree> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([scenario, value]) => {
      const tree = parseSavedTree(value); return tree ? [[scenario, tree]] : [];
    }));
  } catch { return {}; }
}
export function saveTrees(trees: Record<string, ConversationTree>, key = KEY): boolean {
  try { localStorage.setItem(key, JSON.stringify(trees)); return true; } catch { return false; }
}
