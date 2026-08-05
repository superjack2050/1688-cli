import React from 'react';

interface Props {
  submitting: boolean;
  hasDraft: boolean;
  missingCount: number;
  lastSavedAt: string;
  onSave: () => void;
  onValidate: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onAiFillAttributes?: () => void;
}

export default function OzonEditorBottomBar({
  submitting, hasDraft, missingCount, lastSavedAt,
  onSave, onValidate, onSubmit, onBack, onAiFillAttributes,
}: Props) {
  return (
    <div className="ozon-editor-bottom-bar">
      <div className="ozon-editor-bottom-left">
        {missingCount > 0 ? (
          <span className="ozon-editor-missing-summary">还有 {missingCount} 个必填字段未完成</span>
        ) : (
          <span className="ozon-editor-missing-summary ready">校验通过，可以提交 Ozon</span>
        )}
        {lastSavedAt && <span className="ozon-editor-saved-at">最近保存：{lastSavedAt}</span>}
      </div>

      <div className="ozon-editor-bottom-actions">
        <button type="button" className="glass-btn-ghost" onClick={onBack}>返回列表</button>
        <button type="button" className="glass-btn-secondary" onClick={onSave}>保存草稿</button>
        {onAiFillAttributes && (
          <button type="button" className="glass-btn-secondary" onClick={onAiFillAttributes}>AI 补全属性</button>
        )}
        <button type="button" className="glass-btn-secondary" onClick={onValidate}>校验商品</button>
        <button type="button" className="glass-btn-primary" disabled={submitting || missingCount > 0 || !hasDraft}
          style={{ background: (missingCount > 0 || !hasDraft) ? undefined : 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}
          onClick={onSubmit}>
          {submitting ? '提交中...' : '提交 Ozon'}
        </button>
      </div>
    </div>
  );
}
