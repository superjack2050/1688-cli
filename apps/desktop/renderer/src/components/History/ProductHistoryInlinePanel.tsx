import React, { useState, useRef } from 'react';
import { getApi } from '../../services/api';
import OfferDetailModal from '../Results/OfferDetailModal';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';
import { useDeepCollectQueue } from '../Results/deepCollect/useDeepCollectQueue';
import { useOzonListingQueue } from '../Results/ozonListing/useOzonListingQueue';
import type { OzonListingTask } from '../Results/ozonListing/types';

interface ProductItem {
  offerId: string;
  title: string;
  price: string;
  image: string;
  url: string;
  collectedAt: string;
  raw?: unknown;
}

interface Props {
  items: ProductItem[];
  ozonTasks?: OzonListingTask[];
  onRefresh?: () => void;
  activeProfile?: string;
  /** External overrides — used when ResultRenderer is mounted (shared session), ignored otherwise */
  batchDeepCollect?: (items: ProgressOfferCardItem[]) => void;
  batchOzonListing?: (items: ProgressOfferCardItem[]) => void;
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.title === 'string') return obj.title;
    if (obj.min != null && obj.max != null && obj.min !== obj.max) return `¥${obj.min}-${obj.max}`;
    if (obj.min != null) return `¥${obj.min}`;
    if (obj.price != null) return textOf(obj.price);
    if (obj.value != null) return textOf(obj.value);
  }
  return '';
}

function hasDeepCollectData(item: ProductItem): boolean {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : {};
  if (raw.deepCollected === true) return true;
  if (raw.deepCollectStatus === 'success') return true;
  if (raw.status === 'deep-success') return true;
  if (raw.deepOffer && typeof raw.deepOffer === 'object') return true;
  if (raw.deep && typeof raw.deep === 'object') return true;
  if (Array.isArray(raw.skus) && raw.skus.length > 0) return true;
  if (Array.isArray(raw.attributes) && raw.attributes.length > 0) return true;
  if (Array.isArray(raw.priceTiers) && raw.priceTiers.length > 0) return true;
  if (raw.saledCount != null) return true;
  if (raw.freight && typeof raw.freight === 'object') {
    const f = raw.freight as Record<string, unknown>;
    if (f.receiveAddress || f.unitWeight || f.province || f.city) return true;
  }
  return false;
}

function isGeneratedStatus(status: string): boolean {
  return ['generating_draft', 'draft_ready', 'needs_manual', 'import_pending', 'imported', 'listing_ready', 'submit_failed'].includes(status);
}

function hasGeneratedDraft(item: ProductItem, ozonTasks: OzonListingTask[] = []): boolean {
  const offerId = textOf(item.offerId);
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : {};
  if (raw.ozonDraftGenerated === true) return true;
  if (raw.draftGenerated === true) return true;
  if (raw.ozonDraftId || raw.draftId) return true;
  if (!offerId) return false;
  return ozonTasks.some((task) => {
    if (task.offerId !== offerId) return false;
    return isGeneratedStatus(task.status);
  });
}

function deepRawOf(item: ProductItem): Record<string, unknown> {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : {};
  if (raw.deepOffer && typeof raw.deepOffer === 'object') {
    return { ...raw, ...(raw.deepOffer as Record<string, unknown>), deepCollected: true, deepCollectStatus: 'success' };
  }
  if (raw.deep && typeof raw.deep === 'object') {
    return { ...raw, ...(raw.deep as Record<string, unknown>), deepCollected: true, deepCollectStatus: 'success' };
  }
  return raw;
}

function toOfferCardItem(p: ProductItem): ProgressOfferCardItem {
  const raw = deepRawOf(p);
  const deepReady = hasDeepCollectData(p);
  return {
    slotIndex: 0,
    offerId: textOf(p.offerId),
    title: textOf(raw.title) || textOf(p.title),
    price: textOf(raw.priceText) || textOf(raw.priceRange) || textOf(p.price),
    image: textOf(raw.mainImage) || textOf(p.image),
    status: deepReady ? 'deep-success' : 'basic-ready',
    raw: { ...p, ...raw, offerId: textOf(p.offerId), url: textOf(raw.url) || textOf(p.url) },
  };
}

