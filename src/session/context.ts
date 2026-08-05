import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { profilePath } from './paths.js';
import { acquireLock } from './lock.js';
import { CliError } from '../io/errors.js';
import {
  enrichErrorWithArtifact,
  type RunMeta,
} from './artifacts.js';
import {
  isPreferredBrowserUnavailable,
  PREFERRED_BROWSER_CHANNEL,
} from './browser-preference.js';

/**
 * Remove the browser's stale SingletonLock / SingletonCookie / SingletonSocket files
 * from our profile dir. Safe because our `proper-lockfile` already guarantees
 * no other 1688 process is using this profile.
 */
export async function clearStaleSingleton(profileDir: string): Promise<void> {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    await fs.unlink(path.join(profileDir, name)).catch(() => {});
  }
}

// Apply stealth evasions once at module load.
// Disable a couple of evasions that can cause issues with newer Chromium.
const stealthPlugin = stealth();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs');
chromium.use(stealthPlugin);

export interface SessionOpts {
  headless: boolean;
  profile?: string;
}

const LAUNCH_OPTS = {
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
};

export async function withSession<T>(
  opts: SessionOpts,
  fn: (ctx: BrowserContext) => Promise<T>,
  meta?: RunMeta,
): Promise<T> {
  const release = await acquireLock(opts.profile);
  const dir = profilePath(opts.profile);
  await fs.mkdir(dir, { recursive: true });
  await clearStaleSingleton(dir);

  let ctx: BrowserContext | null = null;
  try {
    ctx = await launchContext(dir, opts.headless);
    // Stealth plugin defaults navigator.languages to en-US — override back to
    // Chinese so we look like a real CN user.
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en'],
        });
      } catch {
        /* ignore */
      }
    });
    return await fn(ctx);
  } catch (e) {
    if (ctx && meta) {
      throw await enrichErrorWithArtifact(ctx, meta, e);
    }
    throw e;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await release().catch(() => {});
  }
}

async function launchContext(
  dir: string,
  headless: boolean,
): Promise<BrowserContext> {
  // Prefer the installed Microsoft Edge channel and fall back to bundled
  // Chromium only when Edge is unavailable.
  const preferEdge = process.env.BB1688_FORCE_CHROMIUM !== '1';
  if (preferEdge) {
    try {
      return (await chromium.launchPersistentContext(dir, {
        ...LAUNCH_OPTS,
        headless,
        channel: PREFERRED_BROWSER_CHANNEL,
      })) as BrowserContext;
    } catch (e) {
      // Re-throw unknown errors; only fall through if Edge is missing.
      if (!isPreferredBrowserUnavailable(e)) {
        throw e;
      }
    }
  }

  try {
    return (await chromium.launchPersistentContext(dir, {
      ...LAUNCH_OPTS,
      headless,
    })) as BrowserContext;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/Executable doesn't exist/i.test(msg)) {
      throw new CliError(
        6,
        'CHROMIUM_MISSING',
        'Chromium not installed. Run: npx playwright install chromium',
      );
    }
    throw e;
  }
}
