import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  defaultProfileName,
  root,
  stateFile,
  lockFile,
  profilePath,
  runsDir,
} from '../session/paths.js';
import { readState } from '../session/state.js';
import { emit } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { appendEvent, readRecentEvents } from '../session/events.js';
import {
  PREFERRED_BROWSER_CHANNEL,
  PREFERRED_BROWSER_LABEL,
} from '../session/browser-preference.js';
import pkg from '../../package.json' with { type: 'json' };

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  updateCommand: string | null;
  error: string | null;
}

function isNewerSemver(latest: string, current: string): boolean {
  // Plain x.y.z compare. Pre-release tags (e.g. "-beta.1") are not used by
  // this project; if they appear, treat anything different from current as
  // not-newer to avoid recommending downgrade.
  const parse = (v: string): number[] | null => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
    return m ? [m[1]!, m[2]!, m[3]!].map((n) => parseInt(n, 10)) : null;
  };
  const lp = parse(latest);
  const cp = parse(current);
  if (!lp || !cp) return false;
  for (let i = 0; i < 3; i++) {
    if (lp[i]! !== cp[i]!) return lp[i]! > cp[i]!;
  }
  return false;
}

async function checkUpdate(): Promise<{ check: Check; version: VersionInfo }> {
  const current = pkg.version;
  let latest: string | null = null;
  let error: string | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `https://registry.npmjs.org/${pkg.name}/latest`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as { version?: string };
      latest = j.version ?? null;
    } else {
      error = `registry ${res.status}`;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  const updateAvailable = latest !== null && isNewerSemver(latest, current);
  const check: Check = {
    name: 'Version',
    status: error ? 'warn' : updateAvailable ? 'warn' : 'ok',
    message: error
      ? `current ${current} (update check failed: ${error})`
      : updateAvailable
        ? `${current} → ${latest} available`
        : `${current} (latest)`,
    fix: updateAvailable ? `npm i -g ${pkg.name}@latest` : undefined,
  };
  return {
    check,
    version: {
      current,
      latest,
      updateAvailable,
      updateCommand: updateAvailable ? `npm i -g ${pkg.name}@latest` : null,
      error,
    },
  };
}

export interface DoctorOpts {
  launch?: boolean;
  live?: boolean;
  profile?: string;
}

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  message: string;
  fix?: string;
}

export async function run(opts: DoctorOpts): Promise<void> {
  const profile = defaultProfileName(opts.profile);
  const checks: Check[] = [];
  checks.push(checkNode());
  checks.push(await checkYibabaRoot());
  checks.push(await checkProfile(profile));
  checks.push(await checkChromiumCache());
  checks.push(await checkLock(profile));
  checks.push(await checkStateFile(profile));
  if (opts.launch !== false) {
    checks.push(await checkChromiumLaunch());
  }
  checks.push(await checkSession(profile));
  const daemon = await checkDaemonHealth(profile);
  checks.push(daemon.check);
  if (opts.live) {
    checks.push(...(await checkLiveProbes(daemon.status, profile)));
  }
  const upd = await checkUpdate();
  checks.push(upd.check);

  const failed = checks.some((c) => c.status === 'fail');

  emit({
    human: () => printHuman(checks),
    // `version` is surfaced at top-level so agents can read it without
    // having to scan `checks[]`. See AGENTS.md → Update awareness.
    data: { ok: !failed, profile, checks, version: upd.version, daemon: daemon.status },
  });

  if (failed) throw new CliError(6, 'DOCTOR_FAILED', '');
}

function checkNode(): Check {
  const v = process.versions.node;
  const major = parseInt(v.split('.')[0] ?? '0', 10);
  if (major >= 20) {
    return { name: 'Node version', status: 'ok', message: `v${v}` };
  }
  return {
    name: 'Node version',
    status: 'fail',
    message: `v${v} (need >= 20)`,
    fix: 'Upgrade Node (e.g. `nvm install 20`).',
  };
}

export function writePermissionFix(dir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `Grant write permission to "${dir}" or set BB1688_HOME to a writable directory.`;
  }
  return `chmod u+w "${dir}"`;
}

