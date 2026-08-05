// Long-lived shared BrowserContext for the daemon. Operations are serialized
// (one Playwright op at a time) so we look like a single, deliberate user
// rather than concurrent requests.

import fs from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { defaultProfileName, profilePath } from './paths.js';
import { acquireLock } from './lock.js';
import { CliError } from '../io/errors.js';
import { clearStaleSingleton } from './context.js';
import {
  isPreferredBrowserUnavailable,
  PREFERRED_BROWSER_CHANNEL,
} from './browser-preference.js';
import {
  enrichErrorWithArtifact,
  type RunMeta,
} from './artifacts.js';
import { detectPageState, type PageState } from './page-state.js';

const stealthPlugin = stealth();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('media.codecs');
chromium.use(stealthPlugin);

const LAUNCH_OPTS = {
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
};

let sharedCtx: BrowserContext | null = null;
let lockRelease: (() => Promise<void>) | null = null;
let opChain: Promise<unknown> = Promise.resolve();
let sharedProfile: string | null = null;

export interface SharedContextStatus {
  profile: string | null;
  browserAlive: boolean;
  pageCount: number;
  currentUrl: string | null;
  pageState: PageState | null;
  loggedIn: boolean | null;
}

export async function getSharedContext(profile?: string): Promise<BrowserContext> {
  const profileName = defaultProfileName(profile);
  if (sharedCtx) {
    if (sharedProfile !== profileName) {
      throw new CliError(
        5,
        'DAEMON_PROFILE_MISMATCH',
        `Daemon shared context is bound to profile "${sharedProfile}", not "${profileName}".`,
      );
    }
    return sharedCtx;
  }
  lockRelease = await acquireLock(profileName);
  const dir = profilePath(profileName);
  await fs.mkdir(dir, { recursive: true });
  await clearStaleSingleton(dir);
  sharedCtx = await launchPreferringEdge(dir, true);
  sharedProfile = profileName;
  await sharedCtx.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });
    } catch {
      /* ignore */
    }
  });
  return sharedCtx;
}

export async function runOnSharedCtx<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
  meta?: RunMeta,
  profile?: string,
): Promise<T> {
  // Append to serial queue. Each op waits for the previous one to finish.
  const prev = opChain;
  let resolveOp!: (v: T) => void;
  let rejectOp!: (e: unknown) => void;
  const opPromise = new Promise<T>((res, rej) => {
    resolveOp = res;
    rejectOp = rej;
  });
  opChain = prev.then(async () => {
    try {
      const ctx = await getSharedContext(profile);
      resolveOp(await fn(ctx));
    } catch (e) {
      const ctx = sharedCtx;
      if (ctx && meta) {
        rejectOp(await enrichErrorWithArtifact(ctx, meta, e));
      } else {
        rejectOp(e);
      }
    }
  });
  return opPromise;
}

export async function getSharedContextStatus(): Promise<SharedContextStatus> {
  if (!sharedCtx) {
    return {
      profile: sharedProfile,
      browserAlive: false,
      pageCount: 0,
      currentUrl: null,
      pageState: null,
      loggedIn: null,
    };
  }

  const pages = sharedCtx.pages().filter((p) => !p.isClosed());
  const page = pages.at(-1) ?? null;
  const pageState = page ? await detectPageState(page).catch(() => null) : null;
  return {
    profile: sharedProfile,
    browserAlive: true,
    pageCount: pages.length,
    currentUrl: page?.url() ?? null,
    pageState,
    loggedIn: pageState
      ? pageState.kind === 'normal_1688_page'
        ? true
        : pageState.kind === 'not_logged_in'
          ? false
          : null
      : null,
  };
}

export async function releaseSharedContext(): Promise<void> {
  if (sharedCtx) {
    await sharedCtx.close().catch(() => {});
    sharedCtx = null;
  }
  sharedProfile = null;
  if (lockRelease) {
    await lockRelease().catch(() => {});
    lockRelease = null;
  }
}

export async function recreateSharedContext(): Promise<void> {
  const profile = sharedProfile;
  await releaseSharedContext();
  if (profile) {
    // Re-create immediately so the next command on the queue gets a fresh context.
    lockRelease = await acquireLock(profile);
    const dir = profilePath(profile);
    await fs.mkdir(dir, { recursive: true });
    await clearStaleSingleton(dir);
    sharedCtx = await launchPreferringEdge(dir, true);
    sharedProfile = profile;
    await sharedCtx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en'],
        });
      } catch {
        /* ignore */
      }
    });
  }
}

async function launchPreferringEdge(
  dir: string,
  headless: boolean,
): Promise<BrowserContext> {
  const useEdge = process.env.BB1688_FORCE_CHROMIUM !== '1';
  if (useEdge) {
    try {
      return (await chromium.launchPersistentContext(dir, {
        ...LAUNCH_OPTS,
        headless,
        channel: PREFERRED_BROWSER_CHANNEL,
      })) as BrowserContext;
    } catch (e) {
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
