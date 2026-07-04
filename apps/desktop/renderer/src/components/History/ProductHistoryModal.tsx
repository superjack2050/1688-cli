import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import OfferDetailModal from '../Results/OfferDetailModal';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';

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
  open: boolean;
  onClose: () => void;
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
  const hasDeep =
    Array.isArray(raw.skus) && raw.skus.length > 0 ||
    Array.isArray(raw.attributes) && raw.attributes.length > 0 ||
    Array.isArray(raw.priceTiers) && raw.priceTiers.length > 0 ||
    raw.saledCount != null ||
    raw.deepCollected === true ||
    raw.deepCollectStatus === 'success';
  return {
    slotIndex: 0,
    offerId: textOf(p.offerId),
    title: textOf(raw.title) || textOf(raw.productTitle) || textOf(p.title),
    price: textOf(raw.priceText) || textOf(raw.priceRange) || textOf(p.price),
    image: textOf(raw.mainImage) || textOf(raw.image) || textOf(p.image),
    status: hasDeep ? 'deep-success' : 'basic-ready',
    raw: { ...p, ...raw, offerId: textOf(p.offerId), url: textOf(raw.url) || textOf(p.url) },
  };
}

export default function ProductHistoryModal({ items, open, onClose }: Props) {
  const [selected, setSelected] = useState<ProductItem | null>(null);
  if (!open && !selected) return null;

  return createPortal(
    <>
      {open && (
        <div className="product-history-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="product-history-shell">
            <header className="product-history-header">
              <div>
                <h3>历史记录</h3>
                <p>最近采集商品，当前 {items.length} 个，最多保留 500 个</p>
              </div>
              <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
            </header>
            <div className="product-history-body custom-scrollbar">
              {items.length === 0 ? (
                <div className="empty-product-history">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.15)" strokeWidth="1.2">
                    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                  </svg>
                  <p style={{ marginTop: 12, fontSize: 14 }}>暂无采集记录</p>
                  <p style={{ fontSize: 12 }}>执行搜索采集后，商品图会出现在这里。</p>
                </div>
              ) : (
                <div className="product-history-grid">
                  {items.map((item) => (
                    <button
                      key={item.offerId}
                      className="product-history-tile"
                      onClick={() => {
                        setSelected(item);
                      }}
                      title={item.title}
                    >
                      <img src={item.image} alt={item.title} loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selected && (
        <OfferDetailModal item={toOfferCardItem(selected)} onClose={() => setSelected(null)} />
      )}
    </>,
    document.body,
  );
}
