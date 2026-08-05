# Desktop Build Guide — 1688 to Ozon Studio

## Architecture

```
┌─ Electron Main Process (apps/desktop/main/main.cjs) ──────────────┐
│  package.json "main" → apps/desktop/main/main.cjs                  │
│  cli-resolver.cjs → resolveCliPathForMode({ isPackaged, ... })     │
│  runtime = { rootDir, cliPath } threaded to cli-bridge.cjs         │
│  runCommand(runtime, historyDir, payload)                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ preload (apps/desktop/preload/preload.cjs)
┌─ React Renderer (apps/desktop/renderer/) ──────────────────────────┐
│  Vite + React 19 + TypeScript                                       │
│  Components: AccountSelector, RuntimeStatusPanel, CommandPanel      │
│  Typed API: commands.* / accounts.* / runtime.*                    │
└────────────────────────────────────────────────────────────────────┘
```

CLI is the built-in execution engine. CLI path is resolved by `cli-resolver.cjs`
and threaded through `runtime.cliPath` into `cli-bridge.cjs` → `runCommand()`.

## Dev Mode

```bash
npm run desktop:dev
```

1. Starts Vite dev server at http://localhost:5173
2. Starts Electron loading the dev URL
3. `cli-resolver` returns `<project-root>/dist/cli.js`

## Build

```bash
npm run build              # Build TypeScript CLI → dist/cli.js
npm run desktop:build      # Build CLI + Vite React renderer
```

## Pack (local exe, no installer)

```bash
npm run desktop:pack
```

Output: `release/win-unpacked/1688 to Ozon Studio.exe`

## Dist (Windows installer)

```bash
npm run desktop:dist
```

Output: `release/1688 to Ozon Studio Setup.exe`

## CLI Path Resolution

| Mode | Path | Resolver |
|---|---|---|
| Dev | `<project-root>/dist/cli.js` | `resolveCliPathForMode({ isPackaged: false })` |
| Packaged | `<resourcesPath>/cli/dist/cli.js` | `resolveCliPathForMode({ isPackaged: true })` |

`cli-bridge.cjs` `runCommand()` accepts `runtime = { rootDir, cliPath }`.
If `runtime.cliPath` is set, it's used directly; otherwise falls back to
`<rootDir>/dist/cli.js` (dev mode compatibility).

## ELECTRON_RUN_AS_NODE

In packaged mode, `process.execPath` is the Electron exe, not node.exe.
The CLI spawn sets `ELECTRON_RUN_AS_NODE: '1'` in the child process
environment so Electron can execute Node.js CLI scripts correctly.

## Chrome / Playwright Dependency

The packaged app bundles `node_modules/` (including playwright) but does NOT
bundle Playwright's Chromium browser binary (~150 MB). Employees must have
Microsoft Edge installed. Playwright uses `channel: 'msedge'`
to detect the system browser.

## Account Status Mapping

CLI exit statuses are normalized by `normalizeAccountStatus()`:

| CLI Status | Canonical |
|---|---|
| `success` | `logged_in` |
| `not_logged_in` | `not_logged_in` |
| `risk_control` | `risk_control` |
| `profile_busy` | `busy` |
| `network_error` | `network_error` |
| `failed`, `timeout`, `cancelled` | `error` |
| anything else | passed through |

## Smoke Test

```bash
# 1. Build
npm run desktop:build

# 2. Pack
npm run desktop:pack

# 3. Launch
release/win-unpacked/1688 to Ozon Studio.exe

# 4. Verify
# - APP opens
# - Runtime status shows CLI: 内置引擎 (packaged) or 开发模式 (dev)
# - Doctor / whoami / search commands reach the CLI layer
# - No "CLI_NOT_BUILT" or "Cannot find module" errors
```

## Known Limitations

- Playwright Chromium browser binary is NOT bundled; system Chrome/Edge required
- No code signing certificate; Windows SmartScreen may warn on first launch
- `icon: null` in electron-builder config (no app icon)
- Depends on `node_modules/` being included in the asar/app bundle

## Old Files (kept for backward compat)

- `apps/desktop/main.cjs` — replaced by `apps/desktop/main/main.cjs`
- `apps/desktop/preload.cjs` — replaced by `apps/desktop/preload/preload.cjs`
- `apps/desktop/index.html` — replaced by React renderer
- `apps/desktop/renderer.js` — replaced by React renderer
- `apps/desktop/styles.css` — replaced by React renderer

Shared modules:
- `apps/desktop/cli-bridge.cjs` — still used (updated to accept runtime object)
- `apps/desktop/accounts.cjs` — still used (unchanged)
