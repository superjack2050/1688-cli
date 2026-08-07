import React from 'react';
import { createPortal } from 'react-dom';
import type { OzonCategoryEntry } from '../../services/api';
import { filterTreeNodes, collectRequiredExpandedIds } from './ozonEditorUtils';
import type { CategoryTreeViewNode } from './ozonEditorUtils';

interface Props {
  open: boolean;
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
  return filterTreeNodes(nodes, q);
}

function CategoryNodeRow({ node, expandedIds, onToggleExpand, onSelectNode, level }: {
  node: CategoryTreeViewNode;
  expandedIds: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onSelectNode: (node: CategoryTreeViewNode) => void;
  level: number;
}) {
  const hasChildren = node.children.length > 0;
  const isSelectable = node.selectable;
  const expanded = expandedIds[node.id] === true;

  return (
    <>
      <div className={`ozon-category-drawer-row level-${Math.min(level, 3)}`}>
        <button type="button" className="ozon-category-drawer-toggle"
          onClick={() => hasChildren ? onToggleExpand(node.id) : onSelectNode(node)}>
          {hasChildren ? (expanded ? '▾' : '▸') : '•'}
        </button>
        <button type="button" className={`ozon-category-drawer-label ${isSelectable ? 'selectable' : ''}`}
          onClick={() => isSelectable ? onSelectNode(node) : onToggleExpand(node.id)}>
          {node.label}
        </button>
      </div>
      {hasChildren && expanded && node.children.map((child) => (
        <CategoryNodeRow key={child.id} node={child} expandedIds={expandedIds}
          onToggleExpand={onToggleExpand} onSelectNode={onSelectNode} level={level + 1} />
      ))}
    </>
  );
}

export default function OzonCategoryDrawer({
  open, currentPath, query, onQueryChange, treeNodes, treeLoading, treeMessage,
  expandedIds, onToggleExpand, onSelectNode, pendingEntry, onConfirm, onCancel, onSyncTree,
}: Props) {
  if (!open) return null;

  const visible = filterTree(treeNodes, query);
  const searching = Boolean(query.trim());
  const effectiveExpanded = searching
    ? { ...expandedIds, ...collectRequiredExpandedIds(visible) }
    : expandedIds;

  return createPortal(
    <div className="ozon-category-drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="ozon-cat-drawer-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="ozon-category-drawer">
        <div className="ozon-category-drawer-head">
          <h3 id="ozon-cat-drawer-title">选择 Ozon 类目</h3>
          <button type="button" className="ozon-category-drawer-close" onClick={onCancel}>关闭</button>
        </div>

        <div className="ozon-category-drawer-search">
          <input className="glass-input" value={query} placeholder="搜索 Ozon 类目..."
            onChange={(e) => onQueryChange(e.target.value)} />
          <button type="button" className="glass-btn-ghost ozon-category-drawer-sync-btn" onClick={onSyncTree}>
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
                expandedIds={effectiveExpanded}
                onToggleExpand={onToggleExpand}
                onSelectNode={onSelectNode} level={0} />
            ))
          )}
        </div>

        {currentPath && (
          <div className="ozon-category-drawer-current">
            当前类目：{currentPath}
          </div>
        )}
        {pendingEntry && (
          <div className="ozon-category-drawer-current">
            待确认：{pendingEntry.path || pendingEntry.keyword}
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
