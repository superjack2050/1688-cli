import React, { useMemo, useState } from 'react';
import type { OzonListingTask, OzonListingTaskPatch } from '../Results/ozonListing/types';
import { getApi } from '../../services/api';
import type { OzonDraft } from '../../services/api';
import OzonProductCard, {
  isOzonTaskImportedStatus,
  isOzonTaskFailedStatus,
  isOzonTaskProcessingStatus,
} from './OzonProductCard';
import OzonDraftEditor from './OzonDraftEditor';
import './ozon.css';

type OzonProductFilter = 'all' | 'draft' | 'imported' | 'queued' | 'manual' | 'failed';
type OzonSortMode = 'updated_desc' | 'updated_asc';

type Props = {
  tasks: OzonListingTask[];
  onBackTo1688: () => void;
  onTaskUpdate?: (key: string, patch: OzonListingTaskPatch) => void;
};

const filterOptions: Array<{ key: OzonProductFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'imported', label: '已导入' },
  { key: 'queued', label: '处理中' },
  { key: 'manual', label: '需补充' },
  { key: 'failed', label: '失败' },
];

function taskTime(task: OzonListingTask): number {
  const value = task.updatedAt || task.finishedAt || task.createdAt;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function filterTask(task: OzonListingTask, filter: OzonProductFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'draft') return task.status === 'draft_ready';
  if (filter === 'imported') return isOzonTaskImportedStatus(task.status);
  if (filter === 'queued') return isOzonTaskProcessingStatus(task.status);
  if (filter === 'manual') return task.status === 'needs_manual';
  if (filter === 'failed') return isOzonTaskFailedStatus(task.status);
  return true;
}