export function removePathFix(
  target: string,
  platform: NodeJS.Platform = process.platform,
  opts: { recursive?: boolean } = {},
): string {
  if (platform === 'win32') {
    return opts.recursive
      ? `PowerShell: Remove-Item -Recurse -Force "${target}"`
      : `PowerShell: Remove-Item -Force "${target}"`;
  }
  return opts.recursive ? `rm -rf "${target}"` : `rm "${target}"`;
}

async function checkYibabaRoot(): Promise<Check> {
  const dir = root();
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir, fs.constants.W_OK);
    return { name: '1688 home', status: 'ok', message: dir };
  } catch (e) {
    return {
      name: '1688 home',
      status: 'fail',
      message: `${dir}: ${(e as Error).message}`,
      fix: writePermissionFix(dir),
    };
  }
}

async function checkProfile(name?: string): Promise<Check> {
  const dir = profilePath(name);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir, fs.constants.W_OK);
    return { name: 'profile dir', status: 'ok', message: dir };
  } catch (e) {
    return {
      name: 'profile dir',
      status: 'fail',
      message: `${dir}: ${(e as Error).message}`,
    };
  }
}

function chromiumCacheDir(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Caches/ms-playwright');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? os.homedir(),
      'ms-playwright',
    );
  }
  return path.join(os.homedir(), '.cache/ms-playwright');
}

async function checkChromiumCache(): Promise<Check> {
  const cache = chromiumCacheDir();
  try {
    const entries = await fs.readdir(cache);
    const hit = entries.find((n) => n.startsWith('chromium'));
    if (hit) {
      return {
        name: 'Chromium cache',
        status: 'ok',
        message: `${hit} @ ${cache}`,
      };
    }
    return {
      name: 'Chromium cache',
      status: 'fail',
      message: `no chromium-* dir in ${cache}`,
      fix: 'npx playwright install chromium',
    };
  } catch {
    return {
      name: 'Chromium cache',
      status: 'fail',
      message: `cache dir missing (${cache})`,
      fix: 'npx playwright install chromium',
    };
  }
}

async function checkLock(profile: string): Promise<Check> {
  // proper-lockfile uses `<lock>.lock` as the semaphore directory.
  const semaphore = lockFile(profile) + '.lock';
  try {
    const st = await fs.stat(semaphore);
    const ageMs = Date.now() - st.mtimeMs;

    // Lock held — but if it's the daemon holding it, that's expected.
    const { status: daemonStatus } = await import('../daemon/manager.js');
    const ds = await daemonStatus(profile);
    if (ds.running && ds.pid) {
      return {
        name: 'lock',
        status: 'ok',
        message: `held by daemon for profile "${profile}" (pid ${ds.pid})`,
      };
    }

    if (ageMs > 5 * 60 * 1000) {
      return {
        name: 'lock',
        status: 'warn',
        message: `stale lock (${Math.round(ageMs / 1000)}s old)`,
        fix: removePathFix(semaphore, process.platform, { recursive: true }),
      };
    }
    return {
      name: 'lock',
      status: 'warn',
      message: `another 1688 command appears to be running for profile "${profile}"`,
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { name: 'lock', status: 'ok', message: 'free' };
    }
    return {
      name: 'lock',
      status: 'warn',
      message: `unknown: ${(e as Error).message}`,
    };
  }
}

async function checkStateFile(profile: string): Promise<Check> {
  try {
    const s = await readState(profile);
    if (s.version !== 1) {
      return {
        name: 'state.json',
        status: 'warn',
        message: `unexpected version ${s.version}`,
      };
    }
    return { name: 'state.json', status: 'ok', message: stateFile(profile) };
  } catch (e) {
    return {
      name: 'state.json',
      status: 'warn',
      message: `unreadable: ${(e as Error).message}`,
      fix: removePathFix(stateFile(profile)),
    };
  }
}

