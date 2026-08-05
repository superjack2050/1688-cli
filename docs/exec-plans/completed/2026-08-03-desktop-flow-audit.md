# Plan: Desktop 1688-to-Ozon Flow Audit

## Goal

Restore reliable Ozon category-tree discovery, switch Playwright's preferred
system browser from Google Chrome to Microsoft Edge, and verify the desktop
workflow from 1688 collection through Ozon draft/precheck with deterministic
simulation and current-run screenshots.

## Context

- User-provided current-state screenshot:
  `C:\Users\yifan\AppData\Local\Temp\codex-clipboard-261321d5-7200-4758-af32-df72704af2ce.png`.
- The repository already contained uncommitted desktop UI cleanup changes;
  those changes were preserved and built upon.
- Browser automation is centralized in `src/session/context.ts` and
  `src/session/shared.ts`.
- Ozon category cache/API handling lives in `apps/desktop/ozon-settings.cjs`;
  category discovery UI exists in the desktop renderer.

## Non-goals

- Do not place a real 1688 order, change cart state, contact a seller, or
  submit a live Ozon listing.
- Do not force login/logout or erase the user's saved browser profile.
- Do not redesign unrelated desktop screens.
- Do not change stable CLI JSON output contracts.

## Checklist

- [x] Capture and inspect the current desktop entry state.
- [x] Reproduce/narrow the missing category-tree behavior.
- [x] Fix category loading, discovery, or fallback behavior with regression
  coverage.
- [x] Prefer Microsoft Edge for Playwright persistent contexts and doctor
  checks, with bounded bundled-Chromium fallback.
- [x] Add a deterministic simulated 1688-to-Ozon flow test.
- [x] Run focused checks, full agent verification, and current-run visual
  capture.
- [x] Save an inline-audit companion report with findings and evidence limits.

## Verification

- `pnpm typecheck`: passed.
- Focused Vitest files: 4 files, 14 tests passed.
- `pnpm --dir apps/desktop/renderer build`: passed.
- `pnpm agent-context`: passed and generated indexes updated.
- `pnpm agent-verify`: passed, 36 files and 225 tests.
- Manual Electron walkthrough: passed for non-mutating current states.
- CLI doctor: Microsoft Edge headless launch passed.

## Decisions

- 2026-08-03: Treat Ozon publication as a simulated/precheck-only step. A real
  listing submission is an external write and is unnecessary to validate the
  requested flow.
- 2026-08-03: Preserve the existing Chromium engine; change the preferred
  installed browser channel to Edge, as requested.
- 2026-08-03: Read the stable desktop category cache from development builds,
  but do not migrate encrypted production secrets into legacy plaintext
  settings.

## Progress Log

- 2026-08-03: Loaded repository working rules, Product Design audit guidance,
  current screenshot, and the owning browser/category modules.
- 2026-08-03: Reproduced the missing tree as a development/stable user-data
  path split; added canonical storage plus compatibility reads.
- 2026-08-03: Switched browser preference to Edge with bounded Chromium
  fallback and confirmed the Edge launch through doctor.
- 2026-08-03: Fixed multi-SKU mapping validation, removed duplicate attribute
  metadata fetching, and added an end-to-end deterministic flow test.
- 2026-08-03: Completed visual walkthrough and saved the audit report. Recorded
  production risks for inventory sync, real-submit enforcement, credential
  storage, and 125% display scaling.

## Rollback

Revert only the browser-selection, category-tree, deterministic flow-test, and
audit-report changes associated with this plan. Preserve the user's preceding
desktop cleanup changes.
