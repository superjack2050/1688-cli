import React from 'react';

type EditorSectionId = 'main' | 'attributes' | 'variants' | 'media' | 'other';

const NAV_ITEMS: { id: EditorSectionId; label: string }[] = [
  { id: 'main', label: '主要信息' },
  { id: 'attributes', label: '产品属性' },
  { id: 'variants', label: '变体设置' },
  { id: 'media', label: '媒体信息' },
  { id: 'other', label: '其他' },
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
    <nav className="ozon-editor-nav">
      {NAV_ITEMS.map((item) => {
        const badge = missingCounts[item.id] || 0;
        return (
          <button
            key={item.id}
            type="button"
            className={`ozon-editor-nav-item ${activeSection === item.id ? 'active' : ''}`}
            aria-current={activeSection === item.id ? 'true' : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <span>{item.label}</span>
            {badge > 0 && <span className="ozon-editor-nav-badge">{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
