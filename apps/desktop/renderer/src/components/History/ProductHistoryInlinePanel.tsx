import React, { useState } from 'react';
import OfferDetailModal from '../Results/OfferDetailModal';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';
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

  // Check productHistory persisted flags first
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

export default function ProductHistoryInlinePanel({ items, ozonTasks, onRefresh }: Props) {
  const [selected, setSelected] = useState<ProductItem | null>(null);

  return (
    <section className="product-history-inline-section">
      <header className="product-history-inline-header">
        <div>
          <h3>历史采集记录</h3>
          <p>最近采集商品，当前 {items.length} 个，最多保留 500 个</p>
        </div>
        {onRefresh && (
          <button type="button" className="glass-btn-secondary" onClick={onRefresh}>
            刷新
          </button>
        )}
      </header>

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
            return (
              <button
                key={`${offerId}-${item.collectedAt}`}
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
