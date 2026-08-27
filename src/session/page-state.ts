import type { Page } from 'playwright';
import { withTimeout } from './wait.js';

export type PageStateKind =
  | 'normal_1688_page'
  | 'not_logged_in'
  | 'risk_challenge'
  | 'rate_limited'
  | 'unknown';

export interface PageState {
  kind: PageStateKind;
  url: string;
  title: string | null;
  indicators: string[];
}

export interface PageSnapshot {
  url: string;
  title?: string | null;
  text?: string;
}

const LOGIN_RE = /(?:login\.(?:1688|taobao)\.com|passport\.1688\.com)/i;
const RISK_URL_RE = /(?:\/punish\b|x5secdata)/i;
const RISK_TEXT_RE =
  /(滑块|拖动.*验证|安全验证|验证码|验证一下|检测到.*异常|环境异常|nc[_-]?captcha|请完成验证)/i;
const RATE_LIMIT_TEXT_RE =
  /(访问频繁|请求频繁|操作频繁|稍后再试|访问受限|流量异常|系统繁忙)/i;
const PAGE_PROBE_TIMEOUT_MS = 1500;

export function classifyPageState(snapshot: PageSnapshot): PageState {
  const url = snapshot.url;
  const title = snapshot.title ?? null;
  const text = snapshot.text ?? '';
  const haystack = `${title ?? ''}\n${text}`;
  const indicators: string[] = [];

  if (LOGIN_RE.test(url)) {
    indicators.push('login-url');
    return { kind: 'not_logged_in', url, title, indicators };
  }

  if (RISK_URL_RE.test(url)) {
    indicators.push('risk-url');
    return { kind: 'risk_challenge', url, title, indicators };
  }

  if (RATE_LIMIT_TEXT_RE.test(haystack)) {
    indicators.push('rate-limit-text');
    return { kind: 'rate_limited', url, title, indicators };
  }

  if (RISK_TEXT_RE.test(haystack)) {
    indicators.push('risk-text');
    return { kind: 'risk_challenge', url, title, indicators };
  }

  if (/\.1688\.com/i.test(url)) {
    indicators.push('1688-url');
    return { kind: 'normal_1688_page', url, title, indicators };
  }

  return { kind: 'unknown', url, title, indicators };
}

export async function detectPageState(page: Page): Promise<PageState> {
  const url = page.url();
  let title: string | null = null;
  let text = '';

  try {
    title = await withTimeout(page.title(), {
      timeoutMs: PAGE_PROBE_TIMEOUT_MS,
      fallback: null,
    });
  } catch {
    title = null;
  }

  try {
    text = await withTimeout(page.evaluate(() => document.body?.innerText ?? ''), {
      timeoutMs: PAGE_PROBE_TIMEOUT_MS,
      fallback: '',
    });
    if (text.length > 20_000) text = text.slice(0, 20_000);
  } catch {
    text = '';
  }

  return classifyPageState({ url, title, text });
}

export function recoverHintForPageState(kind: PageStateKind): string | undefined {
  switch (kind) {
    case 'not_logged_in':
      return 'Session expired. Run `1688 login` and retry.';
    case 'risk_challenge':
      return '1688 is showing a verification challenge. Retry once with `--headed` and complete the manual check.';
    case 'rate_limited':
      return '1688 is rate-limiting this session. Wait a few minutes, then retry at a slower pace.';
    case 'unknown':
      return 'The page was not recognized. Inspect the saved artifact directory for screenshot and HTML.';
    default:
      return undefined;
  }
}
