import React from 'react';
import type { AttributeLoadState } from './ozonEditorUtils';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

interface Props {
  submitting: boolean;
  hasDraft: boolean;
  missingCount: number;
  validationState: ValidationState;
  lastSavedAt: string;
  aiFilling?: boolean;
  attributeLoadState?: AttributeLoadState;
  onSave: () => void;
  onValidate: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onAiFillAttributes?: () => void;
  onRetryAttributes?: () => void;
}

export type { ValidationState };

export default function OzonEditorBottomBar({
  submitting, hasDraft, missingCount, validationState, lastSavedAt, aiFilling,
  attributeLoadState = 'idle', onSave, onValidate, onSubmit, onBack, onAiFillAttributes, onRetryAttributes,
}: Props) {
  const attributesReady = attributeLoadState === 'ready';
  const attributesError = attributeLoadState === 'error';
  const attributesLoading = attributeLoadState === 'loading';
  const busy = submitting;
  const canSave = attributesReady && !busy && hasDraft;
  const canValidate = canSave;
  const canSubmit = canSave && validationState === 'valid';
  const canAiFill = attributesReady && !aiFilling;
  const statusText =
    validationState === 'valid' ? '校验通过，可以提交 Ozon'
    : validationState === 'invalid' ? `还有 ${missingCount} 个必填字段未完成`
    : validationState === 'validating' ? '校验中...'
    : attributesError ? '类目属性加载失败，请重新加载后再保存或提交'
    : attributesLoading ? '正在加载类目属性...'
    : !attributesReady ? '类目属性尚未加载完成'
    : '';

  return (
    <div className="ozon-ai-edit-bottom-bar">
      <div className="ozon-ai-edit-bottom-left">
        <span className="ozon-ai-edit-hint">AI 工具：</span>
        {onAiFillAttributes && (
          <button
            type="button"
            className="ozon-ai-edit-btn-gradient"
            onClick={onAiFillAttributes}
            disabled={!canAiFill}
          >
            {aiFilling ? 'AI 补全中...' : 'AI 补全属性'}
          </button>
        )}
        {attributesError && onRetryAttributes && (
          <button type="button" className="ozon-ai-edit-btn-plain" onClick={onRetryAttributes}>重新加载特征</button>
        )}
      </div>

      <div className="ozon-ai-edit-bottom-right">
        {statusText && (
          <span className={`ozon-ai-edit-status ${validationState === 'valid' ? 'ready' : (validationState === 'invalid' || attributesError) ? 'warn' : ''}`}>
            {statusText}
          </span>
        )}
        {lastSavedAt && <span className="ozon-ai-edit-saved-at">最近保存：{lastSavedAt}</span>}
        <button type="button" className="ozon-ai-edit-btn-plain" onClick={onBack}>取消并关闭</button>
        <button type="button" className="ozon-ai-edit-btn-secondary" onClick={onSave} disabled={!canSave}>保存草稿</button>
        <button
          type="button"
          className="ozon-ai-edit-btn-secondary"
          onClick={onValidate}
          disabled={!canValidate || validationState === 'validating'}
        >
          校验商品
        </button>
        <button
          type="button"
          className={`ozon-ai-edit-btn-primary ${!canSubmit ? 'disabled' : ''}`}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {submitting ? '提交中...' : '提交 Ozon'}
        </button>
      </div>
    </div>
  );
}
