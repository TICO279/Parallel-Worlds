import type { ConversationTree } from '../shared/domain';
const KEY = 'parallel-worlds.trees.v1';
/** Trees stay in this browser. Storage can be unavailable (private windows), so failures fall back to memory only. */
export function loadTrees(): Record<string, ConversationTree> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
export function saveTrees(trees: Record<string, ConversationTree>): void {
  try { localStorage.setItem(KEY, JSON.stringify(trees)); } catch { /* memory only */ }
}
