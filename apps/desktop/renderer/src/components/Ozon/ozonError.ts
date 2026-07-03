import type { OzonListingTask } from '../Results/ozonListing/types';

type OzonErrorContext = {
  phase?: 'generate' | 'deep_collect' | 'timeout' | 'submit' | 'unknown';
  fallback?: string;
};

const UNSAFE_SYSTEM_ERROR_RE = /remote method|desktop:|typeerror|referenceerror|syntaxerror|unhandled|failed to fetch|networkerror|econn|stack trace|http \d{3}/i;
const AI_CONFIG_RE = /deepseek|api[-_\s]?key|apikey|ai key|model|authorization|unauthorized|未配置|密钥/i;
const TIMEOUT_RE = /timeout|timed out|超时/i;
const DEEP_RE = /deep|offer|captcha|verify|risk|punish|深度采集|深采|验证码|风控|拦截/i;

function rawMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const data = error as Record<string, unknown>;
    return String(data.message || data.error || data.reason || data.code || '');
  }
  return String(error || '');
}

function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function isUnsafeSystemMessage(value: string): boolean {
  return UNSAFE_SYSTEM_ERROR_RE.test(value);
}

export function normalizeOzonTaskError(error: unknown, context: OzonErrorContext = {}): string {
  const raw = rawMessageOf(error).trim();

  if (context.phase === 'submit') {
    if (raw && hasChinese(raw)) return raw;
    return context.fallback || '提交 Ozon 失败：请检查店铺授权、类目属性、价格或库存配置。';
  }

  if (AI_CONFIG_RE.test(raw)) {
    return '生成 Ozon 草稿失败：未配置可用的 AI 服务，请先到 AI 设置中完成配置。';
  }

  if (context.phase === 'timeout' || TIMEOUT_RE.test(raw)) {
    return '生成 Ozon 草稿超时，请稍后重试。';
  }

  if (context.phase === 'deep_collect' || DEEP_RE.test(raw)) {
    return '生成 Ozon 草稿失败：当前商品深度采集结果不完整，请先完成深采或重新深采。';
  }

  if (isUnsafeSystemMessage(raw)) {
    return '生成 Ozon 草稿失败：桌面端调用异常，请重试；若持续失败，请检查本地环境或调试日志。';
  }

  if (raw && hasChinese(raw)) {
    return raw;
  }

  return context.fallback || '生成 Ozon 草稿失败：发生未知异常，请查看调试日志。';
}

export function formatOzonTaskDisplayMessage(task: OzonListingTask): string {
  if (task.status === 'draft_ready') return task.message || '草稿已生成，可编辑后提交到 Ozon。';
  if (task.status === 'import_pending') return task.message || 'Ozon 已接收导入任务，正在等待导入结果。';
  if (task.status === 'imported') return task.message || 'Ozon 商品已导入，价格已更新；库存待配置或待确认。';
  if (task.status === 'listing_ready') return task.message || 'Ozon 商品已导入，价格和库存链路已完成。';

  if (task.status === 'needs_manual') {
    return task.message || '需人工补充';
  }

  if (task.status === 'deep_failed') {
    return normalizeOzonTaskError(task.message || '', { phase: 'deep_collect' });
  }

  if (task.status === 'submit_failed') {
    return normalizeOzonTaskError(task.message || '', {
      phase: 'submit',
      fallback: '提交 Ozon 失败：请检查类目属性、店铺授权、价格或库存配置。',
    });
  }

  if (task.status === 'failed') {
    return normalizeOzonTaskError(task.message || '', {
      phase: task.message && TIMEOUT_RE.test(task.message) ? 'timeout' : 'generate',
    });
  }

  const message = task.message || '';
  if (!message) return '';
  if (isUnsafeSystemMessage(message) || (!hasChinese(message) && /[a-z]/i.test(message))) {
    return normalizeOzonTaskError(message, { phase: 'generate' });
  }
  return message;
}
