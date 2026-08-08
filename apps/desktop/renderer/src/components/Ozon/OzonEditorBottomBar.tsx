import React, { useEffect, useRef, useState } from 'react';
import {
  deriveEditorActions,
  validationSectionLabel,
  type AttributeLoadState,
  type EditorValidationIssue,
} from './ozonEditorUtils';

type ValidationState = 'idle' | 'validating' | 'valid' | 'invalid';

interface Props {
  submitting: boolean;
  hasDraft: boolean;
  issues: EditorValidationIssue[];
  validationState: ValidationState;
  lastSavedAt: string;
  aiFilling?: boolean;
  attributeLoadState?: AttributeLoadState;
  onSave: () => void;
  onValidate: () => void;
  onSubmit: () => void;
  onBack: () => void;
  onLocateIssue: (issue: EditorValidationIssue) => void;
  onAiFillAttributes?: () => void;
  onRetryAttributes?: () => void;
}

export type { ValidationState };

export default function OzonEditorBottomBar({
  submitting, hasDraft, issues, validationState, lastSavedAt, aiFilling = false,
  attributeLoadState = 'idle', onSave, onValidate, onSubmit, onBack, onLocateIssue, onAiFillAttributes, onRetryAttributes,
}: Props) {
  // Single source of truth for all gating — the same rule the editor
  // handlers and tests use.
  const actions = deriveEditorActions({ attributeLoadState, validationState, submitting, aiFilling, hasDraft });
  const attributesError = attributeLoadState === 'error';
  const attributesLoading = attributeLoadState === 'loading';
  const attributesReady = attributeLoadState === 'ready';
  const issueCount = issues.length;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const statusWrapRef = useRef<HTMLDivElement>(null);

  const statusText =
    validationState === 'valid' ? '校验通过，可以提交 Ozon'
    : validationState === 'invalid' ? (issueCount > 0 ? `还有 ${issueCount} 项需要处理` : '校验未通过')
    : validationState === 'validating' ? '校验中...'
    : attributesError ? '类目属性加载失败，请重新加载后再保存或提交'
    : attributesLoading ? '正在加载类目属性...'
    : !attributesReady ? '类目属性尚未加载完成'
    : '';

  useEffect(() => {
    if (!popoverOpen) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (statusWrapRef.current && !statusWrapRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPopoverOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  // a revalidate that fixed everything must not leave a stale list open
  useEffect(() => {
    if (issueCount === 0) setPopoverOpen(false);
  }, [issueCount]);

  const showIssueList = validationState === 'invalid' && issueCount > 0;

  return (
    <div className="ozon-ai-edit-bottom-bar">
      <div className="ozon-ai-edit-bottom-left">
        <span className="ozon-ai-edit-hint">AI 工具：</span>
        {onAiFillAttributes && (
          <button
            type="button"
            className="ozon-ai-edit-btn-gradient"
            onClick={onAiFillAttributes}
            disabled={!actions.canAiFill}
          >
            {aiFilling ? 'AI 补全中...' : 'AI 补全属性'}
          </button>
        )}
        {attributesError && onRetryAttributes && (
          <button type="button" className="ozon-ai-edit-btn-plain" onClick={onRetryAttributes}>重新加载特征</button>
        )}
      </div>

      <div className="ozon-ai-edit-bottom-right">
        <div className="ozon-status-popover-wrap" ref={statusWrapRef}>
          {showIssueList ? (
            <button
              type="button"
              className="ozon-ai-edit-status warn clickable"
              aria-expanded={popoverOpen}
              aria-haspopup="listbox"
              onClick={() => setPopoverOpen((value) => !value)}
            >
              {statusText} ›
            </button>
          ) : statusText ? (
            <span className={`ozon-ai-edit-status ${validationState === 'valid' ? 'ready' : (validationState === 'invalid' || attributesError) ? 'warn' : ''}`}>
              {statusText}
            </span>
          ) : null}
          {popoverOpen && showIssueList && (
            <div className="ozon-issue-popover" role="dialog" aria-label="待处理问题">
              <div className="ozon-issue-popover-header">还有 {issueCount} 项需要处理，点击直接定位</div>
              <ul role="listbox" aria-label="待处理问题列表" className="ozon-issue-list">
                {issues.map((issue) => (
                  <li key={issue.id} role="option">
                    <button
                      type="button"
                      className="ozon-issue-item"
                      onClick={() => {
                        setPopoverOpen(false);
                        onLocateIssue(issue);
                      }}
                    >
                      <span className="ozon-issue-section-tag">{validationSectionLabel(issue.section)}</span>
                      <span className="ozon-issue-message">{issue.displayMessage || issue.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {lastSavedAt && <span className="ozon-ai-edit-saved-at">最近保存：{lastSavedAt}</span>}
        <button type="button" className="ozon-ai-edit-btn-plain" onClick={onBack}>取消并关闭</button>
        <button type="button" className="ozon-ai-edit-btn-secondary" onClick={onSave} disabled={!actions.canSave}>保存草稿</button>
        <button
          type="button"
          className="ozon-ai-edit-btn-secondary"
          onClick={onValidate}
          disabled={!actions.canValidate || validationState === 'validating'}
        >
          校验商品
        </button>
        <button
          type="button"
          className={`ozon-ai-edit-btn-primary ${!actions.canSubmit ? 'disabled' : ''}`}
          disabled={!actions.canSubmit}
          onClick={onSubmit}
        >
          {submitting ? '提交中...' : '提交 Ozon'}
        </button>
      </div>
    </div>
  );
}
