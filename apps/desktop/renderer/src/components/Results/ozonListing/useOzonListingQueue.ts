import { useEffect, useRef } from 'react';
import type { getApi } from '../../../services/api';
import { progressCardToOzonRows } from '../../../services/ozon-source-adapter';
import { normalizeOzonTaskError } from '../../Ozon/ozonError';
import type { ProgressOfferCardItem } from '../ProgressOfferCard';
import { ozonListingLog } from './debug';
import {
  isAiKeyMissingMessage,
  precheckProgressCardForOzon,
} from './precheck';
import type {
  OzonListingQueueEntry,
  OzonListingTask,
  OzonListingTaskPatch,
  OzonListingTasksChangeHandler,
} from './types';

type DesktopApi = ReturnType<typeof getApi>;

type UseOzonListingQueueArgs = {
  sessionKey?: string;
  api: DesktopApi;
  cards: ProgressOfferCardItem[];
  enqueueSingleDeepCollect: (item: ProgressOfferCardItem) => void;
  onOzonTasksChange?: OzonListingTasksChangeHandler;
  showToast: (message: string, timeout?: number) => void;
};

type DeepWaitResult =
  | { status: 'success'; item: ProgressOfferCardItem }
  | { status: 'failed'; item: ProgressOfferCardItem; message: string }
  | { status: 'timeout'; item: ProgressOfferCardItem | null };

const DEEP_COLLECT_TIMEOUT_MS = 12 * 60 * 1000;

type OzonListingSession = {
  key: string;
  cards: ProgressOfferCardItem[];
  enqueueSingleDeepCollect: (item: ProgressOfferCardItem) => void;
  queue: OzonListingQueueEntry[];
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  taskMap: Record<string, OzonListingTask>;
  runSessionId: string;
};

const DEFAULT_SESSION_KEY = 'default';
const noopEnqueueDeep = () => {};
const ozonListingSessions = new Map<string, OzonListingSession>();

function newRunSessionId(): string {
  return `ozon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createOzonListingSession(key: string): OzonListingSession {
  return {
    key,
    cards: [],
    enqueueSingleDeepCollect: noopEnqueueDeep,
    queue: [],
    running: false,
    timer: null,
    taskMap: {},
    runSessionId: newRunSessionId(),
  };
}

function getOzonListingSession(sessionKey?: string): OzonListingSession {
  const key = sessionKey || DEFAULT_SESSION_KEY;
  let session = ozonListingSessions.get(key);
  if (!session) {
    session = createOzonListingSession(key);
    ozonListingSessions.set(key, session);
  }
  return session;
}

function sortedOzonTasks(session: OzonListingSession): OzonListingTask[] {
  return Object.values(session.taskMap)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getOzonListingSessionTasks(sessionKey?: string): OzonListingTask[] {
  return sortedOzonTasks(getOzonListingSession(sessionKey));
}

export function hasOzonListingSessionState(sessionKey?: string): boolean {
  const session = ozonListingSessions.get(sessionKey || DEFAULT_SESSION_KEY);
  if (!session) return false;
  return session.queue.length > 0 || session.running || Object.keys(session.taskMap).length > 0;
}

export const __ozonListingSessionTest = {
  resetAll(): void {
    for (const session of ozonListingSessions.values()) {
      if (session.timer) clearTimeout(session.timer);
    }
    ozonListingSessions.clear();
  },
  seed(sessionKey: string, tasks: OzonListingTask[]): void {
    const session = getOzonListingSession(sessionKey);
    session.taskMap = Object.fromEntries(tasks.map((task) => [task.key, task]));
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardKey(item: ProgressOfferCardItem): string {
  return item.offerId ? `offer:${item.offerId}` : `slot:${item.slotIndex}`;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sourceUrlOf(item: ProgressOfferCardItem): string {
  const raw = objectOf(item.raw);
  const offerId = text(raw.offerId) || item.offerId || '';
  return text(raw.url) || text(raw.detailUrl) || (offerId ? `https://detail.1688.com/offer/${offerId}.html` : '');
}

