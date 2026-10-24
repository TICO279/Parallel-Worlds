import { useState } from 'react';
import type { ConversationTree, TreeNode } from '../shared/domain';
import { childMap, pathTo } from '../shared/tree';
interface Props {
  tree: ConversationTree; characterName: string; selectedId: string | null; disabled: boolean;
  onSelect(id: string | null): void; onRevert(id: string): void; onContinue(id: string): void; onClear(): void;
}
export function TreeView({ tree, characterName, selectedId, disabled, onSelect, onRevert, onContinue, onClear }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const children = childMap(tree); const onPath = new Set(pathTo(tree, tree.headId).map(n => n.id));
  const nodes = Object.values(tree.nodes);
  const branches = nodes.filter(n => !children.get(n.id)?.length).length;
  const line = (n: TreeNode) => {
    const cls = `tree-node ${n.role} ${onPath.has(n.id) ? 'on-path' : ''} ${selectedId === n.id ? 'selected' : ''}`;
    const body = <><span className="tree-role">{n.role === 'user' ? 'You' : characterName}</span>
      <span className="tree-text">{n.text || '…'}</span>{tree.headId === n.id && <span className="tree-here">you are here</span>}</>;
    // Only your own lines are selectable: the other person's reply follows from what you said.
    if (n.role !== 'user' || !n.text || disabled) return <div className={cls}>{body}</div>;
    return <>
      <button className={cls} aria-expanded={selectedId === n.id} onClick={() => onSelect(selectedId === n.id ? null : n.id)}>{body}</button>
      {selectedId === n.id && <div className="tree-revert"><button className="revert-button" onClick={() => onRevert(n.id)}>⟲ Revert to this point</button></div>}
    </>;
  };
  // Straight runs stay in one column; a fork indents each alternative under a labelled branch.
  const rows: { node: TreeNode; depth: number; label?: string }[] = [];
  const stack = [...(children.get(null) ?? [])].reverse().map(node => ({ node, depth: 0, label: undefined as string | undefined }));
  const seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!; if (seen.has(row.node.id)) continue;
    seen.add(row.node.id); rows.push(row);
    const kids = children.get(row.node.id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: row.depth + (kids.length > 1 ? 1 : 0), label: kids.length > 1 ? `Branch ${i + 1}` : undefined });
  }
  return <section className="tree-panel" aria-labelledby="tree-title">
    <div className="tree-header">
      <div><span className="eyebrow">PARALLEL WORLDS</span><h3 id="tree-title">Conversation tree · {branches} {branches === 1 ? 'branch' : 'branches'}</h3></div>
      <button className="export-button" disabled={disabled} onClick={() => { if (confirmClear) { setConfirmClear(false); onClear(); } else setConfirmClear(true); }}
        onBlur={() => setConfirmClear(false)}>{confirmClear ? 'Click again to clear' : 'Clear tree'}</button>
    </div>
    <div className="tree-scroll">
      {tree.headId === null && <div className="tree-node on-path"><span className="tree-here">you are here · before your first line</span></div>}
      {rows.map(({ node, depth, label }) => <div key={node.id} style={{ marginLeft: Math.min(depth * 14, 84) }}>
        {label && <span className="branch-label">⑂ {label}</span>}{line(node)}
        {node.status === 'interrupted' && <small className="turn-note">Interrupted reply retained for inspection; excluded from branch replay.</small>}
        {!children.get(node.id)?.length && tree.headId !== node.id && <button className="revert-button" disabled={disabled} onClick={() => onContinue(node.id)}>Use this branch</button>}
      </div>)}
    </div>
  </section>;
}