const HISTORY_SESSION_KEY = 'history-panel';

export default function ProductHistoryInlinePanel({ items, ozonTasks, onRefresh, activeProfile, batchDeepCollect: extBatchDeepCollect, batchOzonListing: extBatchOzonListing }: Props) {
  const [selected, setSelected] = useState<ProductItem | null>(null);
  const [selectedOfferIds, setSelectedOfferIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState('');
  const showToast = (msg: string, timeout = 1800) => {
    setToast(msg);
    setTimeout(() => setToast(''), timeout);
  };

  const api = getApi();
  const profile = activeProfile || 'default';

  // Local deep-collect hooks so batch buttons work even when ResultRenderer isn't mounted
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ProgressOfferCardItem>>>({});
  const [deepJsonByOfferId, setDeepJsonByOfferId] = useState<Record<string, Record<string, unknown>>>({});
  const [deepFailuresByOfferId, setDeepFailuresByOfferId] = useState<Record<string, Record<string, unknown>>>({});

  const onDeepCollectDataPatchRef = useRef((patch: { offerId?: string; deep?: Record<string, unknown> }) => {
    if (patch.deep && patch.offerId) {
      const deep = patch.deep;
      const deepImages = Array.isArray(deep.images) ? deep.images as string[] : [];
      api.productHistory.add([{
        ...deep,
        offerId: patch.offerId,
        title: deep.title || deep.productTitle,
        image: deep.mainImage || deepImages[0] || deep.image,
        price: deep.priceText || deep.priceRange,
        url: deep.url,
        deepCollected: true,
        deepCollectStatus: 'success',
        deepOffer: deep,
      }], { sourceCommand: 'deepCollect', profile })
        .then(() => onRefresh?.())
        .catch(() => {});
    }
  });

  const { enqueueMultipleDeepCollect: localEnqueueDeep } = useDeepCollectQueue({
    sessionKey: HISTORY_SESSION_KEY,
    api,
    activeProfile: profile,
    onDeepCollectDataPatch: onDeepCollectDataPatchRef.current,
    cardOverrides,
    setCardOverrides,
    setDeepJsonByOfferId,
    setDeepFailuresByOfferId,
    showToast,
  });

  const cardsForOzon = items.map(toOfferCardItem);
  const { enqueueMultipleOzonListing: localEnqueueOzon } = useOzonListingQueue({
    sessionKey: `${HISTORY_SESSION_KEY}:ozon`,
    api,
    cards: cardsForOzon,
    enqueueSingleDeepCollect: (item) => localEnqueueDeep([item]),
    showToast,
    activeProfile: profile,
  });

  // Prefer external (shared ResultRenderer session) over local (isolated session)
  const enqueueDeep = extBatchDeepCollect || localEnqueueDeep;
  const enqueueOzon = extBatchOzonListing || localEnqueueOzon;

  const selectableItems = items.filter((item) => textOf(item.offerId));
  const selectedCount = selectableItems.filter((item) => selectedOfferIds.has(textOf(item.offerId))).length;
  const allSelected = selectableItems.length > 0 && selectedCount === selectableItems.length;
  const showBatchBar = selectedCount > 0;

  const toggleSelect = (offerId: string) => {
    setSelectedOfferIds((prev) => {
      const next = new Set(prev);
      if (next.has(offerId)) next.delete(offerId);
      else next.add(offerId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedOfferIds(new Set());
    } else {
      setSelectedOfferIds(new Set(selectableItems.map((item) => textOf(item.offerId))));
    }
  };

  const clearSelection = () => setSelectedOfferIds(new Set());

  const handleBatchDeepCollect = () => {
    const selectedItems = items.filter((item) => selectedOfferIds.has(textOf(item.offerId)));
    const cards = selectedItems.map(toOfferCardItem);
    enqueueDeep(cards);
    setSelectedOfferIds(new Set());
    showToast(`已加入 ${cards.length} 个商品到深采队列`);
  };

  const handleBatchOzonListing = () => {
    const selectedItems = items.filter((item) => selectedOfferIds.has(textOf(item.offerId)));
    const cards = selectedItems.map(toOfferCardItem);
    enqueueOzon(cards);
    setSelectedOfferIds(new Set());
    showToast(`已加入 ${cards.length} 个商品到草稿队列`);
  };

  return (
    <section className="product-history-inline-section">
      {toast && <div className="product-history-toast">{toast}</div>}

      <header className="product-history-inline-header">
        <div>
          <h3>历史采集记录</h3>
          <p>最近采集商品，当前 {items.length} 个，最多保留 500 个</p>
        </div>
        <div className="product-history-inline-header-actions">
          {selectableItems.length > 0 && (
            <button type="button" className="glass-btn-secondary" onClick={toggleSelectAll}>
              {allSelected ? '取消全选' : '全选'}
            </button>
          )}
          {onRefresh && (
            <button type="button" className="glass-btn-secondary" onClick={onRefresh}>
              刷新
            </button>
          )}
        </div>
      </header>

      {showBatchBar && (
        <div className="product-history-batch-bar">
          <span className="product-history-batch-count">已选 {selectedCount} 个</span>
          <div className="product-history-batch-actions">
            <button className="glass-btn-primary" onClick={handleBatchDeepCollect}>
              批量深采
            </button>
            <button className="glass-btn-primary" onClick={handleBatchOzonListing}>
              批量生成草稿
            </button>
          </div>
          <button className="glass-btn-ghost" onClick={clearSelection}>
            取消选择
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="product-history-inline-empty">
          暂无采集记录。执行搜索采集后，商品会出现在这里。
        </div>
      ) : (
        <div className="product-history-inline-grid">
          {items.map((item) => {
            const deepReady = hasDeepCollectData(item);
            const generatedReady = hasGeneratedDraft(item, ozonTasks);
            const priceText = textOf(item.price);
            const offerId = textOf(item.offerId);
            const title = textOf(item.title) || offerId || '未命名商品';
            const isSelected = selectedOfferIds.has(offerId);
            const canSelect = Boolean(offerId);
            return (
              <div
                key={`${offerId}-${item.collectedAt}`}
                className={`product-history-inline-card-wrapper ${isSelected ? 'selected' : ''}`}
              >
                <button
                  type="button"
                  className={`product-history-inline-check ${isSelected ? 'checked' : ''}`}
                  disabled={!canSelect}
                  aria-label={isSelected ? '取消选择' : '选择商品'}
                  onClick={(e) => { e.stopPropagation(); if (canSelect) toggleSelect(offerId); }}
                >
                  {isSelected && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="product-history-inline-card"
                  onClick={() => setSelected(item)}
                  title={title}
                >
                  <div className="product-history-inline-thumb">
                    {item.image ? (
                      <img src={item.image} alt={title} loading="lazy" />
                    ) : (
                      <div className="product-history-inline-placeholder" />
                    )}
                  </div>
                  <div className="product-history-inline-info">
                    <strong>{title}</strong>
                    {priceText && <span>{priceText}</span>}
                    <div className="product-history-inline-status-row">
                      <span className={`history-status-pill ${deepReady ? 'success' : 'muted'}`}>
                        {deepReady ? '已深采' : '未深采'}
                      </span>
                      <span className={`history-status-pill ${generatedReady ? 'success' : 'muted'}`}>
                        {generatedReady ? '已生成' : '未生成'}
                      </span>
                    </div>
                    <small className="product-history-inline-id">{offerId}</small>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <OfferDetailModal
          item={toOfferCardItem(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