function isDeepSuccess(item: ProgressOfferCardItem): boolean {
  const raw = objectOf(item.raw);

  return (
    item.status === 'deep-success' ||
    raw.deepCollected === true ||
    raw.deepCollectStatus === 'success' ||
    Boolean(raw.deepOffer)
  );
}

function isDeepFailure(item: ProgressOfferCardItem): boolean {
  const raw = objectOf(item.raw);

  return (
    item.status === 'deep-failed' ||
    item.status === 'failed' ||
    raw.deepCollectStatus === 'failed'
  );
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Ozon 草稿生成失败');
}

export function useOzonListingQueue({
  sessionKey = DEFAULT_SESSION_KEY,
  api,
  cards,
  enqueueSingleDeepCollect,
  onOzonTasksChange,
  showToast,
}: UseOzonListingQueueArgs) {
  const sessionRef = useRef<OzonListingSession>(getOzonListingSession(sessionKey));
  if (sessionRef.current.key !== sessionKey) {
    sessionRef.current = getOzonListingSession(sessionKey);
  }

  const onOzonTasksChangeRef = useRef(onOzonTasksChange);
  onOzonTasksChangeRef.current = onOzonTasksChange;

  const cardsRef = {
    get current(): ProgressOfferCardItem[] { return sessionRef.current.cards; },
    set current(value: ProgressOfferCardItem[]) { sessionRef.current.cards = value; },
  };
  const enqueueDeepRef = {
    get current(): (item: ProgressOfferCardItem) => void { return sessionRef.current.enqueueSingleDeepCollect; },
    set current(value: (item: ProgressOfferCardItem) => void) { sessionRef.current.enqueueSingleDeepCollect = value; },
  };
  const ozonQueueRef = {
    get current(): OzonListingQueueEntry[] { return sessionRef.current.queue; },
    set current(value: OzonListingQueueEntry[]) { sessionRef.current.queue = value; },
  };
  const ozonRunningRef = {
    get current(): boolean { return sessionRef.current.running; },
    set current(value: boolean) { sessionRef.current.running = value; },
  };
  const ozonQueueStartTimerRef = {
    get current(): ReturnType<typeof setTimeout> | null { return sessionRef.current.timer; },
    set current(value: ReturnType<typeof setTimeout> | null) { sessionRef.current.timer = value; },
  };
  const ozonTaskMapRef = {
    get current(): Record<string, OzonListingTask> { return sessionRef.current.taskMap; },
    set current(value: Record<string, OzonListingTask>) { sessionRef.current.taskMap = value; },
  };
  const runSessionIdRef = {
    get current(): string { return sessionRef.current.runSessionId; },
    set current(value: string) { sessionRef.current.runSessionId = value; },
  };

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    enqueueDeepRef.current = enqueueSingleDeepCollect;
  }, [enqueueSingleDeepCollect]);

  useEffect(() => {
    publishOzonTasks();
  }, [sessionKey]);

  function publishOzonTasks(): void {
    onOzonTasksChangeRef.current?.(sortedOzonTasks(sessionRef.current));
  }

  function upsertOzonTask(key: string, patch: OzonListingTaskPatch): void {
    const prev = ozonTaskMapRef.current[key];

    ozonTaskMapRef.current[key] = {
      key,
      sidebarKey: prev?.sidebarKey || `${runSessionIdRef.current}::${key}`,
      offerId: patch.offerId ?? prev?.offerId,
      title: patch.title ?? prev?.title,
      image: patch.image ?? prev?.image,
      price: patch.price ?? prev?.price,
      sourceUrl: patch.sourceUrl ?? prev?.sourceUrl,
      status: patch.status ?? prev?.status ?? 'queued',
      message: patch.message ?? prev?.message,
      missingFields: patch.missingFields ?? prev?.missingFields,
      draftId: patch.draftId ?? prev?.draftId,
      draft: patch.draft ?? prev?.draft,
      debug: patch.debug ?? prev?.debug,
      createdAt: prev?.createdAt || patch.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: patch.finishedAt ?? prev?.finishedAt,
    };

    publishOzonTasks();
  }

  function latestCardFor(item: ProgressOfferCardItem): ProgressOfferCardItem | null {
    if (item.offerId) {
      const byOfferId = cardsRef.current.find((card) => card.offerId === item.offerId);
      if (byOfferId) return byOfferId;
    }

    const key = cardKey(item);
    return cardsRef.current.find((card) => cardKey(card) === key) || null;
  }

  async function waitForDeepResult(item: ProgressOfferCardItem): Promise<DeepWaitResult> {
    const startedAt = Date.now();
    let latest: ProgressOfferCardItem | null = latestCardFor(item) || item;

    while (Date.now() - startedAt < DEEP_COLLECT_TIMEOUT_MS) {
      latest = latestCardFor(item) || latest;

      if (latest && isDeepSuccess(latest)) {
        return { status: 'success', item: latest };
      }

      if (latest && isDeepFailure(latest)) {
        return {
          status: 'failed',
          item: latest,
          message: latest.message || latest.code || '深度采集失败，无法生成 Ozon 草稿',
        };
      }

      await sleep(1000);
    }

    return { status: 'timeout', item: latest };
  }

  async function ensureDeepCollected(entry: OzonListingQueueEntry): Promise<ProgressOfferCardItem | null> {
    const latest = latestCardFor(entry.item) || entry.item;
    const precheck = precheckProgressCardForOzon(latest);

    if (!precheck.offerId) {
      upsertOzonTask(entry.key, {
        status: 'failed',
        message: '缺少 Offer ID，无法生成草稿',
        finishedAt: new Date().toISOString(),
      });
      return null;
    }

    if (isDeepSuccess(latest)) {
      return latest;
    }

    upsertOzonTask(entry.key, {
      status: 'waiting_deep_collect',
      message: '等待先完成 1688 深度采集',
    });

    ozonListingLog('enqueue dependency deep collect', {
      offerId: latest.offerId,
      title: latest.title,
    });

    enqueueDeepRef.current(latest);

    upsertOzonTask(entry.key, {
      status: 'deep_collecting',
      message: '已加入深度采集队列，采集成功后生成 Ozon 草稿',
    });

    const deepResult = await waitForDeepResult(latest);

    if (deepResult.status === 'success') {
      return deepResult.item;
    }

    if (deepResult.status === 'failed') {
      upsertOzonTask(entry.key, {
        title: deepResult.item.title || latest.title,
        image: deepResult.item.image || latest.image,
        price: deepResult.item.price || latest.price,
        sourceUrl: sourceUrlOf(deepResult.item) || sourceUrlOf(latest),
        status: 'deep_failed',
        message: normalizeOzonTaskError(deepResult.message, { phase: 'deep_collect' }),
        finishedAt: new Date().toISOString(),
      });
      return null;
    }

    upsertOzonTask(entry.key, {
      status: 'failed',
      message: normalizeOzonTaskError('等待深度采集超时，未生成 Ozon 草稿', { phase: 'timeout' }),
      finishedAt: new Date().toISOString(),
    });
    return null;
  }

  async function generateDraftForEntry(entry: OzonListingQueueEntry): Promise<void> {
    const deepItem = await ensureDeepCollected(entry);

    if (!deepItem) return;

    const precheck = precheckProgressCardForOzon(deepItem);
    const rows = progressCardToOzonRows(deepItem);

    upsertOzonTask(entry.key, {
      title: deepItem.title,
      image: deepItem.image,
      price: deepItem.price,
      sourceUrl: sourceUrlOf(deepItem),
      offerId: deepItem.offerId,
      status: 'generating_draft',
      message: '正在生成 Ozon 草稿',
    });

    try {
      ozonListingLog('generateDraft start', {
        offerId: deepItem.offerId,
        rowCount: rows.length,
      });

      const draft = await api.ozon.generateDraft(rows);

      upsertOzonTask(entry.key, {
        status: 'draft_ready',
        draftId: draft.draftId,
        draft,
        message: '草稿已生成',
        finishedAt: new Date().toISOString(),
      });

      ozonListingLog('generateDraft done', {
        offerId: deepItem.offerId,
        draftId: draft.draftId,
      });
    } catch (error) {
      const message = errorMessageOf(error);

      if (isAiKeyMissingMessage(message)) {
        upsertOzonTask(entry.key, {
          status: 'failed',
          message: normalizeOzonTaskError(message, { phase: 'generate' }),
          debug: { rawError: message },
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      upsertOzonTask(entry.key, {
        status: 'failed',
        message: normalizeOzonTaskError(message, { phase: 'generate' }),
        debug: { rawError: message },
        finishedAt: new Date().toISOString(),
      });
    }
  }

  async function processOzonQueue(): Promise<void> {
    if (ozonRunningRef.current) return;

    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
      ozonQueueStartTimerRef.current = null;
    }

    if (ozonQueueRef.current.length === 0) return;

    ozonRunningRef.current = true;

    ozonListingLog('process queue start', {
      queueSize: ozonQueueRef.current.length,
      offerIds: ozonQueueRef.current.map((entry) => entry.item.offerId),
    });

    try {
      while (ozonQueueRef.current.length > 0) {
        const entry = ozonQueueRef.current.shift();

        if (!entry) break;

        upsertOzonTask(entry.key, {
          status: 'queued',
          message: `等待生成草稿，剩余 ${ozonQueueRef.current.length} 个任务`,
        });

        await generateDraftForEntry(entry);

        if (ozonQueueRef.current.length > 0) {
          await sleep(300);
        }
      }
    } finally {
      ozonRunningRef.current = false;

      if (ozonQueueRef.current.length > 0) {
        scheduleOzonQueueProcess(500);
      }
    }
  }

  function scheduleOzonQueueProcess(delayMs = 500): void {
    if (ozonRunningRef.current) return;

    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
    }

    ozonQueueStartTimerRef.current = setTimeout(() => {
      ozonQueueStartTimerRef.current = null;
      void processOzonQueue();
    }, delayMs);
  }

  function enqueueMultipleOzonListing(items: ProgressOfferCardItem[]): void {
    const validItems = items.filter((item) => Boolean(item.offerId || item.raw || item.title || item.image));

    if (validItems.length === 0) {
      showToast('请选择可上架的商品');
      return;
    }

    let added = 0;

    for (const item of validItems) {
      const key = cardKey(item);
      const existing = ozonTaskMapRef.current[key];
      const existingIsActive = existing && (
        existing.status === 'queued' ||
        existing.status === 'waiting_deep_collect' ||
        existing.status === 'deep_collecting' ||
        existing.status === 'generating_draft'
      );

      if (existingIsActive) {
        continue;
      }

      if (ozonQueueRef.current.some((queueItem) => queueItem.key === key)) {
        continue;
      }

      ozonQueueRef.current = [
        ...ozonQueueRef.current,
        {
          key,
          item,
        },
      ];

      upsertOzonTask(key, {
        offerId: item.offerId,
        title: item.title,
        image: item.image,
        price: item.price,
        sourceUrl: sourceUrlOf(item),
        status: 'queued',
        message: '排队等待生成 Ozon 草稿',
        createdAt: new Date().toISOString(),
      });

      added += 1;
    }

    if (added === 0) {
      showToast('选中的商品已在 Ozon 草稿队列中');
      return;
    }

    ozonListingLog('enqueue done', {
      added,
      queueSize: ozonQueueRef.current.length,
      offerIds: validItems.map((item) => item.offerId),
    });

    showToast(`已加入 ${added} 个商品到 Ozon 草稿队列`, 1600);
    scheduleOzonQueueProcess(500);
  }

  function enqueueSingleOzonListing(item: ProgressOfferCardItem): void {
    enqueueMultipleOzonListing([item]);
  }

  function resetOzonListingQueue(): void {
    if (ozonQueueStartTimerRef.current) {
      clearTimeout(ozonQueueStartTimerRef.current);
      ozonQueueStartTimerRef.current = null;
    }

    ozonQueueRef.current = [];
    ozonRunningRef.current = false;
    ozonTaskMapRef.current = {};
    runSessionIdRef.current = newRunSessionId();
    publishOzonTasks();
  }

  return {
    enqueueSingleOzonListing,
    enqueueMultipleOzonListing,
    resetOzonListingQueue,
  };
}
