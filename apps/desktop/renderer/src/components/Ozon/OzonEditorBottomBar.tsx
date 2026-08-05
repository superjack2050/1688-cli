import React from 'react';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

interface Props {
  submitting: boolean;
  hasDraft: boolean;
  missingCount: number;
  validationState: ValidationState;
  lastSavedAt: string;
  onSave: () => void;
  onValidate: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onAiFillAttributes?: () => void;
}

export type { ValidationState };

export default function OzonEditorBottomBar({
  submitting, hasDraft, missingCount, validationState, lastSavedAt,
  onSave, onValidate, onSubmit, onBack, onAiFillAttributes,
}: Props) {
  const canSubmit = validationState === 'valid' && !submitting && hasDraft;
  const statusText =
    validationState === 'valid' ? '校验通过，可以提交 Ozon'
    : validationState === 'invalid' ? `还有 ${missingCount} 个必填字段未完成`
    : validationState === 'validating' ? '校验中...'
    : '';

  return (
    <div className="ozon-editor-bottom-bar">
      <div className="ozon-editor-bottom-left">
        {statusText && (
          <span className={`ozon-editor-missing-summary ${validationState === 'valid' ? 'ready' : validationState === 'invalid' ? 'warn' : ''}`}>
            {statusText}
          </span>
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
        <button type="button" className={`glass-btn-primary ${!canSubmit ? 'disabled' : ''}`}
          disabled={!canSubmit} onClick={onSubmit}>
          {submitting ? '提交中...' : '提交 Ozon'}
        </button>
      </div>
    </div>
  );
}
