const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { resolveCliPath, getRootDir } = require('./cli-resolver.cjs');

// Reuse existing modules (placed in apps/desktop/ for backward compat).
const {
  cancelCommand,
  publicRegistry,
  readHistory,
  runCommand: runCliCommand,
  normalizeAccountStatus,
} = require('../cli-bridge.cjs');

const {
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  setActiveAccount,
  suggestProfileName,
} = require('../accounts.cjs');

const {
  listProductHistory,
  addProductsToHistory,
  clearProductHistory,
} = require('../product-history.cjs');

const {
  loadSettings: loadOzonSettings,
  saveSettings: saveOzonSettings,
  getStoreStats: getOzonStoreStats,
  getCategoryTree: getOzonCategoryTree,
  searchCategories: searchOzonCategories,
  getCategoryAttributes: getOzonCategoryAttributes,
  getCategoryAttributeValues: getOzonCategoryAttributeValues,
} = require('../ozon-settings.cjs');

const {
  generateOzonDraft,
  submitOzonDraft,
  generateOzonAttributeSuggestions,
} = require('../ozon-draft.cjs');

// Built-in AI config — shared by all users. Not in git (gitignored).
const builtinAiConfig = (() => {
  try { return require('../builtin-ai-config.json'); }
  catch { return null; }
})();

function withBuiltinAi(settings) {
  if (builtinAiConfig) {
    settings.ai.baseUrl = builtinAiConfig.baseUrl || settings.ai.baseUrl;
    settings.ai.model = builtinAiConfig.model || settings.ai.model;
    settings.ai.apiKey = builtinAiConfig.apiKey;
  }
  return settings;
}

// ---------- runtime ----------

/** @type {{ rootDir: string, cliPath: string }} */
let runtime = { rootDir: '', cliPath: '' };

function historyDir() {
  return path.join(app.getPath('userData'), 'history');
}

function userDataDir() {
  return app.getPath('userData');
}

/** Shorthand: run a CLI command with the shared runtime and history dir. */
function exec(payload) {
  return runCliCommand(runtime, historyDir(), payload);
}

// Run a CLI command with dispatch auto-restart disabled (BB1688_NO_DAEMON=1).
// Needed for daemon stop/status — otherwise dispatch auto-restarts the daemon.
function execNoDaemon(args, profile) {
  const cliPath = runtime.cliPath;
  const childArgs = [cliPath, ...args, '--profile', String(profile), '--json'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: runtime.rootDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BB1688_NO_DAEMON: '1', BB1688_JSON: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      try { resolve({ exitCode: code, data: JSON.parse(stdout.trim()), stderr }); }
      catch { resolve({ exitCode: code, data: null, stderr, raw: stdout }); }
    });
    child.on('error', reject);
  });
}

// ---------- window ----------

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: '1688 to Ozon Studio',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'dist', 'index.html'),
    );
  }
}

// ---------- IPC handlers ----------

