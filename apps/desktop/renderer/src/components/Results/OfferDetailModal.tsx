import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProgressOfferCardItem } from './ProgressOfferCard';

interface Props {
  item: ProgressOfferCardItem;
  onClose: () => void;
}

function s(v: unknown): string { return v != null ? String(v) : ''; }

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function skuImage(sku: Record<string, unknown>): string {
  return s(
    sku.image ||
    sku.skuImage ||
    sku.imageUrl ||
    sku.picUrl ||
    sku.imgUrl ||
    sku.mainImage ||
    sku.previewImage,
  );
}

export default function OfferDetailModal({ item, onClose }: Props) {
  const raw = item.raw as Record<string, unknown> | undefined;
  const skus = (raw?.skus as Array<Record<string, unknown>>) || [];
  const attrs = (raw?.attributes as Array<{ name: string; value: string }>) || [];
  const images = useMemo(() => {
    const rawImages = Array.isArray(raw?.images) ? raw?.images as string[] : [];
    const skuImages = skus.map(skuImage).filter(Boolean);
    return uniqueStrings([
      s(raw?.mainImage),
      ...rawImages.map(s),
      s(item.image),
      ...skuImages,
    ]);
  }, [raw, skus, item.image]);
  const [activeImage, setActiveImage] = useState(images[0] || '');
  const [activeSkuIndex, setActiveSkuIndex] = useState<number | null>(null);
  const supplier = raw?.supplier as Record<string, unknown> | undefined;
  const freight = raw?.freight as Record<string, unknown> | undefined;
  const saledCount = raw?.saledCount as number | undefined;
  const priceTiers = (raw?.priceTiers as Array<Record<string, unknown>>) || [];
  const isDeep =
    skus.length > 0 ||
    attrs.length > 0 ||
    priceTiers.length > 0 ||
    saledCount != null ||
    Boolean(freight?.receiveAddress || freight?.unitWeight || freight?.province || freight?.city) ||
    raw?.deepCollected === true ||
    raw?.deepCollectStatus === 'success';

  // Base search fields (from search offers)
  const baseSupplier = raw?.supplier as Record<string, unknown> | undefined;
  const location = raw?.location as Record<string, unknown> | undefined;
  const verified = raw?.verified as Record<string, boolean> | undefined;
  const demand = raw?.demand as Record<string, unknown> | undefined;
  const tags = (raw?.tags as string[]) || [];
  const url = s(raw?.url) || s(item.offerId ? `https://detail.1688.com/offer/${item.offerId}.html` : '');
  const bizType = s(raw?.bizType);
  const turnover = s(raw?.turnover);
  const isP4P = raw?.isP4P === true;

  useEffect(() => {
    setActiveImage(images[0] || '');
    setActiveSkuIndex(null);
  }, [images, item.offerId]);

  const selectSku = (sku: Record<string, unknown>, index: number) => {
    const nextImage = skuImage(sku);
    setActiveSkuIndex(index);
    if (nextImage) setActiveImage(nextImage);
  };

  const content = (
    <div className="modal-backdrop detail-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-modal glass-panel-card">
        <div className="modal-actions" style={{ marginBottom: 8 }}>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>

        {/* Images */}
        {images.length > 0 && (
          <div className="detail-images">
            <img src={activeImage || images[0]} alt={item.title || ''} className="detail-main-image" />
            {images.length > 1 && (
              <div className="detail-thumbs">
                {images.slice(0, 6).map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    className={`detail-thumb-btn ${url === activeImage ? 'active' : ''}`}
                    onClick={() => {
                      setActiveImage(url);
                      setActiveSkuIndex(null);
                    }}
                    aria-label={`查看商品图片 ${i + 1}`}
                  >
                    <img src={url} alt="" className="thumb" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <h3 className="detail-title">{item.title || '未识别商品'}</h3>
        {item.price && <p className="detail-price">{item.price}</p>}

        <div className="detail-meta">
          <span>Offer ID: <code>{item.offerId || '-'}</code></span>
          {item.status === 'deep-success' && <span className="status-badge">深采完成</span>}
          {item.status === 'basic-ready' && <span className="status-badge neutral">基础信息</span>}
          {item.status === 'deep-collecting' && <span className="status-badge neutral">深采中</span>}
          {item.status === 'deep-failed' && <span className="status-badge warn">采集失败</span>}
        </div>

        {url && (
          <p style={{ marginBottom: 10 }}>
            <a href={url} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: 13, color: '#2563eb' }}>打开 1688 商品</a>
          </p>
        )}

        {/* Deep-collecting hint */}
        {item.status === 'deep-collecting' && (
          <div className="detail-failure" style={{ background: 'rgba(99,102,241,0.06)', borderColor: 'rgba(99,102,241,0.18)' }}>
            <p style={{ color: '#4f46e5' }}>正在深度采集中，请稍后查看 SKU / 属性详情。</p>
          </div>
        )}

        {/* Failure info */}
        {(item.status === 'deep-failed' || item.status === 'failed') && (
          <div className="detail-failure">
            <p><strong>失败原因：</strong>{item.message || item.code || '未知'}</p>
            {item.code && <p>Code: {item.code}</p>}
            {item.attempts != null && <p>尝试次数：{item.attempts}</p>}
          </div>
        )}

        {/* ── Base search info ── */}
        <div className="detail-section">
          <h4>基础信息</h4>
          <div className="attr-grid">
            {Boolean(baseSupplier?.name) && <>
              <span className="attr-key">供应商</span>
              <span className="attr-value">{s(baseSupplier?.name)}</span>
            </>}
            {Boolean(baseSupplier?.shopUrl) && <>
              <span className="attr-key">店铺链接</span>
              <span className="attr-value"><a href={s(baseSupplier?.shopUrl)} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 12 }}>{s(baseSupplier?.shopUrl).slice(0, 50)}...</a></span>
            </>}
            {baseSupplier?.years != null && <>
              <span className="attr-key">年限</span>
              <span className="attr-value">{s(baseSupplier.years)} 年</span>
            </>}
            {Boolean(location?.province || location?.city) && <>
              <span className="attr-key">地区</span>
              <span className="attr-value">{[s(location?.province), s(location?.city)].filter(Boolean).join(' ')}</span>
            </>}
            {bizType && <>
              <span className="attr-key">经营类型</span>
              <span className="attr-value">{bizType}</span>
            </>}
            {(demand?.orderCountText || turnover) && <>
              <span className="attr-key">成交数</span>
              <span className="attr-value">{s(demand?.orderCountText) || turnover}</span>
            </>}
            {tags.length > 0 && <>
              <span className="attr-key">标签</span>
              <span className="attr-value">{tags.join('、')}</span>
            </>}
            {verified && <>
              <span className="attr-key">认证</span>
              <span className="attr-value">
                {[
                  verified.factory && '工厂认证',
                  verified.business && '企业认证',
                  verified.superFactory && '超级工厂',
                ].filter(Boolean).join('、') || '无'}
              </span>
            </>}
            {isP4P && <>
              <span className="attr-key">广告</span>
              <span className="attr-value">是</span>
            </>}
          </div>
        </div>

        {/* ── Deep info ── */}
        {isDeep ? (
          <>
            {supplier && (
              <div className="detail-section">
                <h4>供应商详情</h4>
                <p>名称：{supplier.name ? s(supplier.name) : '-'}</p>
                {Boolean(supplier.loginId) && <p>Login ID: {s(supplier.loginId)}</p>}
                {Boolean(supplier.memberId) && <p>Member ID: {s(supplier.memberId)}</p>}
              </div>
            )}
            {freight && (
              <div className="detail-section">
                <h4>发货信息</h4>
                {Boolean(freight.receiveAddress) && <p>收货地址：{s(freight.receiveAddress)}</p>}
                {Boolean(freight.province) && <p>省份：{s(freight.province)}{freight.city ? ` ${s(freight.city)}` : ''}</p>}
                {freight.unitWeight != null && <p>单位重量：{s(freight.unitWeight)}</p>}
              </div>
            )}
            {saledCount != null && (
              <div className="detail-section"><h4>销量</h4><p>{saledCount}</p></div>
            )}
            {priceTiers.length > 0 && (
              <div className="detail-section">
                <h4>价格阶梯</h4>
                {priceTiers.map((t, i) => (
                  <span key={i} className="glass-chip" style={{ marginRight: 6 }}>{s(t.minQty)}件 ¥{s(t.price)}</span>
                ))}
              </div>
            )}
            {skus.length > 0 && (
              <div className="detail-section">
                <h4>SKU ({skus.length})</h4>
                <div className="detail-sku-list">
                  {skus.slice(0, 10).map((sku, i) => {
                    const specs = s(sku.specs || sku.skuId || '-');
                    const image = skuImage(sku);
                    const isActive = activeSkuIndex === i;
                    return (
                      <button
                        key={s(sku.skuId) || `${specs}-${i}`}
                        type="button"
                        className={`sku-row sku-row-button ${isActive ? 'active' : ''}`}
                        onClick={() => selectSku(sku, i)}
                        title={image ? '点击查看该 SKU 图片' : '该 SKU 没有独立图片'}
                      >
                        {image && <img src={image} alt="" className="sku-row-thumb" loading="lazy" />}
                        <span className="sku-specs">{specs}</span>
                        <span className="sku-price">¥{s(sku.price ?? '-')}</span>
                        <span className="sku-stock">库存 {s(sku.stock ?? '-')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {attrs.length > 0 && (
              <div className="detail-section">
                <h4>属性 ({attrs.length})</h4>
                <div className="attr-grid">
                  {attrs.map((a, i) => (
                    <div key={i} className="attr-item">
                      <span className="attr-key">{a.name}</span>
                      <span className="attr-value">{a.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : item.status !== 'failed' ? (
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '12px 0' }}>
            当前为基础搜索信息。SKU、属性、运费等字段需要开启「采集商品详情」后查看。
          </p>
        ) : null}

        {/* Raw JSON */}
        {raw && (
          <details className="advanced-section" style={{ marginTop: 12 }}>
            <summary className="advanced-toggle">原始 JSON</summary>
            <pre className="json-output" style={{ maxHeight: 300, overflow: 'auto', fontSize: 11, marginTop: 8 }}>
              {JSON.stringify(raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