function titleOf(task: OzonListingTask): string {
  return [task.title, task.offerId, task.draftId]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

export default function OzonProductPage({ tasks, onBackTo1688, onTaskUpdate }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OzonProductFilter>('all');
  const [sortMode, setSortMode] = useState<OzonSortMode>('updated_desc');
  const [selectedTask, setSelectedTask] = useState<OzonListingTask | null>(null);
  const [toast, setToast] = useState('');

  const counts = useMemo(() => {
    const queued = tasks.filter((task) => isOzonTaskProcessingStatus(task.status)).length;
    const draft = tasks.filter((task) => task.status === 'draft_ready').length;
    const imported = tasks.filter((task) => isOzonTaskImportedStatus(task.status)).length;
    const manual = tasks.filter((task) => task.status === 'needs_manual').length;
    const failed = tasks.filter((task) => isOzonTaskFailedStatus(task.status)).length;
    return { all: tasks.length, draft, imported, queued, manual, failed };
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = tasks
      .filter((task) => filterTask(task, filter))
      .filter((task) => !keyword || titleOf(task).toLowerCase().includes(keyword));

    return filtered.sort((a, b) => {
      const diff = taskTime(a) - taskTime(b);
      return sortMode === 'updated_desc' ? -diff : diff;
    });
  }, [filter, query, sortMode, tasks]);

  const latestText = tasks.length > 0
    ? new Date(Math.max(...tasks.map(taskTime))).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '--';

  async function copyDraft(task: OzonListingTask): Promise<void> {
    if (!task.draft) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ items: task.draft.items }, null, 2));
      setToast('已复制 Ozon 回传 Payload');
      window.setTimeout(() => setToast(''), 1600);
    } catch {
      setToast('复制失败，请稍后重试');
      window.setTimeout(() => setToast(''), 1600);
    }
  }

  function showToast(message: string): void {
    setToast(message);
    window.setTimeout(() => setToast(''), 1600);
  }

  function handleTaskUpdate(key: string, patch: OzonListingTaskPatch): void {
    onTaskUpdate?.(key, patch);
    setSelectedTask((prev) => {
      if (!prev) return prev;
      if (prev.key !== key && prev.sidebarKey !== key) return prev;
      return { ...prev, ...patch };
    });
  }

  function inspectTask(task: OzonListingTask): void {
    setSelectedTask(task);
  }

  function closeTask(): void {
    setSelectedTask(null);
  }

  async function submitTask(task: OzonListingTask): Promise<void> {
    if (!task.draft) { showToast('草稿不存在，无法提交。'); return; }
    if (!confirm('确认提交该草稿到 Ozon？提交后将创建真实商品。')) return;

    showToast('正在提交 Ozon...');
    try {
      const result = await getApi().ozon.submitDraft(
        task.draft as OzonDraft,
        true,
      );
      if ((result as Record<string, unknown>).ok) {
        handleTaskUpdate(task.key, {
          status: 'import_pending',
          message: 'Ozon 已接收导入任务，等待结果...',
          finishedAt: new Date().toISOString(),
        });
        showToast('已提交到 Ozon，等待导入结果。');
      } else {
        handleTaskUpdate(task.key, {
          status: 'submit_failed',
          message: `提交失败：${(result as Record<string, unknown>).message || '未知错误'}`,
        });
        showToast('提交失败，请查看详情。');
      }
    } catch (error) {
      handleTaskUpdate(task.key, {
        status: 'submit_failed',
        message: `提交异常：${error instanceof Error ? error.message : String(error)}`,
      });
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="ozon-product-page">
      <section className="ozon-products-hero">
        <div>
          <span className="ozon-products-eyebrow">Ozon 工作台</span>
          <h2>草稿商品 / 上架任务</h2>
          <p>这里汇总从 1688 商品卡生成的 Ozon 草稿、导入任务、需人工补充项和失败任务。</p>
        </div>
        <div className="ozon-products-hero-meta">
          <span>最近更新</span>
          <strong>{latestText}</strong>
        </div>
      </section>

      <section className="ozon-products-stats">
        {filterOptions.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`ozon-products-stat ozon-products-stat--${item.key} ${filter === item.key ? 'active' : ''}`}
            onClick={() => setFilter(item.key)}
          >
            <span>{item.label}</span>
            <strong>{counts[item.key]}</strong>
          </button>
        ))}
      </section>

      <section className="ozon-products-toolbar">
        <div className="ozon-products-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={query}
            placeholder="按标题 / Offer ID / 草稿 ID 搜索"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <select value={filter} onChange={(event) => setFilter(event.target.value as OzonProductFilter)}>
          {filterOptions.map((item) => (
            <option key={item.key} value={item.key}>{item.label}</option>
          ))}
        </select>

        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as OzonSortMode)}>
          <option value="updated_desc">最近更新优先</option>
          <option value="updated_asc">最早更新优先</option>
        </select>
      </section>

      <section className="ozon-products-list-shell">
        <div className="ozon-products-list-head">
          <strong>商品列表</strong>
          <span>当前显示 {visibleTasks.length} 件，任务总数 {tasks.length} 件</span>
        </div>

        {visibleTasks.length === 0 ? (
          <div className="ozon-products-empty">
            <div className="ozon-products-empty-visual" aria-hidden="true">
              <div className="ozon-products-empty-sheet back" />
              <div className="ozon-products-empty-sheet front">
                <svg viewBox="0 0 48 48">
                  <rect x="10" y="8" width="28" height="32" rx="8" fill="rgba(219,234,254,0.9)" />
                  <path d="M17 18h14M17 25h14M17 32h8" fill="none" stroke="rgba(37,99,235,0.72)" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="34" cy="34" r="6" fill="#fff" />
                  <path d="M31.5 34.2l1.7 1.7 3.6-4.2" fill="none" stroke="#16a34a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <h3>暂无 Ozon 草稿商品</h3>
            <p>在 1688 页面点击“生成 Ozon 草稿”后，商品会出现在这里，并按草稿、导入、需补充和失败状态分类。</p>
            <button type="button" onClick={onBackTo1688}>返回 1688 选择商品</button>
          </div>
        ) : (
          <div className="ozon-products-grid">
            {visibleTasks.map((task) => (
              <OzonProductCard
                key={task.sidebarKey || `${task.key}-${task.createdAt}`}
                task={task}
                onInspect={inspectTask}
                onCopyDraft={copyDraft}
                onSubmitDraft={submitTask}
                onBackTo1688={onBackTo1688}
              />
            ))}
          </div>
        )}
      </section>

      {selectedTask && (
        <div className="ozon-product-detail-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeTask();
        }}>
          <aside className="ozon-product-detail-panel ozon-product-detail-panel--editor">
            <OzonDraftEditor
              task={selectedTask}
              onTaskUpdate={handleTaskUpdate}
              onBackTo1688={onBackTo1688}
              onToast={showToast}
              onClose={closeTask}
            />
          </aside>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