async function checkChromiumLaunch(): Promise<Check> {
  // Mirror runtime preference: try system Edge first (channel:'msedge'),
  // fall back to bundled Chromium. Either being launchable is acceptable.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-doctor-'));
  const preferEdge = process.env.BB1688_FORCE_CHROMIUM !== '1';

  async function tryLaunch(opts: { channel?: typeof PREFERRED_BROWSER_CHANNEL }): Promise<string> {
    const ctx = await chromium.launchPersistentContext(tmp, {
      headless: true,
      ...opts,
    });
    await ctx.close();
    return opts.channel === PREFERRED_BROWSER_CHANNEL ? PREFERRED_BROWSER_LABEL : 'bundled Chromium';
  }

  try {
    if (preferEdge) {
      try {
        const which = await tryLaunch({ channel: PREFERRED_BROWSER_CHANNEL });
        return {
          name: 'browser launch',
          status: 'ok',
          message: `headless launch OK (${which})`,
        };
      } catch {
        // Fall through to bundled Chromium.
      }
    }
    const which = await tryLaunch({});
    return {
      name: 'browser launch',
      status: 'ok',
      message: `headless launch OK (${which})`,
    };
  } catch (e) {
    const first = (e as Error).message.split('\n')[0] ?? 'launch failed';
    return {
      name: 'browser launch',
      status: 'fail',
      message: first,
      fix: 'Install Microsoft Edge from https://www.microsoft.com/edge/download OR run: npx playwright install chromium',
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

interface DaemonHealthSnapshot {
  lastPageState?: string | null;
  lastFailureKind?: string | null;
  lastRecoveryAction?: string | null;
  consecutiveFailures?: number;
  consecutiveRateLimits?: number;
  lastSuccessfulActionAt?: string | null;
  pausedUntil?: string | null;
}

interface DoctorDaemonStatus {
  profile?: string;
  running: boolean;
  reachable?: boolean;
  pid?: number;
  version?: string | null;
  expectedVersion?: string;
  versionMatches?: boolean;
  stats?: unknown;
}

async function checkDaemonHealth(profile: string): Promise<{
  check: Check;
  status: DoctorDaemonStatus | null;
}> {
  try {
    const { status } = await import('../daemon/manager.js');
    const st = (await status(profile)) as DoctorDaemonStatus;
    if (!st.running) {
      return {
        status: st,
        check: { name: 'daemon', status: 'ok', message: `not running for profile "${profile}"` },
      };
    }
    if (!st.reachable) {
      return {
        status: st,
        check: {
          name: 'daemon',
          status: 'warn',
          message: `profile "${profile}" pid ${st.pid ?? '?'} not reachable`,
          fix: `1688 daemon reload --profile ${profile}`,
        },
      };
    }
    if (st.versionMatches === false) {
      return {
        status: st,
        check: {
          name: 'daemon',
          status: 'warn',
          message: `profile "${profile}" version ${st.version ?? '?'} != CLI ${st.expectedVersion ?? '?'}`,
          fix: `1688 daemon reload --profile ${profile}`,
        },
      };
    }

    const stats = st.stats && typeof st.stats === 'object'
      ? (st.stats as { health?: DaemonHealthSnapshot })
      : null;
    const health = stats?.health;
    if (health?.pausedUntil) {
      return {
        status: st,
        check: {
          name: 'daemon',
          status: 'warn',
          message: `paused until ${health.pausedUntil} (${health.lastFailureKind ?? 'unknown'})`,
          fix: `Resolve login/risk-control for profile "${profile}" if needed, or wait for pause to expire.`,
        },
      };
    }
    if ((health?.consecutiveFailures ?? 0) > 0) {
      return {
        status: st,
        check: {
          name: 'daemon',
          status: 'warn',
          message: `running; recent failures=${health?.consecutiveFailures ?? 0}, last=${health?.lastFailureKind ?? 'unknown'}`,
        },
      };
    }
    return {
      status: st,
      check: {
        name: 'daemon',
        status: 'ok',
        message: `profile "${profile}" running pid ${st.pid ?? '?'}${health?.lastSuccessfulActionAt ? `, last success ${health.lastSuccessfulActionAt}` : ''}`,
      },
    };
  } catch (e) {
    return {
      status: null,
      check: {
        name: 'daemon',
        status: 'warn',
        message: `status unavailable: ${(e as Error).message}`,
      },
    };
  }
}

async function checkLiveProbes(
  daemon: DoctorDaemonStatus | null,
  profile: string,
): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(checkDaemonLiveProbe(daemon, profile));
  checks.push(await checkEventLogWrite(profile));
  checks.push(await checkArtifactWrite());
  checks.push(await checkRecentRiskEvent(profile));
  return checks;
}

function checkDaemonLiveProbe(daemon: DoctorDaemonStatus | null, profile: string): Check {
  if (!daemon?.running) {
    return {
      name: 'live daemon socket',
      status: 'warn',
      message: `daemon not running for profile "${profile}"; commands will use inline browser sessions`,
      fix: `1688 daemon start --profile ${profile}`,
    };
  }
  if (!daemon.reachable) {
    return {
      name: 'live daemon socket',
      status: 'fail',
      message: `daemon for profile "${profile}" pid ${daemon.pid ?? '?'} is not reachable`,
      fix: `1688 daemon reload --profile ${profile}`,
    };
  }
  return {
    name: 'live daemon socket',
    status: 'ok',
    message: 'reachable',
  };
}

async function checkEventLogWrite(profile: string): Promise<Check> {
  try {
    await appendEvent({
      ts: new Date().toISOString(),
      requestId: `doctor-live-${Date.now().toString(36)}`,
      cmd: 'doctor',
      phase: 'end',
      status: 'ok',
      profile,
    });
    return { name: 'live event log', status: 'ok', message: 'writable' };
  } catch (e) {
    return {
      name: 'live event log',
      status: 'fail',
      message: `unwritable: ${(e as Error).message}`,
      fix: writePermissionFix(root()),
    };
  }
}

async function checkArtifactWrite(): Promise<Check> {
  const dir = path.join(runsDir(), `.doctor-live-${Date.now().toString(36)}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'probe.json'), JSON.stringify({ ok: true }));
    return { name: 'live artifact write', status: 'ok', message: 'writable' };
  } catch (e) {
    return {
      name: 'live artifact write',
      status: 'fail',
      message: `unwritable: ${(e as Error).message}`,
      fix: writePermissionFix(runsDir()),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function checkRecentRiskEvent(profile: string): Promise<Check> {
  const recent = await readRecentEvents(50);
  const risk = [...recent]
    .reverse()
    .find(
      (e) =>
        (e.profile === profile || (!e.profile && profile === 'default')) &&
        (e.verification?.state === 'risk_control' || e.errorCode === 'RISK_CONTROL'),
    );
  if (!risk) {
    return { name: 'live recent risk', status: 'ok', message: 'no recent risk-control event' };
  }
  return {
    name: 'live recent risk',
    status: 'warn',
    message: `recent risk event in ${risk.cmd} (${risk.requestId})`,
    fix: 'Run the affected command with --headed if verification is still active.',
  };
}

async function checkSession(profile: string): Promise<Check> {
  try {
    const s = await readState(profile);
    if (s.memberId) {
      const name = s.nick ?? s.memberId;
      return {
        name: 'session',
        status: 'ok',
        message: `${name} (memberId: ${s.memberId}, profile "${profile}", cached)`,
      };
    }
    return {
      name: 'session',
      status: 'warn',
      message: `not logged in for profile "${profile}"`,
      fix: `1688 login --profile ${profile}`,
    };
  } catch {
    return { name: 'session', status: 'warn', message: 'unknown' };
  }
}

function printHuman(checks: Check[]): void {
  const icon = (s: Status) => (s === 'ok' ? '✓' : s === 'warn' ? '⚠' : '✗');
  const pad = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    process.stdout.write(
      `${icon(c.status)}  ${c.name.padEnd(pad)}  ${c.message}\n`,
    );
    if (c.fix && c.status !== 'ok') {
      process.stdout.write(`   ${' '.repeat(pad)}  fix: ${c.fix}\n`);
    }
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  process.stdout.write('\n');
  if (failed) {
    process.stdout.write(`${failed} failed, ${warned} warning(s).\n`);
  } else if (warned) {
    process.stdout.write(
      `All critical checks passed (${warned} warning(s)).\n`,
    );
  } else {
    process.stdout.write('All checks passed.\n');
  }
}
