import React, { useState } from 'react';
import { normalizeImageUrl } from './ozonEditorUtils';

interface Props {
  open: boolean;
  title: string;
  images: string[];
  maxCount?: number;
  onCancel: () => void;
  onSave: (images: string[]) => void;
}

const MAX_DEFAULT = 15;

export default function OzonImageManager({ open, title, images, maxCount = MAX_DEFAULT, onCancel, onSave }: Props) {
  const [draftImages, setDraftImages] = useState<string[]>(images);
  const [newUrl, setNewUrl] = useState('');
  const [broken, setBroken] = useState<Set<number>>(new Set());

  if (!open) return null;

  function addUrl() {
    const url = normalizeImageUrl(newUrl);
    if (!url) return;
    if (draftImages.includes(url)) return;
    if (draftImages.length >= maxCount) return;
    setDraftImages([...draftImages, url]);
    setNewUrl('');
  }

  function removeAt(index: number) {
    setDraftImages((prev) => prev.filter((_, ii) => ii !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= draftImages.length) return;
    setDraftImages((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function onImageError(index: number) {
    setBroken((prev) => new Set(prev).add(index));
  }

  return (
    <div
      className="ozon-image-manager-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ozon-image-manager-title"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="ozon-image-manager">
        <div className="ozon-image-manager-head">
          <h3 id="ozon-image-manager-title">{title}</h3>
          <button type="button" className="ozon-image-manager-close" onClick={onCancel}>关闭</button>
        </div>

        <div className="ozon-image-manager-summary">
          <span>首图为 Ozon 主图（primary_image），可删除、调整顺序、补充 URL。最多 {maxCount} 张。</span>
          <b>{draftImages.length}/{maxCount}</b>
        </div>

        <div className="ozon-image-manager-grid">
          {draftImages.map((url, index) => (
            <div key={`${index}-${url}`} className="ozon-image-manager-item">
              <div className="ozon-image-manager-thumb">
                {index === 0 && <span className="ozon-image-manager-main-badge">主图</span>}
                <img src={url} alt="" onError={() => onImageError(index)} />
                {broken.has(index) && <div className="ozon-image-manager-broken">图片失效</div>}
              </div>
              <div className="ozon-image-manager-actions">
                <button type="button" title="设为第一张（主图）" disabled={index === 0} onClick={() => move(index, -index)}>设主图</button>
                <button type="button" title="前移" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" title="后移" disabled={index === draftImages.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="danger" title="删除图片" onClick={() => removeAt(index)}>×</button>
              </div>
            </div>
          ))}
          {draftImages.length < maxCount && (
            <div className="ozon-image-manager-add">
              <span className="ozon-image-manager-add-icon">+</span>
              <span className="ozon-image-manager-add-text">添加图片</span>
            </div>
          )}
        </div>

        <div className="ozon-image-manager-url-row">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }}
            placeholder="输入图片 URL（JPG/PNG）"
          />
          <button type="button" onClick={addUrl} disabled={!newUrl.trim()}>添加</button>
        </div>

        <div className="ozon-image-manager-actions-row">
          <button type="button" className="plain" onClick={onCancel}>取消</button>
          <button type="button" className="primary" onClick={() => onSave(draftImages)}>保存图片</button>
        </div>
      </div>
    </div>
  );
}
