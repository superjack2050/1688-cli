import type { Page, Response as PWResponse } from 'playwright';
import { waitWithDeadline } from './wait.js';
import {
  SEARCH_APP_ID,
  parseOfferItemsFromMtopText,
  readSearchMtopRequestMeta,
  type Offer,
} from './search-mtop.js';

export interface SearchOfferCaptureOptions {
  page: Page;
  /** Accept only responses whose mtop `params.method` is this value (or one of these values). */
  requireMethod?: string | readonly string[];
  requireSortType?: string;
  allowUnscopedWirelessRecommend?: boolean;
  targetPage?: () => number;
  keep?: 'first' | 'largest';
}

export interface SearchOfferCaptureFailure {
  at: string;
  url: string;
  name?: string;
  message: string;
}

export interface SearchOfferCaptureDiagnostics {
  startedAt: string;
  endedAt?: string;
  disposed: boolean;
  finalStatus?: SearchOfferCaptureWaitStatus;
  timedOut: boolean;
  seenCount: number;
  matchedCount: number;
  parsedCount: number;
  failureCount: number;
  lastSeenUrl?: string;
  lastMatchedUrl?: string;
  lastParsedUrl?: string;
  lastError?: { name?: string; message: string };
  failures: SearchOfferCaptureFailure[];
}

export type SearchOfferCaptureWaitStatus =
  | 'captured'
  | 'timeout'
  | 'blocked'
  | 'browser_closed'
  | 'stream_closed';

export interface SearchOfferCaptureWaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  isBlocked?: () => boolean | Promise<boolean>;
  isClosed?: () => boolean;
}

export interface SearchOfferCaptureWaitResult {
  status: SearchOfferCaptureWaitStatus;
  offers: Offer[];
  diagnostics: SearchOfferCaptureDiagnostics;
}

export interface SearchOfferCaptureResult<TResult> {
  actionResult: TResult;
  status: SearchOfferCaptureWaitStatus;
  offers: Offer[];
  diagnostics: SearchOfferCaptureDiagnostics;
}

export async function captureSearchOffersForAction<TResult>(
  opts: SearchOfferCaptureOptions,
  action: () => Promise<TResult>,
  waitOptions: SearchOfferCaptureWaitOptions,
): Promise<SearchOfferCaptureResult<TResult>> {
  const capture = startSearchOfferCapture(opts);
  return capture.waitForAction(action, waitOptions);
}

export function startSearchOfferCapture(opts: SearchOfferCaptureOptions) {
  const maxDiagnosticsEntries = 5;
  const startedAt = new Date().toISOString();
  let endedAt: string | undefined;
  let disposed = false;
  let pageClosed = false;
  let finalStatus: SearchOfferCaptureWaitStatus | undefined;
  let timedOut = false;
  let offers: Offer[] = [];
  let seenCount = 0;
  let matchedCount = 0;
  let parsedCount = 0;
  let lastSeenUrl: string | undefined;
  let lastMatchedUrl: string | undefined;
  let lastParsedUrl: string | undefined;
  let lastError: { name?: string; message: string } | undefined;
  const failures: SearchOfferCaptureFailure[] = [];

  const errorInfo = (error: unknown): { name?: string; message: string } => {
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    return { message: String(error) };
  };

  const recordFailure = (url: string, error: unknown) => {
    const info = errorInfo(error);
    lastError = info;
    failures.push({
      at: new Date().toISOString(),
      url,
      ...info,
    });
    if (failures.length > maxDiagnosticsEntries) failures.shift();
  };

  const diagnostics = (): SearchOfferCaptureDiagnostics => ({
    startedAt,
    endedAt,
    disposed,
    finalStatus,
    timedOut,
    seenCount,
    matchedCount,
    parsedCount,
    failureCount: failures.length,
    lastSeenUrl,
    lastMatchedUrl,
    lastParsedUrl,
    lastError,
    failures: [...failures],
  });

  const reset = () => {
    endedAt = undefined;
    finalStatus = undefined;
    timedOut = false;
    offers = [];
    seenCount = 0;
    matchedCount = 0;
    parsedCount = 0;
    lastSeenUrl = undefined;
    lastMatchedUrl = undefined;
    lastParsedUrl = undefined;
    lastError = undefined;
    failures.length = 0;
  };

  const onResponse = async (resp: PWResponse) => {
    if (disposed) return;
    const url = resp.url();
    seenCount++;
    lastSeenUrl = url;
    try {
      const meta = readSearchMtopRequestMeta(url);
      if (meta) {
        if (meta.appId !== SEARCH_APP_ID) return;
        if (opts.requireMethod !== undefined) {
          const allowed =
            typeof opts.requireMethod === 'string'
              ? [opts.requireMethod]
              : opts.requireMethod;
          if (!allowed.includes(meta.method ?? '')) return;
        }
        if (opts.requireSortType && meta.sortType !== opts.requireSortType) return;
        const targetPage = opts.targetPage?.();
        if (targetPage !== undefined && (meta.beginPage ?? 1) !== targetPage) return;
      } else if (
        !opts.allowUnscopedWirelessRecommend ||
        !/mtop\.relationrecommend\.wirelessrecommend\.recommend/i.test(url)
      ) {
        return;
      }
      matchedCount++;
      lastMatchedUrl = url;
      const parsed = parseOfferItemsFromMtopText(await resp.text());
      if (parsed.length === 0) return;
      if (opts.keep === 'largest') {
        if (parsed.length > offers.length) offers = parsed;
      } else {
        offers = parsed;
      }
      parsedCount++;
      lastParsedUrl = url;
    } catch (error) {
      recordFailure(url, error);
    }
  };

  const onClose = () => {
    pageClosed = true;
    finalStatus ??= 'browser_closed';
    endedAt ??= new Date().toISOString();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    endedAt ??= new Date().toISOString();
    opts.page.off('response', onResponse);
    opts.page.off('close', onClose);
  };

  const wait = async (
    optsWait: SearchOfferCaptureWaitOptions,
  ): Promise<SearchOfferCaptureWaitResult> => {
    const result = await waitWithDeadline<SearchOfferCaptureWaitStatus>(async () => {
      if (pageClosed || optsWait.isClosed?.()) return 'browser_closed';
      if (offers.length > 0) return 'captured';
      if (await optsWait.isBlocked?.()) return 'blocked';
      if (disposed) return 'stream_closed';
      return null;
    }, {
      timeoutMs: optsWait.timeoutMs,
      intervalMs: optsWait.intervalMs ?? 300,
      onTimeout: () => (offers.length > 0 ? 'captured' : 'timeout'),
    });
    finalStatus = result;
    timedOut = result === 'timeout';
    endedAt ??= new Date().toISOString();
    return { status: result, offers, diagnostics: diagnostics() };
  };

  const waitForAction = async <TResult>(
    action: () => Promise<TResult>,
    optsWait: SearchOfferCaptureWaitOptions,
  ): Promise<SearchOfferCaptureResult<TResult>> => {
    try {
      const actionResult = await action();
      const result = await wait(optsWait);
      return {
        actionResult,
        status: result.status,
        offers: result.offers,
        diagnostics: result.diagnostics,
      };
    } finally {
      dispose();
    }
  };

  opts.page.on('response', onResponse);
  opts.page.on('close', onClose);

  return {
    reset,
    wait,
    waitForAction,
    dispose,
    diagnostics,
    offers: () => offers,
  };
}
