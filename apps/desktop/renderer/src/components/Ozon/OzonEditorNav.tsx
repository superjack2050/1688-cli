import React from 'react';

type EditorSectionId = 'main' | 'attributes' | 'variants';

const NAV_ITEMS: { id: EditorSectionId; label: string }[] = [
  { id: 'main', label: '主要信息' },
  { id: 'attributes', label: '产品属性' },
  { id: 'variants', label: '变体设置' },
];

interface Props {
  activeSection: EditorSectionId;
  missingCounts: Record<EditorSectionId, number>;
  onNavigate: (id: EditorSectionId) => void;
}

export type { EditorSectionId };

export { NAV_ITEMS };

export default function OzonEditorNav({ activeSection, missingCounts, onNavigate }: Props) {
  return (
    <nav className="ozon-ai-edit-nav-list">
      {NAV_ITEMS.map((item) => {
        const badge = missingCounts[item.id] || 0;
        return (
          <button
            key={item.id}
            type="button"
            className={`ozon-ai-edit-nav-item ${activeSection === item.id ? 'active' : ''}`}
            aria-current={activeSection === item.id ? 'true' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span>{item.label}</span>
            {badge > 0 && <span className="ozon-ai-edit-nav-badge">{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
