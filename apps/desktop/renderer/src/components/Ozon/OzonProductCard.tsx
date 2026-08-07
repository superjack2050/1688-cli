import React, { useEffect, useState } from 'react';
import type { OzonListingTask, OzonListingTaskStatus } from '../Results/ozonListing/types';

export type OzonProductStatusGroup = 'draft' | 'success' | 'processing' | 'manual' | 'failed';

type Props = {
  task: OzonListingTask;
  onInspect: (task: OzonListingTask) => void;
  onCopyDraft?: (task: OzonListingTask) => void;
  onBackTo1688?: () => void;
};

export function isOzonTaskProcessingStatus(status: OzonListingTaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'waiting_deep_collect' ||
    status === 'deep_collecting' ||
    status === 'generating_draft' ||
    status === 'import_pending'
  );
}

export function isOzonTaskFailedStatus(status: OzonListingTaskStatus): boolean {
  return status === 'failed' || status === 'deep_failed' || status === 'submit_failed';
}

export function isOzonTaskImportedStatus(status: OzonListingTaskStatus): boolean {
  return status === 'imported' || status === 'listing_ready';
}

export function statusGroupOf(status: OzonListingTaskStatus): OzonProductStatusGroup {
  if (status === 'draft_ready') return 'draft';
  if (isOzonTaskImportedStatus(status)) return 'success';
  if (status === 'needs_manual') return 'manual';
  if (isOzonTaskFailedStatus(status)) return 'failed';
  return 'processing';
}

export function statusLabelOf(status: OzonListingTaskStatus): string {
  const map: Record<OzonListingTaskStatus, string> = {
    queued: '排队中',
    waiting_deep_collect: '等待深采',
    deep_collecting: '深采中',
    generating_draft: '生成中',
    draft_ready: '草稿已生成',
    import_pending: '导入中',
    imported: '已导入',
    listing_ready: '链路完成',
    needs_manual: '需人工补充',
    deep_failed: '深采失败',
    failed: '失败',
    submit_failed: '提交失败',
  };
  return map[status];
}

function firstRow(task: OzonListingTask): Record<string, unknown> {
  const row = task.draft?.sourceRows?.[0];
  return row && typeof row === 'object' && !Array.isArray(row) ? row : {};
}

function firstItem(task: OzonListingTask): Record<string, unknown> {
  const item = task.draft?.items?.[0];
  return item && typeof item === 'object' && !Array.isArray(item) ? item : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export default function OzonProductCard({ task, onInspect, onCopyDraft }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const statusGroup = statusGroupOf(task.status);
  const title = task.title || text(firstRow(task).product_title) || text(firstItem(task).name) || task.offerId || '未命名商品';

  useEffect(() => {
    setImageFailed(false);
  }, [task.image]);

  return (
    <article
      className={`ozon-product-card ozon-product-card--${statusGroup}`}
      onClick={() => onInspect(task)}
      title={title}
    >
      <div className="ozon-product-card-image-wrap">
        {task.image && !imageFailed ? (
          <img className="ozon-product-card-img" src={task.image} alt="" onError={() => setImageFailed(true)} />
        ) : (
          <div className="ozon-product-card-img placeholder">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <rect x="9" y="10" width="30" height="28" rx="8" fill="rgba(219,234,254,0.78)" />
              <path d="M16 29l7-7 5 5 3-3 6 6" fill="none" stroke="rgba(37,99,235,0.58)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="18" cy="18" r="3" fill="rgba(37,99,235,0.45)" />
            </svg>
            <span>{task.image ? '图片加载失败' : '暂无图片'}</span>
          </div>
        )}
        <span className={`ozon-product-card-status-badge ozon-product-card-status-badge--${statusGroup}`}>
          {statusLabelOf(task.status)}
        </span>
      </div>

      <div className="ozon-product-card-body">
        <h3 className="ozon-product-card-title">{title}</h3>

        <div className="ozon-product-card-actions">
          <button type="button" className="ozon-product-card-btn ozon-product-card-btn--inspect"
            onClick={(event) => { event.stopPropagation(); onInspect(task); }}>
            {task.status === 'draft_ready' ? '编辑并提交' : '查看详情'}
          </button>
          {task.draft && onCopyDraft && (
            <button type="button" className="ozon-product-card-btn ozon-product-card-btn--copy"
              onClick={(event) => { event.stopPropagation(); onCopyDraft(task); }}>
              复制 Payload
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
