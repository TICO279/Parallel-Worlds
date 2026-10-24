import { useState, type ReactNode } from 'react';
import type { ConversationTree, TreeNode } from '../shared/domain';
import { childMap, pathTo } from '../shared/tree';
interface Props {
  tree: ConversationTree; characterName: string; selectedId: string | null; disabled: boolean;
  onSelect(id: string | null): void; onRevert(id: string): void; onClear(): void;
}
export function TreeView({ tree, characterName, selectedId, disabled, onSelect, onRevert, onClear }: Props) {
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
  const from = (parentId: string | null): ReactNode => {
    const kids = children.get(parentId) ?? [];
    if (!kids.length) return null;
    if (kids.length === 1) return <>{line(kids[0])}{from(kids[0].id)}</>;
    return <div className="tree-fork"><span className="fork-label">⑂ Branches here · {kids.length}</span>
      {kids.map((k, i) => <div key={k.id} className={`tree-branch ${onPath.has(k.id) ? 'on-path' : ''}`}>
        <span className="branch-label">Branch {i + 1}</span>{line(k)}{from(k.id)}</div>)}</div>;
  };
  return <section className="tree-panel" aria-labelledby="tree-title">
    <div className="tree-header">
      <div><span className="eyebrow">PARALLEL WORLDS</span><h3 id="tree-title">Conversation tree · {branches} {branches === 1 ? 'branch' : 'branches'}</h3></div>
      <button className="export-button" disabled={disabled} onClick={() => { if (confirmClear) { setConfirmClear(false); onClear(); } else setConfirmClear(true); }}
        onBlur={() => setConfirmClear(false)}>{confirmClear ? 'Click again to clear' : 'Clear tree'}</button>
    </div>
    <div className="tree-scroll">
      {tree.headId === null && <div className="tree-node on-path"><span className="tree-here">you are here · before your first line</span></div>}
      {from(null)}
    </div>
  </section>;
}
