import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface SkuEntry {
  skuId: string;
  specs: string;
  price: string;
  stock: string;
  image: string | null;
}

interface Props {
  open: boolean;
  title: string;
  mainImage: string | null;
  skus: SkuEntry[];
  onConfirm: (selectedSkuIds: Set<string>) => void;
  onCancel: () => void;
}

export default function SkuSelectModal({ open, title, mainImage, skus, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(skus.map((s) => s.skuId)));
  const allSelected = selected.size === skus.length;
  const noneSelected = selected.size === 0;

  const toggle = (skuId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(skus.map((s) => s.skuId)));
  };

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop account-modal-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15,23,42,0.25)', backdropFilter: 'blur(6px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="modal glass-panel-card"
        style={{
          width: 'min(540px, calc(100vw - 48px))', maxHeight: 'min(640px, calc(100vh - 80px))',
          display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)',
          borderRadius: 20, boxShadow: '0 25px 60px rgba(15,23,42,0.15), 0 1px 2px rgba(15,23,42,0.06)',
          padding: 0, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>选择 SKU</h3>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            {title.slice(0, 60)}
          </p>
        </div>

        {/* Select all toggle */}
        <div style={{ padding: '8px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#374151', userSelect: 'none' }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll}
              style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
            全选 ({skus.length} 个 SKU)
          </label>
        </div>

        {/* SKU list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {skus.map((sku) => {
            const checked = selected.has(sku.skuId);
            return (
              <label
                key={sku.skuId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px',
                  cursor: 'pointer', userSelect: 'none',
                  background: checked ? 'rgba(37,99,235,0.04)' : 'transparent',
                  borderLeft: checked ? '3px solid #2563eb' : '3px solid transparent',
                  transition: 'background 0.15s',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(sku.skuId)}
                  style={{ width: 16, height: 16, accentColor: '#2563eb', flexShrink: 0 }} />
                {sku.image && (
                  <img src={sku.image} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid #e5e7eb' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1f2937', lineHeight: 1.4, wordBreak: 'break-all' }}>
                    {sku.specs || sku.skuId}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    {sku.price ? `¥${sku.price}` : ''}{sku.price && sku.stock ? ' · ' : ''}{sku.stock ? `库存 ${sku.stock}` : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            className="glass-btn-ghost"
            onClick={onCancel}
            style={{ fontSize: 13, padding: '8px 20px' }}
          >
            取消
          </button>
          <button
            className="glass-btn-primary"
            disabled={noneSelected}
            onClick={() => onConfirm(selected)}
            style={{
              fontSize: 13, padding: '8px 24px',
              background: noneSelected ? '#e5e7eb' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: noneSelected ? '#9ca3af' : '#fff',
              border: 'none', borderRadius: 10, fontWeight: 600, cursor: noneSelected ? 'not-allowed' : 'pointer',
              boxShadow: noneSelected ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.28), 0 8px 20px rgba(37,99,235,0.22)',
            }}
          >
            确认 {selected.size > 0 ? `(${selected.size} 个 SKU)` : ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function extractSkuEntries(item: {
  raw?: Record<string, unknown> | null;
  title?: string;
  price?: string;
}): SkuEntry[] {
  const raw = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<string, unknown>;
  const skus = Array.isArray(raw.skus) ? raw.skus : [];
  return skus.map((sku: unknown) => {
    const s = (sku && typeof sku === 'object' ? sku : {}) as Record<string, unknown>;
    return {
      skuId: String(s.skuId ?? ''),
      specs: String(s.specs ?? ''),
      price: String(s.price ?? s.multiPrice ?? ''),
      stock: String(s.stock ?? ''),
      image: (typeof s.image === 'string' ? s.image : null) as string | null,
    };
  }).filter((s) => s.skuId);
}
