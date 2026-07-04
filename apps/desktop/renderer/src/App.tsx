import React, { useEffect, useMemo, useState } from 'react';
import { getApi, CommandRegistry, AccountData, RuntimeStatus, CliInfo, CommandRecord } from './services/api';
import AccountSelector from './components/Account/AccountSelector';
import RuntimeStatusPanel from './components/Runtime/RuntimeStatusPanel';
import CommandPanel from './components/Commands/CommandPanel';
import HistoryModal from './components/History/HistoryModal';
import HistoryDetailModal from './components/History/HistoryDetailModal';
import ProductHistoryModal from './components/History/ProductHistoryModal';
import ProductHistoryInlinePanel from './components/History/ProductHistoryInlinePanel';
import OzonSettingsModal from './components/Ozon/OzonSettingsModal';
import OzonProductPage from './components/Ozon/OzonProductPage';
import AccountSettingsModal from './components/Account/AccountSettingsModal';
import ErrorBoundary from './components/ErrorBoundary';
import { formatOzonTaskDisplayMessage } from './components/Ozon/ozonError';
import type { OzonListingTask, OzonListingTaskPatch, OzonListingTaskStatus } from './components/Results/ozonListing/types';
import type { ProgressOfferCardItem } from './components/Results/ProgressOfferCard';
import './styles/tokens.css';
import './styles/controls.css';
import './styles/panels.css';
import './App.css';

type DeepCollectSidebarTaskStatus = 'queued' | 'collecting' | 'success' | 'failed';

interface DeepCollectSidebarTask {
  key: string;
  sidebarKey?: string;
  offerId?: string;
  title?: string;
  image?: string;
  status: DeepCollectSidebarTaskStatus;
  message?: string;
  profile?: string;
  attempt?: number;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
}

type OzonTaskFilter = 'all' | 'draft' | 'imported' | 'queued' | 'manual' | 'failed';

function isOzonTaskProcessing(status: OzonListingTaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'waiting_deep_collect' ||
    status === 'deep_collecting' ||
    status === 'generating_draft' ||
    status === 'import_pending'
  );
}

function isOzonTaskFailed(status: OzonListingTaskStatus): boolean {
  return status === 'failed' || status === 'deep_failed' || status === 'submit_failed';
}

function isOzonTaskImported(status: OzonListingTaskStatus): boolean {
  return status === 'imported' || status === 'listing_ready';
}

function ozonTaskClass(status: OzonListingTaskStatus): string {
  if (isOzonTaskImported(status)) return 'success';
  if (status === 'needs_manual') return 'needs-manual';
  if (isOzonTaskFailed(status)) return 'failed';
  if (status === 'deep_collecting' || status === 'generating_draft' || status === 'import_pending' || status === 'draft_ready') return 'collecting';
  return 'queued';
}

