import React, { useState } from 'react';
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
  onRefresh?: () => void;
}

function toOfferCardItem(p: ProductItem): ProgressOfferCardItem {
  return {
    slotIndex: 0,
    offerId: p.offerId,
    title: p.title || '',
    price: p.price || '',
    image: p.image,
    status: 'basic-ready',
    raw: p.raw || p,
  };
}

export default function ProductHistoryInlinePanel({ items, onRefresh }: Props) {
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
          {items.map((item) => (
            <button
              key={`${item.offerId}-${item.collectedAt}`}
              type="button"
              className="product-history-inline-card"
              onClick={() => setSelected(item)}
              title={item.title}
            >
              <div className="product-history-inline-thumb">
                {item.image ? (
                  <img src={item.image} alt={item.title || ''} loading="lazy" />
                ) : (
                  <div className="product-history-inline-placeholder" />
                )}
              </div>
              <div className="product-history-inline-info">
                <strong>{item.title || item.offerId || '未命名商品'}</strong>
                <span>{item.price || '暂无价格'}</span>
                <small>{item.offerId}</small>
              </div>
            </button>
          ))}
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
