#!/usr/bin/env node
// Best-effort Chromium install. Never fail the parent npm install.
//
// Strategy:
//   1. If Microsoft Edge is installed, skip Chromium entirely
//      (runtime uses channel:'msedge' by default).
//   2. If Chromium is already cached, skip.
//   3. Auto-select mirror based on timezone — China users hit npmmirror,
//      international users hit official. User can override.
//   4. Failure is non-fatal: print recovery instructions.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (process.env.CI || process.env.BB1688_SKIP_POSTINSTALL) {
  process.exit(0);
}

// ── 0. Stop any running daemon so it restarts with the new code ───────────
// Otherwise the old daemon keeps serving stale code until the user runs
// `1688 daemon stop` manually after every upgrade.
try {
  const pidFile = path.join(
    process.env.BB1688_HOME ?? path.join(os.homedir(), '.1688'),
    'daemon.pid',
  );
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(
          `1688-cli: stopped previous daemon (pid ${pid}); it will auto-start with the new code on next command.`,
        );
      } catch {
        // Process already dead or owned by another user — harmless.
      }
    }
  }
} catch {
  /* ignore */
}

// ── 1. System Edge detection ──────────────────────────────────────────────
function hasSystemEdge() {
  const candidates = {
    darwin: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta',
    ],
    win32: [
      path.join(
        process.env['ProgramFiles'] ?? 'C:\\Program Files',
        'Microsoft/Edge/Application/msedge.exe',
      ),
      path.join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Microsoft/Edge/Application/msedge.exe',
      ),
      path.join(
        process.env['LOCALAPPDATA'] ?? '',
        'Microsoft/Edge/Application/msedge.exe',
      ),
    ],
    linux: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/microsoft-edge-beta',
    ],
  }[process.platform] ?? [];
  return candidates.some((p) => p && fs.existsSync(p));
}

if (hasSystemEdge()) {
  console.log('1688-cli: Microsoft Edge detected. Skipping Chromium download.');
  console.log('          (Runtime will use Edge via channel:"msedge".)');
  process.exit(0);
}

// ── 2. Chromium cache check ───────────────────────────────────────────────
function chromiumCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library/Caches/ms-playwright');
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA ?? os.homedir(),
        'ms-playwright',
      );
    default:
      return path.join(os.homedir(), '.cache/ms-playwright');
  }
}

const cache = chromiumCacheDir();
const cached =
  fs.existsSync(cache) &&
  fs.readdirSync(cache).some((n) => n.startsWith('chromium'));

if (cached) {
  console.log('1688-cli: Chromium already cached, skipping download.');
  process.exit(0);
}

// ── 3. Mirror selection ───────────────────────────────────────────────────
function pickDownloadHost() {
  // User override wins.
  if (process.env.PLAYWRIGHT_DOWNLOAD_HOST) {
    return process.env.PLAYWRIGHT_DOWNLOAD_HOST;
  }
  // Heuristic: China timezone → npmmirror (much faster + reachable).
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const isChinaTZ =
      /Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Kashgar|Hong_Kong|Macau)/.test(
        tz,
      );
    if (isChinaTZ) {
      return 'https://npmmirror.com/mirrors/playwright';
    }
  } catch {
    /* fall through */
  }
  // Default: empty → playwright uses official.
  return '';
}

const downloadHost = pickDownloadHost();
const usingMirror = downloadHost.includes('npmmirror');

console.log(
  `1688-cli: Installing Chromium (~150MB)${
    usingMirror ? ' via npmmirror (China mirror)' : ''
  }...`,
);

const env = { ...process.env };
if (downloadHost) env.PLAYWRIGHT_DOWNLOAD_HOST = downloadHost;

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(npxCmd, ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  env,
});

if (res.status !== 0) {
  const retryCommand =
    process.platform === 'win32'
      ? '             $env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"; npx playwright install chromium\n'
      : '             PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright \\\n' +
        '               npx playwright install chromium\n';
  console.log(
    '\n1688-cli: Chromium download failed (non-fatal).\n' +
      '          Try running manually:\n' +
      '          1) Install Microsoft Edge from https://www.microsoft.com/edge/download (recommended), or\n' +
      '          2) Force-retry with mirror:\n' +
      retryCommand,
  );
}
process.exit(0);