function ozonTaskStatusLabel(status: OzonListingTaskStatus): string {
  const map: Record<OzonListingTaskStatus, string> = {
    queued: '排队中',
    waiting_deep_collect: '等深采',
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

function taskTimestamp(value?: string): number {
  const time = new Date(value || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default function App() {
  const [registry, setRegistry] = useState<CommandRegistry | null>(null);
  const [accounts, setAccounts] = useState<AccountData | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [cliInfo, setCliInfo] = useState<CliInfo | null>(null);
  const [activeProfile, setActiveProfile] = useState('default');
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<CommandRecord | null>(null);
  const [workspaceView, setWorkspaceView] = useState<'1688' | 'ozon'>('1688');
  const [runtimeStatusOpen, setRuntimeStatusOpen] = useState(false);
  const [deepTasks, setDeepTasks] = useState<DeepCollectSidebarTask[]>([]);
  const [deepTaskFilter, setDeepTaskFilter] = useState<'all' | 'success' | 'queued' | 'failed'>('all');
  const deepTaskCounts = useMemo(() => {
    const queued = deepTasks.filter((t) => t.status === 'queued' || t.status === 'collecting').length;
    const success = deepTasks.filter((t) => t.status === 'success').length;
    const failed = deepTasks.filter((t) => t.status === 'failed').length;
    return { all: deepTasks.length, queued, success, failed };
  }, [deepTasks]);

  const handleDeepTasksChange = (tasks: DeepCollectSidebarTask[]) => {
    if (!tasks.length) {
      setDeepTasks([]);
      return;
    }

    setDeepTasks((prev) => {
      const map = new Map<string, DeepCollectSidebarTask>();

      for (const task of prev) {
        // Prefer stable task.key (e.g. offer:123) for dedup; fall back to
        // sidebarKey so existing tasks without key still work.
        const id = task.key || task.offerId || task.sidebarKey || `${task.createdAt}`;
        map.set(id, task);
      }

      for (const task of tasks) {
        const id = task.key || task.offerId || task.sidebarKey || `${task.createdAt}`;
        map.set(id, task);
      }

      return Array.from(map.values()).sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return bt - at;
      });
    });
  };
  const [ozonTasks, setOzonTasks] = useState<OzonListingTask[]>([]);
  const [ozonTaskFilter, setOzonTaskFilter] = useState<OzonTaskFilter>('all');
  const ozonTaskCounts = useMemo(() => {
    const queued = ozonTasks.filter((t) => isOzonTaskProcessing(t.status)).length;
    const draft = ozonTasks.filter((t) => t.status === 'draft_ready').length;
    const imported = ozonTasks.filter((t) => isOzonTaskImported(t.status)).length;
    const manual = ozonTasks.filter((t) => t.status === 'needs_manual').length;
    const failed = ozonTasks.filter((t) => isOzonTaskFailed(t.status)).length;
    return { all: ozonTasks.length, queued, draft, imported, manual, failed };
  }, [ozonTasks]);

  const handleOzonTasksChange = (tasks: OzonListingTask[]) => {
    if (!tasks.length) {
      setOzonTasks([]);
      return;
    }

    setOzonTasks((prev) => {
      const map = new Map<string, OzonListingTask>();

      for (const task of prev) {
        const id = task.sidebarKey || `${task.key}::${task.createdAt}`;
        map.set(id, task);
      }

      for (const task of tasks) {
        const id = task.sidebarKey || `${task.key}::${task.createdAt}`;
        const existing = map.get(id);
        const existingTime = taskTimestamp(existing?.updatedAt || existing?.finishedAt || existing?.createdAt);
        const incomingTime = taskTimestamp(task.updatedAt || task.finishedAt || task.createdAt);
        if (!existing || incomingTime >= existingTime) map.set(id, task);
      }

      return Array.from(map.values()).sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return bt - at;
      });
    });
  };

  const handleOzonTaskUpdate = (key: string, patch: OzonListingTaskPatch) => {
    setOzonTasks((prev) => prev.map((task) => {
      if (task.key !== key && task.sidebarKey !== key) return task;
      return {
        ...task,
        ...patch,
        key: task.key,
        sidebarKey: task.sidebarKey,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
    }));
  };

  const [productHistoryOpen, setProductHistoryOpen] = useState(false);
  const [ozonSettingsOpen, setOzonSettingsOpen] = useState<'ai' | 'store' | null>(null);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [productItems, setProductItems] = useState<Array<{ offerId: string; title: string; price: string; image: string; url: string; collectedAt: string; raw?: unknown }>>([]);
  const [batchActions, setBatchActions] = useState<{ enqueueMultipleDeepCollect: (items: ProgressOfferCardItem[]) => void; enqueueMultipleOzonListing: (items: ProgressOfferCardItem[]) => void } | null>(null);

  const api = getApi();

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [reg, acc, rt, cli] = await Promise.all([
        api.commands.getRegistry(),
        api.accounts.list(),
        api.runtime.getStatus(activeProfile),
        api.runtime.getCliInfo(),
      ]);
      setRegistry(reg);
      setAccounts(acc);
      setActiveProfile(acc.activeProfile);
      setRuntime(rt);
      setCliInfo(cli);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    refreshProductHistory().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAccountChange = async (profile: string) => {
    await api.accounts.setActive(profile);
    setActiveProfile(profile);
    const acc = await api.accounts.list();
    setAccounts(acc);
    const rt = await api.runtime.getStatus(profile);
    setRuntime(rt);
  };

  const handleRefreshRuntime = async () => {
    const rt = await api.runtime.getStatus(activeProfile);
    setRuntime(rt);
  };

  const openRecentTasks = async () => {
    const items = await api.commands.getHistory({ limit: 8 });
    setHistory(items);
    setRecentOpen(true);
  };

  const refreshRecentTasks = async () => {
    const items = await api.commands.getHistory({ limit: 8 });
    setHistory(items);
  };

  const refreshProductHistory = async () => {
    const items = await api.productHistory.list(500);
    setProductItems(items);
  };

  const refresh1688HistoryData = async () => {
    const [recentItems, products] = await Promise.all([
      api.commands.getHistory({ limit: 8 }),
      api.productHistory.list(500),
    ]);
    setHistory(recentItems);
    setProductItems(products);
  };

  const openHistory = async () => {
    const items = await api.commands.getHistory({ limit: 50 });
    setHistory(items);
    setHistoryOpen(true);
  };

  if (loading) {
    return <div className="app-loading">正在启动 1688 to Ozon Studio...</div>;
  }

  if (!registry || !accounts) {
    return (
      <div className="app-error">
        <h2>启动失败</h2>
        <p>{error || '无法连接桌面端服务。请重新启动应用。'}</p>
        <button onClick={loadAll}>重试</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="side-nav app-side-switcher">
        <div className="brand-flow">
          <button
            type="button"
            className={`brand-logo-card ${workspaceView === '1688' ? 'active' : ''}`}
            onClick={() => setWorkspaceView('1688')}
            aria-label="1688"
          >
            <img src="/nav/1688.png" alt="1688" />
          </button>

          <div className="brand-flow-bridge">
            <span className="brand-flow-line" />
            <span className="brand-flow-arrow">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.25 6h7M6.75 3.5 9.25 6 6.75 8.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          <button
            type="button"
            className={`brand-logo-card ${workspaceView === 'ozon' ? 'active' : ''}`}
            onClick={() => setWorkspaceView('ozon')}
            aria-label="Ozon"
          >
            <img src="/nav/ozon.png" alt="Ozon" />
          </button>
        </div>

        {/* ── 1688 采集任务列表 ── */}
        <div className="deep-task-sidebar" style={{ display: workspaceView === '1688' ? 'flex' : 'none' }}>
          <div className="deep-task-sidebar-head">
            <span className="deep-task-sidebar-title">采集任务列表</span>
          </div>
          <div className="deep-task-filters">
            <button className={deepTaskFilter === 'all' ? 'active' : ''} onClick={() => setDeepTaskFilter('all')}> <span>全部</span> <strong>{deepTaskCounts.all}</strong> </button>
            <button className={deepTaskFilter === 'success' ? 'active' : ''} onClick={() => setDeepTaskFilter('success')}> <span>已完成</span> <strong>{deepTaskCounts.success}</strong> </button>
            <button className={deepTaskFilter === 'queued' ? 'active' : ''} onClick={() => setDeepTaskFilter('queued')}> <span>排队中</span> <strong>{deepTaskCounts.queued}</strong> </button>
            <button className={deepTaskFilter === 'failed' ? 'active' : ''} onClick={() => setDeepTaskFilter('failed')}> <span>失败</span> <strong>{deepTaskCounts.failed}</strong> </button>
          </div>
          {(() => {
            const filtered = deepTasks.filter((t) => {
              if (deepTaskFilter === 'all') return true;
              if (deepTaskFilter === 'success') return t.status === 'success';
              if (deepTaskFilter === 'queued') return t.status === 'queued' || t.status === 'collecting';
              if (deepTaskFilter === 'failed') return t.status === 'failed';
              return true;
            });
            return (
              <>
                {filtered.length === 0 ? (
                  <div className="deep-task-empty">暂无采集任务</div>
                ) : (
                  <div className="deep-task-list custom-scrollbar">
                    {filtered.map((task) => (
                      <div key={task.sidebarKey || `${task.key}-${task.createdAt}`} className={`deep-task-item ${task.status}`} title={task.message || ''}>
                        {task.image ? (
                          <img className="deep-task-thumb" src={task.image} alt="" />
                        ) : (
                          <div className="deep-task-thumb placeholder" />
                        )}
                        <div className="deep-task-info">
                          <div className="deep-task-title" title={task.title || task.offerId || '未命名商品'}>
                            {task.title || task.offerId || '未命名商品'}
                          </div>
                          <div className="deep-task-meta">
                            <span className={`deep-task-status ${task.status}`}>
                              {task.status === 'collecting' ? '采集中' : task.status === 'queued' ? '排队中' : task.status === 'success' ? '已完成' : '失败'}
                            </span>
                            <span className="deep-task-time">{new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          </div>
                            {task.message && <div className="deep-task-message" title={task.message}>{task.message}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* ── Ozon 上架任务列表 ── */}
        <div className="deep-task-sidebar" style={{ display: workspaceView === 'ozon' ? 'flex' : 'none' }}>
          <div className="deep-task-sidebar-head">
            <span className="deep-task-sidebar-title">上架任务列表</span>
          </div>
          <div className="deep-task-filters">
            <button className={ozonTaskFilter === 'all' ? 'active' : ''} onClick={() => setOzonTaskFilter('all')}> <span>全部</span> <strong>{ozonTaskCounts.all}</strong> </button>
            <button className={ozonTaskFilter === 'draft' ? 'active' : ''} onClick={() => setOzonTaskFilter('draft')}> <span>草稿</span> <strong>{ozonTaskCounts.draft}</strong> </button>
            <button className={ozonTaskFilter === 'imported' ? 'active' : ''} onClick={() => setOzonTaskFilter('imported')}> <span>已导入</span> <strong>{ozonTaskCounts.imported}</strong> </button>
            <button className={ozonTaskFilter === 'queued' ? 'active' : ''} onClick={() => setOzonTaskFilter('queued')}> <span>处理中</span> <strong>{ozonTaskCounts.queued}</strong> </button>
            <button className={ozonTaskFilter === 'manual' ? 'active' : ''} onClick={() => setOzonTaskFilter('manual')}> <span>需补充</span> <strong>{ozonTaskCounts.manual}</strong> </button>
            <button className={ozonTaskFilter === 'failed' ? 'active' : ''} onClick={() => setOzonTaskFilter('failed')}> <span>失败</span> <strong>{ozonTaskCounts.failed}</strong> </button>
          </div>
          {(() => {
            const filtered = ozonTasks.filter((t) => {
              if (ozonTaskFilter === 'all') return true;
              if (ozonTaskFilter === 'draft') return t.status === 'draft_ready';
              if (ozonTaskFilter === 'imported') return isOzonTaskImported(t.status);
              if (ozonTaskFilter === 'queued') return isOzonTaskProcessing(t.status);
              if (ozonTaskFilter === 'manual') return t.status === 'needs_manual';
              if (ozonTaskFilter === 'failed') return isOzonTaskFailed(t.status);
              return true;
            });
            return (
              <>
                {filtered.length === 0 ? (
                  <div className="deep-task-empty">暂无上架任务</div>
                ) : (
                  <div className="deep-task-list custom-scrollbar">
                    {filtered.map((task) => {
                      const message = formatOzonTaskDisplayMessage(task);

                      return (
                        <div key={task.sidebarKey || `${task.key}-${task.createdAt}`} className={`deep-task-item ${ozonTaskClass(task.status)}`} title={message}>
                          {task.image ? (
                            <img className="deep-task-thumb" src={task.image} alt="" />
                          ) : (
                            <div className="deep-task-thumb placeholder" />
                          )}
                          <div className="deep-task-info">
                            <div className="deep-task-title" title={task.title || task.offerId || '未命名任务'}>
                              {task.title || '未命名任务'}
                            </div>
                            <div className="deep-task-meta">
                              <span className={`deep-task-status ${ozonTaskClass(task.status)}`}>
                                {ozonTaskStatusLabel(task.status)}
                              </span>
                              <span className="deep-task-time">{new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                            {message && <div className="deep-task-message" title={message}>{message}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{workspaceView === '1688' ? '1688 CLI 全功能接入' : 'Ozon 工作台'}</p>
            <h2>{workspaceView === '1688' ? '1688 to Ozon Studio' : 'Ozon Studio'}</h2>
          </div>
          <div className="topbar-actions">
            <button className="glass-btn-secondary" onClick={() => setRuntimeStatusOpen(true)}>运行状态</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('ai')}>AI 设置</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('store')}>Ozon 店铺</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setAccountSettingsOpen(true)}>1688账号</button>
            <button className="glass-btn-secondary" onClick={openRecentTasks}>最近任务</button>
          </div>
        </header>

        <div className="workspace-inner">
          <section
            className={`workspace-view-panel ${workspaceView === '1688' ? 'active' : 'hidden'}`}
            aria-hidden={workspaceView !== '1688'}
          >
            <ErrorBoundary>
              <CommandPanel
                registry={registry}
                activeProfile={activeProfile}
                accounts={accounts}
                onHistoryRefresh={refresh1688HistoryData}
                onDeepTasksChange={handleDeepTasksChange}
                onOzonTasksChange={handleOzonTasksChange}
                onBatchActionsReady={setBatchActions}
              />
              <ProductHistoryInlinePanel
                items={productItems}
                ozonTasks={ozonTasks}
                onRefresh={refreshProductHistory}
                batchDeepCollect={batchActions?.enqueueMultipleDeepCollect}
                batchOzonListing={batchActions?.enqueueMultipleOzonListing}
              />
            </ErrorBoundary>
          </section>

          <section
            className={`workspace-view-panel ${workspaceView === 'ozon' ? 'active' : 'hidden'}`}
            aria-hidden={workspaceView !== 'ozon'}
          >
            <OzonProductPage
              tasks={ozonTasks}
              onBackTo1688={() => setWorkspaceView('1688')}
              onTaskUpdate={handleOzonTaskUpdate}
            />
          </section>
        </div>
      </main>

      <HistoryModal
        title="最近任务"
        history={history.slice(0, 8)}
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onSelect={(r) => { setRecentOpen(false); setDetailRecord(r); }}
        compact
      />

      <HistoryModal
        title="历史记录"
        history={history}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(r) => { setHistoryOpen(false); setDetailRecord(r); }}
      />

      <HistoryDetailModal
        record={detailRecord}
        onClose={() => setDetailRecord(null)}
      />

      <ProductHistoryModal
        items={productItems}
        open={productHistoryOpen}
        onClose={() => setProductHistoryOpen(false)}
      />

      {runtimeStatusOpen && (
        <div className="runtime-status-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setRuntimeStatusOpen(false); }}>
          <div className="runtime-status-modal">
            <div className="runtime-status-modal-header">
              <h3>运行状态</h3>
              <button className="glass-btn-ghost" onClick={() => setRuntimeStatusOpen(false)}>关闭</button>
            </div>
            <RuntimeStatusPanel
              runtime={runtime} cliInfo={cliInfo} onRefresh={handleRefreshRuntime}
              accounts={accounts.accounts} activeProfile={activeProfile} embedded
            />
          </div>
        </div>
      )}

      <OzonSettingsModal
        mode={ozonSettingsOpen || 'ai'}
        open={ozonSettingsOpen !== null}
        onClose={() => setOzonSettingsOpen(null)}
      />

      <AccountSettingsModal
        accounts={accounts}
        activeProfile={activeProfile}
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onAccountsChanged={() => api.accounts.list().then(setAccounts) as Promise<void>}
        onProfileChange={handleAccountChange}
      />
    </div>
  );
}
