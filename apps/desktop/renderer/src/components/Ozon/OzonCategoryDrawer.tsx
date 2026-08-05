import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { OzonCategoryEntry } from '../../../services/api';

interface CategoryTreeViewNode {
  id: string;
  label: string;
  path: string;
  depth: number;
  descriptionCategoryId: number;
  typeId: number;
  selectable: boolean;
  children: CategoryTreeViewNode[];
}

interface Props {
  open: boolean;
  title?: string;
  currentPath?: string;
  query: string;
  onQueryChange: (value: string) => void;
  treeNodes: CategoryTreeViewNode[];
  treeLoading: boolean;
  treeMessage: string;
  expandedIds: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onSelectNode: (node: CategoryTreeViewNode) => void;
  pendingEntry: OzonCategoryEntry | null;
  onConfirm: () => void;
  onCancel: () => void;
  onSyncTree: () => void;
}

function filterTree(nodes: CategoryTreeViewNode[], q: string): CategoryTreeViewNode[] {
  if (!q.trim()) return nodes;
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result: CategoryTreeViewNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, q);
    const selfMatch = tokens.every((t) =>
      [node.label, node.path, String(node.descriptionCategoryId), String(node.typeId)]
        .join(' ').toLowerCase().includes(t),
    );
    if (selfMatch || children.length) {
      result.push({ ...node, children });
    }
  }
  return result;
}

function CategoryNodeRow({ node, expanded, onToggle, onSelect, level }: {
  node: CategoryTreeViewNode; expanded: boolean; onToggle: (id: string) => void; onSelect: (node: CategoryTreeViewNode) => void; level: number;
}) {
  const hasChildren = node.children.length > 0;
  const isSelectable = node.selectable;
  return (
    <>
      <div className={`ozon-category-drawer-row level-${Math.min(level, 3)}`} style={{ paddingLeft: level * 20 + 8 }}>
        <button type="button" className="ozon-category-drawer-toggle"
          onClick={() => hasChildren ? onToggle(node.id) : onSelect(node)}>
          {hasChildren ? (expanded ? '▾' : '▸') : '•'}
        </button>
        <button type="button" className={`ozon-category-drawer-label ${isSelectable ? 'selectable' : ''}`}
          onClick={() => isSelectable ? onSelect(node) : onToggle(node.id)}>
          {node.label}
        </button>
      </div>
      {hasChildren && expanded && node.children.map((child) => (
        <CategoryNodeRow key={child.id} node={child} expanded={!!expanded} onToggle={onToggle} onSelect={onSelect} level={level + 1} />
      ))}
    </>
  );
}

export default function OzonCategoryDrawer({
  open, currentPath, query, onQueryChange, treeNodes, treeLoading, treeMessage,
  expandedIds, onToggleExpand, onSelectNode, pendingEntry, onConfirm, onCancel, onSyncTree,
}: Props) {
  const [localExpanded, setLocalExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { setLocalExpanded(expandedIds); }, [expandedIds]);

  if (!open) return null;

  const visible = filterTree(treeNodes, query);

  return createPortal(
    <div className="ozon-category-drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="ozon-cat-drawer-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="ozon-category-drawer">
        <div className="ozon-category-drawer-head">
          <h3 id="ozon-cat-drawer-title">选择 Ozon 类目</h3>
          <button type="button" className="ozon-category-drawer-close" onClick={onCancel}>✕</button>
        </div>

        <div className="ozon-category-drawer-search">
          <input className="glass-input" value={query} placeholder="搜索 Ozon 类目..."
            onChange={(e) => onQueryChange(e.target.value)} />
          <button type="button" className="glass-btn-ghost" onClick={onSyncTree} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            同步最新类目
          </button>
        </div>

        {treeMessage && <p className="ozon-category-drawer-msg">{treeMessage}</p>}

        <div className="ozon-category-drawer-body">
          {treeLoading ? (
            <p className="ozon-category-drawer-msg">正在加载类目…</p>
          ) : visible.length === 0 ? (
            <p className="ozon-category-drawer-msg">未找到匹配的类目</p>
          ) : (
            visible.map((node) => (
              <CategoryNodeRow key={node.id} node={node}
                expanded={localExpanded[node.id] || false}
                onToggle={(id) => setLocalExpanded((prev) => ({ ...prev, [id]: !prev[id] }))}
                onSelect={onSelectNode} level={0} />
            ))
          )}
        </div>

        {pendingEntry && (
          <div className="ozon-category-drawer-current">
            当前选择：{pendingEntry.path || pendingEntry.keyword}
          </div>
        )}

        <div className="ozon-category-drawer-actions">
          <button type="button" className="glass-btn-ghost" onClick={onCancel}>取消</button>
          <button type="button" className="glass-btn-primary" onClick={onConfirm} disabled={!pendingEntry}>
            确定选择
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