function registerIpc() {
  // --- command registry ---
  ipcMain.handle('desktop:getCommandRegistry', () => publicRegistry());

  // --- command execution ---
  ipcMain.handle('desktop:runCommand', (_event, payload) => exec(payload));
  ipcMain.handle('desktop:cancelCommand', (_event, runId) => cancelCommand(runId));

  // --- history ---
  ipcMain.handle('desktop:getCommandHistory', (_event, query) => readHistory(historyDir(), query));

  // --- runtime ---
  ipcMain.handle('desktop:getRuntimeStatus', async (_event, profile = 'default') => {
    const [daemon, whoami] = await Promise.allSettled([
      exec({ commandId: 'daemonStatus', profile, saveHistory: false, timeoutMs: 8000 }),
      exec({ commandId: 'whoami', profile, saveHistory: false, timeoutMs: 8000 }),
    ]);
    return {
      profile,
      daemon: daemon.status === 'fulfilled' ? daemon.value : null,
      account: whoami.status === 'fulfilled' ? whoami.value : null,
    };
  });

  ipcMain.handle('desktop:getCliInfo', () => ({
    cliPath: runtime.cliPath,
    cliExists: true,
    rootDir: runtime.rootDir,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('desktop:doctor', async (_event, profile) => {
    try {
      const record = await exec({
        commandId: 'doctor',
        profile,
        saveHistory: false,
        timeoutMs: 15000,
        options: { noLaunch: true },
      });
      return { ok: record.status === 'success', ...record };
    } catch (error) {
      return { ok: false, message: (error && error.message) || String(error) };
    }
  });

  // --- file utilities (temp image for clipboard paste) ---
  ipcMain.handle('desktop:writeTempImage', async (_event, { base64, contentType }) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
    if (!allowed.includes(contentType)) {
      throw new Error(`不支持的文件类型: ${contentType}`);
    }
    const buf = Buffer.from(base64, 'base64');
    if (buf.length < 1024) throw new Error('图片数据过小 (< 1KB)');
    if (buf.length > 20 * 1024 * 1024) throw new Error(`图片过大 (${(buf.length / 1024 / 1024).toFixed(1)}MB > 20MB)`);

    // Validate magic bytes
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    const isBmp = buf[0] === 0x42 && buf[1] === 0x4d;
    if (!isJpg && !isPng && !isWebp && !isBmp) {
      throw new Error('文件内容不是有效图片 (magic bytes 不匹配)');
    }

    const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/bmp': '.bmp' };
    const ext = extMap[contentType] || '.png';
    const tmpName = `bb1688-clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const tmpPath = path.join(os.tmpdir(), tmpName);
    await fs.promises.writeFile(tmpPath, buf);
    console.log('[clipboard] wrote temp image', tmpPath, `(${(buf.length / 1024).toFixed(1)}KB)`);
    return { path: tmpPath };
  });

  // --- accounts ---
  ipcMain.handle('desktop:listAccounts', () => listAccounts(userDataDir()));

  ipcMain.handle('desktop:addAccount', (_event, params) => addAccount(userDataDir(), params));

  ipcMain.handle('desktop:updateAccount', (_event, profile, params) => updateAccount(userDataDir(), profile, params));

  ipcMain.handle('desktop:removeAccount', (_event, profile) => removeAccount(userDataDir(), profile));

  ipcMain.handle('desktop:setActiveAccount', (_event, profile) => setActiveAccount(userDataDir(), profile));

  ipcMain.handle('desktop:suggestProfileName', () => suggestProfileName(userDataDir()));

  ipcMain.handle('desktop:loginAccount', async (_event, profile) => {
    const record = await exec({
      commandId: 'login',
      profile,
      confirmed: true,
      options: { headed: true, force: true, timeout: 300 },
    });
    const status = normalizeAccountStatus(record.status);
    try {
      updateAccount(userDataDir(), profile, {
        status,
        lastLoginAt: new Date().toISOString(),
      });
    } catch { /* account may not exist yet */ }
    return { ...record, accountStatus: status };
  });

  ipcMain.handle('desktop:refreshAccountStatus', async (_event, profile) => {
    let status = 'unknown';
    try {
      const whoami = await exec({
        commandId: 'whoami',
        profile,
        saveHistory: false,
        timeoutMs: 15000,
        options: { verify: true },
      });
      status = inferWhoamiAccountStatus(whoami);
    } catch {
      status = 'error';
    }
    try { updateAccount(userDataDir(), profile, { status }); } catch {}
    return { profile, status };
  });

  // --- product history ---
  ipcMain.handle('desktop:listProductHistory', (_event, limit) =>
    listProductHistory(userDataDir(), limit),
  );
  ipcMain.handle('desktop:addProductsToHistory', (_event, products, meta) =>
    addProductsToHistory(userDataDir(), products, meta),
  );
  ipcMain.handle('desktop:clearProductHistory', () =>
    clearProductHistory(userDataDir()),
  );

  // --- Ozon draft / AI / submit ---
  ipcMain.handle('desktop:getOzonSettings', () =>
    loadOzonSettings(userDataDir()),
  );
  ipcMain.handle('desktop:saveOzonSettings', (_event, patch) =>
    saveOzonSettings(userDataDir(), patch),
  );
  ipcMain.handle('desktop:getOzonStoreStats', () =>
    getOzonStoreStats(userDataDir()),
  );
  ipcMain.handle('desktop:getOzonCategoryTree', (_event, options) =>
    getOzonCategoryTree(userDataDir(), options || {}),
  );
  ipcMain.handle('desktop:searchOzonCategories', (_event, query, options) =>
    searchOzonCategories(userDataDir(), query || '', options || {}),
  );
  ipcMain.handle('desktop:getOzonCategoryAttributes', (_event, params) =>
    getOzonCategoryAttributes(userDataDir(), params || {}),
  );
  ipcMain.handle('desktop:getOzonCategoryAttributeValues', (_event, params) =>
    getOzonCategoryAttributeValues(userDataDir(), params || {}),
  );
  ipcMain.handle('desktop:generateOzonDraft', async (_event, rows) =>
    generateOzonDraft(withBuiltinAi({ ...loadOzonSettings(userDataDir(), { includeSecrets: true }), userDataPath: userDataDir() }), rows),
  );

  ipcMain.handle('desktop:generateOzonAttributeSuggestions', async (_event, params) =>
    generateOzonAttributeSuggestions(withBuiltinAi({ ...loadOzonSettings(userDataDir(), { includeSecrets: true }), userDataPath: userDataDir() }), params || {}),
  );

  ipcMain.handle('desktop:submitOzonDraft', async (_event, draft, confirmed) => {
    if (confirmed !== true) {
      throw new Error('提交 Ozon 前必须确认。');
    }
    const settings = loadOzonSettings(userDataDir(), { includeSecrets: true });
    return submitOzonDraft(settings, draft);
  });

  // --- terminal login (kept for debug, not used by UI) ---
  ipcMain.handle('desktop:loginAccountInTerminal', async (_event, profile) => {
    return { ok: true, profile: String(profile), mode: 'terminal-deprecated' };
  });
  ipcMain.handle('desktop:loginAccountsInTerminal', async (_event, profiles) => {
    return { ok: false, message: '请使用浏览器登录按钮。' };
  });

  // --- browser login: spawn CLI login --headed directly ---
  const activeLoginProcesses = new Map();

  async function stopDaemonForProfile(profile) {
    // Use execNoDaemon to prevent dispatch from auto-restarting the daemon
    try { await execNoDaemon(['daemon', 'stop'], profile); } catch {}
    // Poll until confirmed stopped
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const r = await execNoDaemon(['daemon', 'status'], profile);
        if (r.data && !r.data.running) {
          console.log('[login-browser] daemon confirmed stopped for', profile);
          return;
        }
      } catch {}
    }
    throw new Error(`无法停止 ${profile} 的 daemon，请手动关闭后重试。`);
  }

  function inferWhoamiAccountStatus(record) {
  if (record.status !== 'success' || record.exitCode !== 0) {
    const code = (record.error && record.error.status) || '';
    if (code === 'profile_busy') return 'busy';
    return normalizeAccountStatus(record.status);
  }
  const data = record.stdoutJson;
  if (data && typeof data === 'object' && (data.loggedIn === true || data.memberId || data.nick)) return 'logged_in';
  if (data && typeof data === 'object' && (data.loggedIn === false || data.ok === false)) return 'not_logged_in';
  return 'unknown';
}

async function openLoginBrowser(profile) {
    const p = String(profile || '').trim();
    if (!p) throw new Error('profile 不能为空');
    const args = [
      runtime.cliPath,
      'login', '--profile', p, '--force', '--headed', '--timeout', '300', '--no-daemon', '--json', '--pretty',
    ];
    console.log('[login-browser] spawn', p);
    const child = spawn(process.execPath, args, {
      cwd: runtime.rootDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BB1688_JSON: '1' },
      detached: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeLoginProcesses.set(runId, { profile: p, child });
    child.stdout.on('data', (chunk) => { console.log(`[login-browser:${p}]`, chunk.toString()); });
    child.stderr.on('data', (chunk) => { console.warn(`[login-browser:${p}]`, chunk.toString()); });
    child.on('close', (code) => { console.log('[login-browser] closed', p, code); activeLoginProcesses.delete(runId); });

    // Wait for first successful output or error, up to 8s
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`登录浏览器启动超时，请手动运行: 1688 login --profile ${p} --headed`));
      }, 8000);
      let firstOutput = '';
      const onData = (chunk) => {
        firstOutput += chunk.toString();
        try {
          const json = JSON.parse(firstOutput.trim().split('\n')[0]);
          clearTimeout(timer);
          if (json.ok === false) {
            reject(new Error(json.message || json.code || '登录浏览器启动失败'));
          } else {
            resolve({ ok: true, profile: p, runId, pid: child.pid, mode: 'browser' });
          }
        } catch { /* wait for more data */ }
      };
      child.stdout.on('data', onData);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ ok: true, profile: p, runId, pid: child.pid, mode: 'browser' });
        } else {
          reject(new Error(`登录浏览器启动失败 (exit ${code})，请手动运行: 1688 login --profile ${p} --headed`));
        }
      });
    });
  }

  ipcMain.handle('desktop:loginAccountBrowser', async (_event, profile) => {
    await stopDaemonForProfile(profile);
    const result = await openLoginBrowser(profile);
    try { updateAccount(userDataDir(), profile, { status: 'login_opened', lastLoginAt: null }); } catch {}
    return { ...result, state: 'login_opened' };
  });
  ipcMain.handle('desktop:loginAccountsBrowser', async (_event, profiles) => {
    const uniqueProfiles = Array.from(new Set((profiles || []).map(String).map((s) => s.trim()).filter(Boolean))).slice(0, 3);
    console.log('[login-browser] batch', uniqueProfiles);
    const opened = [];
    for (const profile of uniqueProfiles) {
      try {
        await stopDaemonForProfile(profile);
        opened.push((await openLoginBrowser(profile)).profile);
        try { updateAccount(userDataDir(), profile, { status: 'login_opened', lastLoginAt: null }); } catch {}
        await new Promise((r) => setTimeout(r, 800));
      } catch (e) { console.error('[login-browser] error', profile, e); }
    }
    return { ok: opened.length > 0, requestedProfiles: uniqueProfiles, openedProfiles: opened, openedCount: opened.length, mode: 'browser' };
  });
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  try {
    runtime.cliPath = resolveCliPath();
    runtime.rootDir = getRootDir();
  } catch (error) {
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'CLI 缺失',
      (error && error.message) || '找不到内置 CLI，请联系管理员。',
    );
    app.quit();
    return;
  }

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
