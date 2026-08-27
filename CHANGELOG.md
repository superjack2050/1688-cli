# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- `image-search` returned the same ~60 unrelated offers for every image. The
  command opened the legacy `s.1688.com/selloffer/offer_search.htm?imageId=…`
  results page, where 1688 now ignores `imageId` and renders the generic
  keyword-search shell; its `getOfferList` call returns a personalised
  "猜你喜欢" feed, which the capture then reported as image-search results.
  Results are now read from the current pc-image-search app
  (`air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=…`)
  and the mtop capture is scoped to the two methods that carry the offer
  list there (`imageOfferSearchService` on a fresh search,
  `getImageSearchPreResult` when the server already has the result cached),
  so the offers returned actually match the uploaded image.
  `startSearchOfferCapture`'s `requireMethod` accepts an array for this.
  `BB1688_DEBUG=1` now prints the capture diagnostics for `image-search`
  (`src/commands/image-search.ts`, `src/session/search-capture.ts`,
  `tests/image-search.test.ts`).
- Risk-control redirects that expose only a punish/x5secdata URL are now
  classified as verification challenges before generic locator recovery, so
  image upload failures point users to `--headed` manual verification instead
  of reporting a missing upload button (`src/session/page-state.ts`,
  `tests/page-state.test.ts`).

## [0.1.47] - 2026-06-27

### Fixed
- Restored the npm package page to use the English `README.md` as the default
  README by renaming the Chinese translation to `README_zh-CN.md`.

### Docs
- Added a release-check guard and release-omission record for npm README
  filename selection, so future root-level translated README files do not
  silently override the npm default README.

## [0.1.46] - 2026-06-27

### Added
- Added `1688 offer <offerIds...>` batch collection. A single offer ID keeps
  the existing `OfferResult` JSON shape, while multiple IDs return a batch
  envelope with partial successes and per-offer failures.
- Added `1688 offer --pro` to run offer collection inline and bypass daemon
  health pauses for the current call.
- Added `1688 search --deeppro` to search first, then collect full offer
  details for each result with retry/failure reporting and configurable
  inter-offer delay.
- Added a Chinese README translation and an Amazon FBA sourcing playbook.

### Docs
- Expanded README command coverage and documented the new batch offer and
  deeppro output shapes in the command catalog and JSON contracts.

### Tests
- Added deterministic coverage for single vs batch offer JSON output and
  `search --deeppro` dispatch behavior.

## [0.1.45] - 2026-06-16

### Docs
- Clarified the release workflow: agents prepare GitHub releases but never run
  `npm publish`; they first check npm auth and then provide either the publish
  command or the login-plus-publish commands for the human to run manually.

## [0.1.44] - 2026-06-16

### Changed
- **Search now follows the normal 1688 buyer flow.** Product search warms up
  on `www.1688.com`, submits the query through the main-site search box when
  possible, and clicks result-page sort controls for price/sales ordering
  before capturing the sorted mtop response.
- **Headed search waits for manual verification.** When `--headed` reaches a
  risk-control page, the CLI keeps the browser open for manual completion
  instead of returning early.
- **Search diagnostics are more precise.** Login redirects are reported as
  `NOT_LOGGED_IN`, sorted captures filter by `sortType`, and missing homepage
  or sort controls use short probes so fallback/error paths do not hang.
- **`similar` no longer suggests fallback behavior.** The command now treats
  1688's official same-product page as the only valid source. If that official
  entry point returns the current empty image-search shell, the CLI reports
  `SIMILAR_UNAVAILABLE` instead of implying `--headed`, keyword search, or
  image search can provide equivalent same-product results.

## [0.1.43] - 2026-06-16

### Added
- **Profile-scoped daemons.** Added one-daemon-per-profile runtime support:
  `1688 serve --profile <name>` and
  `1688 daemon start|stop|status|reload --profile <name>` now manage the
  selected profile's daemon independently.
- **Profile-scoped runtime artifacts.** Daemon socket or Windows named pipe,
  pid, version, log, lock, and cached identity state are now scoped per
  profile. Different profiles can run in parallel without contending on one
  global lock.
- **Profile-aware command dispatch.** Commands such as
  `1688 search "实木床头柜" --profile acc-a` now try the `acc-a` daemon first
  instead of falling back inline solely because `--profile` was present.
- **Profile diagnostics.** `doctor --profile <name>` and
  `profile status <name>` now report that profile's daemon, lock, login state,
  and recent command state.

### Changed
- `login --profile <name>` now writes that profile's state and can auto-start
  the same profile daemon after login.
- Inline fallback and checkout-confirm daemon pausing now stop only the
  selected profile daemon, leaving other profile daemons running.
- Default profile behavior remains compatible: commands without `--profile`
  continue to use `default` and the historical default daemon artifact paths.

### Docs
- Split the README sourcing section into two separate user paths:
  **Product Scraper / Product Research** and **Supplier Scraper / Supplier
  Research**, with a quick command-selection table.
- Updated package metadata locally with scraper-oriented description and
  keywords (`supplier-scraper`, `product-scraper`, `supplier-search`,
  `sourcing`). These npm metadata changes will appear on npm on the next
  published version.
- Documented multi-profile daemon usage, default-profile compatibility,
  profile-scoped files, and Windows named-pipe behavior.

### Tests
- Added deterministic coverage for profile-scoped daemon paths, Windows pipe
  names, profile state separation, and profile status diagnostics.

## [0.1.42] - 2026-06-08

### Added
- **Sourcing research workflow.** Added `1688 research` for multi-keyword
  product research datasets with scoring, JSONL/CSV export, and optional
  top-N offer enrichment.
- **Supplier scraper/research workflow.** Added `1688 supplier search` and
  `1688 supplier research`, backed by 1688 company search
  (`companySearchBusinessService`) instead of grouping product-offer results.
  Supplier results include company identity, memberId, location, service
  years, factory signals, repeat/response rates, order/amount signals,
  previews, score, and export support.
- **Supplier inspection.** Added `1688 supplier inspect` for supplier/factory
  trust signals from an offerId or `b2b-*` memberId.
- **Offer comparison.** Added `1688 compare <offerId...>` for side-by-side
  price, MOQ, SKU depth, sales, supplier, freight/package, and score signals.
- **Agent map and harness.** Added the short `AGENTS.md` entrypoint,
  `ARCHITECTURE.md`, docs/specs/playbooks, generated agent indexes, completed
  ExecPlans, and the default `pnpm agent-verify` gate.

### Changed
- **Search sourcing filters.** Added sorted/filtered sourcing controls such as
  sort modes, price range, location, verified supplier, minimum turnover/order
  signals, and optional ad exclusion.
- **Windows CLI compatibility baseline.** Replaced shell `chmod` in the build
  with a Node helper, made Windows daemon named pipes root-hashed, made
  postinstall/doctor hints platform-aware, moved production temp debug paths to
  `os.tmpdir()`, and added PowerShell/Windows docs.
- **Documentation packaging.** Published the expanded agent-readable docs and
  generated indexes in the npm package.

### Tests
- Added deterministic tests for sourcing scoring/export helpers, supplier
  inspect/search behavior, Windows path/doctor/bin-mode helpers, and search
  option handling.

## [0.1.41] - 2026-05-16

### Added
- **`1688 inbox` now decodes 1688 IM card messages.** What previously
  rendered as `kind: 'other'` / `preview: '[非文本消息]'` is now broken
  out into structured fields. The decoder reads two parallel sources
  (`content.custom.data` base64-JSON and
  `message.extension.dynamic_msg_content` template JSON), picks the
  best preview text across `productTitle` / `refundTitle` /
  `offerSubTitle` / `title` / `summary`, and emits:
  - `lastMessage.kind` — now `'text' | 'image' | 'card' | 'archived' | 'other'`
  - `lastMessage.cardTemplate` — semantic name when known
    (`'order_followup'`, `'refund'`, `'offer'`, `'order_payment_reminder'`,
    `'address_changed'`, `'evaluation_invite'`, `'coupon'`,
    `'session_ended'`, etc.)
  - `lastMessage.cardCode` — raw 6-digit template code (`170002`, `467001`,
    …) so agents can filter on unmapped templates too
  - `lastMessage.extras` — `{orderId, offerId, refundId, imgUrl, linkUrl,
    amount}`, populated only when at least one field resolved (keeps
    JSON output compact)
  - New `'archived'` kind marks conversations where the server stripped
    `content` entirely (observed on all messages > ~12 months old —
    not a parser failure, just a server retention boundary).

  Decoder is a pure function in `src/session/im-cards.ts` so it's
  reusable from future commands and easily testable. Live-validated on
  a 2430-conversation account: 421 of 444 cards (95%) get a meaningful
  preview; remaining 23 cards fall back to `'[卡片消息]'` placeholder
  with `cardCode` still surfaced. Tests in `tests/im-cards.test.ts`
  (14 new) and `tests/inbox.test.ts` (updated).

- **Opt-in JSON v2 response envelope** (`--envelope v2` / `BB1688_JSON_ENVELOPE=v2`).
  Wraps command output in `{ok, code, data, error, meta}` with a stable
  `meta.requestId` so agents can correlate output with the event log
  (see below) and debug bundles. Default JSON shape is unchanged —
  existing callers keep working bit-for-bit. Implemented in `src/io/output.ts`
  with coverage in `tests/output.test.ts`.

- **`1688 profile list` / `1688 profile status`.** A minimal profile
  inventory backed by `~/.1688/profiles/`. `list` enumerates known
  profiles with login state and last-used hints; `status <name>` reports
  state file health, lock holder (if any), and the last few command
  events for that profile. New config loader + validation in
  `src/session/config.ts`; commands in `src/commands/profile.ts`. Tests:
  `tests/config.test.ts`, `tests/profile.test.ts`.

- **`1688 doctor --live`.** Extends `1688 doctor` with read-only live
  checks: daemon reachability, event-log writability, artifact directory
  writability, and recent risk-control signals from `~/.1688/runs/`.
  Pure observation — no browser is started, no profile is touched.
  `src/commands/doctor.ts`, `tests/doctor-live.test.ts`.

- **`1688 debug list / last / show`.** Read-only post-mortem surface for
  the command event log. `list` paginates recent commands;
  `last` jumps to the most recent run; `show <requestId>` prints the
  start/success/error records plus pointers into the matching
  `~/.1688/runs/<requestId>/` artifact bundle. Powered by the new event
  system (see below). `src/commands/debug.ts`, `tests/debug.test.ts`.

- **Command request event log** (`~/.1688/events/`). Dispatched commands
  now record `start`, `success`, and `error` events scoped to a
  per-invocation `requestId`. Captured stdout/stderr aren't modified —
  events are written out-of-band so existing JSON output stays
  bit-for-bit identical. Drives `debug`, `profile status`, and
  `doctor --live`. `src/session/events.ts`, `src/session/dispatch.ts`,
  `src/daemon/client.ts`; `tests/events.test.ts`.

- **Navigation-guard classifier (`src/session/navigation-guard.ts`).**
  Tags unexpected page destinations encountered mid-command — login,
  risk-control / verification, payment, or off-host external — so
  commands can decide whether to retry, prompt, or fail with a
  classified diagnostic instead of a raw selector-timeout. Currently
  available as a helper; downstream commands will adopt it
  incrementally. `tests/navigation-guard.test.ts`.

### Changed
- **`cart-add` / `cart-list` response capture scoped to its triggering
  action.** Listeners are now armed immediately before the action that
  causes the mtop response and disposed in `finally`, so capture
  lifetimes track navigation/click boundaries. Ambiguous add-to-cart
  confirmations now surface capture diagnostics (which event arrived,
  which didn't) instead of generic timeouts.

- **`search` capture lifecycle refactor.** Search / image-search /
  similar listeners are now armed immediately before the triggering
  action (initial navigation OR pagination click) and torn down in
  `finally`. Page-close events surface `browser_closed` immediately
  instead of waiting for polling timeouts. Capture also records timing,
  final status, and parser failures so failures produce structured
  diagnostics. Same offer dedup / pagination behavior as 0.1.40 —
  purely a lifecycle and observability change
  (`src/session/search-capture.ts`, `src/commands/search.ts`,
  `image-search.ts`, `similar.ts`).

- **Shared deadline-aware polling helper.** The deadline loop in
  `src/session/wait.ts` now backs search capture's blocking waits
  (previously had its own ad-hoc remaining-time math). Behavior
  unchanged, but timeout handling is consistent and unit-tested in one
  place (`tests/wait.test.ts`).

### Tests
- **Replay fixtures for offline parser coverage.** Sanitized
  `getOfferList` mtop captures, cart `addcargo` success/failure
  responses, and a risk-control page-state HTML now back
  `tests/replay-fixtures.test.ts`. Parser and navigation classification
  changes won't silently drift even if no live env is available.

## [0.1.40] - 2026-05-15

### Added
- **`1688 inbox` — list recent 旺旺 IM conversations.** New top-level
  command that captures the IM client's
  `/r/Conversation/listNewestPagination` LWP response and emits a
  clean per-conversation record: `cid`, `peer.{nick,id}`, `unread`,
  `topRank`, `muted`, `updatedAt`, `lastMessage.{kind,preview,at,fromMe}`.
  Pinned conversations bubble to the top, then sorted by `updatedAt`
  desc. `--unread` filters to active threads; `nextCursor` is exposed
  for future pagination. The `cid` is the stable handle that future
  versions of `seller messages` can accept directly (avoiding the
  fragile sidebar-click path). Peer identity comes from
  `user_extension.target.dnick` rather than `extension.targetMainNick`
  so peer-mirrored conversations resolve correctly.

  Also added `src/session/im-ws.ts` — shared LWP/WS frame helpers
  (`collectWsFrames`, `waitForLwpResponse`, `findLwpResponses`,
  `dumpWsFramesForProbe`) that any future IM-side command can reuse.
  Tests in `tests/inbox.test.ts`.

- **`1688 inbox --limit N` auto-paginates beyond page 1.** The IM
  client only fetches ~20 conversations on first load. To satisfy
  larger `--limit`, the command now nudges the IM iframe to lazy-load
  more pages by rotating three trigger strategies (JS scrollTop
  overshoot, real OS-level `page.mouse.wheel`, synthetic scroll-event
  dispatch) — necessary because the IM SDK throttles repeated
  identical-shape triggers. Capped at `MAX_PAGES = 10` rounds
  (≈130–150 unique conversations after dedup); `truncated` flag in
  the result indicates more remain. Same UX shape as `search --max`.

  Bug fix bundled in: `src/session/im-ws.ts` had a stray CommonJS
  `require('node:fs')` in `dumpWsFramesForProbe` that broke probe
  output when called from ESM scripts.

## [0.1.39] - 2026-05-15

### Fixed
- **`search` retry capture lifecycle.** The mtop response interceptor
  was being torn down before the in-page retry click could replay the
  `getOfferList` request, so retried pages produced no captured payload
  and surfaced as empty pages. The capture handle now stays attached
  across the full retry window (`src/session/search-capture.ts`,
  `src/commands/search.ts`).

### Changed
- **Centralized 1688 mtop response capture.** Per-command interceptor
  bookkeeping (cart, image-search, offer, order-list/logistics, search,
  similar) now goes through `src/session/response-capture.ts` and the
  search-specific `src/session/search-capture.ts` /
  `src/session/search-mtop.ts`. Page-event wiring, payload matching,
  and teardown live in one place; commands shrank significantly
  (search.ts alone went from ~600 to ~390 lines). Covered by
  `tests/response-capture.test.ts`, `tests/search-capture.test.ts`,
  `tests/search-mtop.test.ts`, `tests/mtop.test.ts`,
  `tests/artifacts.test.ts`.
- **Centralized deadline polling in `src/session/wait.ts`.** The
  ad-hoc `Date.now()` deadline loops left in commands after 0.1.38's
  consolidation now share a single helper, with extra coverage in
  `tests/wait.test.ts`.

### Docs
- README title/header polish: clearer focus on the AI-agent use case.

## [0.1.38] - 2026-05-14

### Changed
- **Centralized browser timing helpers (`src/session/wait.ts`).** Fixed
  sleeps and ad-hoc polling loops scattered across commands, daemon,
  locator, and recovery code now go through a single wait layer with
  shared semantics (timeout fallback, polling delay, jittered sleep).
  Affected surfaces include `cart-add`, `cart-list`, `cart-remove`,
  `checkout-confirm`, `checkout-prepare`, `image-search`, `login`,
  `offer`, `order-list`, `order-logistics`, `search`, `seller-chat`,
  `seller-inquire`, `seller-messages`, `similar`, plus
  `daemon/manager`, `daemon/throttle`, `session/locator`,
  `session/page-state`, and `session/recovery`. No behavior change for
  callers — purely a consolidation that makes browser timing easier to
  tune and test (`tests/wait.test.ts`).

## [0.1.37] - 2026-05-14

### Changed
- **Consolidated remaining UI selectors behind locator helpers.**
  `cart-add`, `image-search`, `search` pagination, `seller-messages`,
  and `checkout` preview selection no longer own raw selectors. New
  helpers in `src/session/image-search-locators.ts`,
  `offer-locators.ts`, and `search-locators.ts` centralize the lookup
  surface so page UI changes produce structured diagnostics rather
  than scattered selector failures.

## [0.1.36] - 2026-05-14

### Changed
- **Stabilized browser element targeting.** Cart, checkout, and IM
  element lookups moved behind semantic locator helpers
  (`src/session/cart-locators.ts`, `checkout-locators.ts`,
  `im-locators.ts`, and the shared `locator.ts`). Page UI changes now
  surface as structured recovery diagnostics instead of low-level
  selector errors. Covered by `tests/locator.test.ts`.

## [0.1.35] - 2026-05-14

### Added
- **`search` now auto-paginates to satisfy `--max`.** Previously `search`
  returned only the first 60 offers and `--max` above 60 just truncated
  that single page. Now `--max 150` fetches three pages, `--max 600`
  fetches ten, etc. (capped at `MAX_PAGES = 10` → 600 results).

  Mechanism: pages 2+ are fetched by clicking the in-page next-arrow
  (`.fui-arrow.fui-next`), which advances `beginPage` within the *same*
  search-context `pageId`. Re-navigating with `&beginPage=N` does not
  work — each fresh navigation mints a new `pageId`, and `beginPage=2`
  against a fresh pageId returns ~75% the same offers as page 1.

  The mtop interceptor now matches each response to the exact page being
  fetched (`method === "getOfferList"` and `beginPage` equal to the
  current page), replacing the previous "keep the response with the most
  items" heuristic. Cross-page dedup is by `offerId`. Page-2+ failures
  return partial results instead of throwing; human-like jitter
  (1.5–3.5 s) is inserted between page clicks.

## [0.1.34] - 2026-05-14

### Fixed
- **`search` returned the homepage recommendation feed instead of actual
  keyword results.** The mtop response listener was attached *before* the
  `s.1688.com` warmup navigation — and the homepage fires its own
  `WirelessRecommend.recommend` call with the same `appId=32517`, so the
  homepage's recommendation feed was captured first. The "keep the
  response with the most items" heuristic then never replaced it (homepage
  feed and search results both return ~60 items, and `60 > 60` is false).
  The listener is now attached only *after* warmup, and the retry path
  detaches + resets `capturedOffers` around its re-warmup so the homepage
  feed can't re-poison the capture.

## [0.1.33] - 2026-05-14

### Changed
- Unified browser failure handling across commands (`src/session/recovery.ts`,
  `page-state.ts`, `artifacts.ts`): consistent classification, retry, and
  debug-artifact capture for browser-backed command failures.

## [0.1.32] - 2026-05-14

### Added
- **Daemon version checks.** The daemon now writes `daemon.version`, reports
  its version in `1688 daemon status`, and the CLI refreshes a stale daemon
  before sending commands so upgrades do not silently reuse old runtime code.
- **Runtime diagnostics for agents.** `1688 daemon status` now includes
  browser health, current URL, and classified page state when a shared browser
  context is active.
- **Failure artifacts.** Browser-backed command failures now save a debug
  bundle under `~/.1688/runs/<requestId>/` with `meta.json`,
  `screenshot.png`, and `page.html` when available. `CliError` details can
  carry `artifactDir`, `currentUrl`, `pageState`, `category`, `retryable`,
  and `recoverHint` for agent-friendly recovery.

### Fixed
- CLI and daemon error propagation now preserves structured diagnostic details
  instead of returning only `code` and `message`.
- Page-state detection classifies common 1688 failure modes: login redirects,
  slider/security verification, and rate-limit pages.

## [0.1.31] - 2026-05-14

### Added
- **`1688 feedback --submit`** — post the issue directly via the GitHub
  CLI (`gh`). Checks `gh --version` and `gh auth status` first, then
  runs `gh issue create --repo superjack2050/1688-cli ...`. The flag is
  opt-in by design: agents and users still get the safer browser flow
  by default, and only escalate to direct submission when explicitly
  asked.

### Fixed
- `1688 feedback "<message>"` swallowed almost all of the message on
  macOS when the user's shell auto-replaced straight `"` with smart
  quotes (`“ ”`) — the shell saw them as literal characters, split the
  argument list, and only the first piece reached the CLI. The
  `<message>` argument is now variadic; all remaining args are joined
  with a space, so the message survives regardless of how the shell
  parses quotes. Leading/trailing smart quotes are also stripped from
  the joined result.
- Reject feedback messages shorter than 5 characters with a hint about
  using single quotes on macOS.

## [0.1.30] - 2026-05-13

### Fixed
- **`1688 login` now works under Codex / Claude Code / any agent**.
  The QR code was rendered as terminal ASCII only when stderr was a
  real TTY; agents typically pipe stderr, so the QR never displayed.
  Login now always also saves the QR as a PNG to
  `~/.1688/login-qr.png` (`%USERPROFILE%\.1688\login-qr.png` on
  Windows) and prints `QR saved as PNG: <path>` on stderr, so an agent
  can surface the image to the user.

### Added
- **`1688 feedback <message>`** — submit feedback or report a bug via a
  pre-filled GitHub issue. Auto-attaches anonymized environment info
  (version, Node, OS) and the last error from `daemon.log` if present.
  On a TTY, opens the issue page in the user's browser. With
  `--no-open` or in JSON mode, prints the URL so an agent can show it
  to the user without opening the agent's own browser.
  ```
  1688 feedback "the slider verification looped on day 3"
  1688 feedback --bug "cart-add failed for SKUs with X attribute"
  ```
  AGENTS.md gains "Login in non-interactive sessions" and "Feedback /
  bug reports" sections.

## [0.1.29] - 2026-05-13

### Added
- **Agent-friendly update awareness.** Two new signals so AI agents can
  detect new versions without parsing the human update banner:
  - `1688 doctor` JSON output now includes a `version` block with
    `current`, `latest`, `updateAvailable`, `updateCommand`, and `error`
    (when the registry check fails).
  - In JSON mode (piped output / `--json` / `BB1688_JSON=1`), any
    command emits a single structured line on stderr when a newer
    version is cached:
    `{"_notice":"updateAvailable","current":"0.1.x","latest":"0.1.y","updateCommand":"npm i -g 1688-cli@latest"}`
  - AGENTS.md gains an "Update awareness" section documenting both
    signals and the rules: ask the user before upgrading in interactive
    sessions; do nothing in non-interactive (CI / cron) ones; never
    run the install command without explicit current-turn authorization.

## [0.1.28] - 2026-05-13

### Documentation
- README: document the `--json` / `--pretty` / `--get` / `--pick` flags in
  the "JSON for agents" section with copy-pasteable examples.
- AGENTS.md: add an "Output flags" section so agents can discover the
  zero-`jq` workflows.

## [0.1.27] - 2026-05-13

### Added
- **Four output-shaping flags on every command**, no `jq` needed:
  - `--json` — force JSON output even when stdout is a TTY.
  - `--pretty` — indent JSON by 2 spaces.
  - `--get <path>` — print one field by dot-path. Syntax:
    `field.sub`, `arr[0].field`, `arr[*].field` (wildcards stream one
    line per element). Scalars print raw; objects/arrays print JSON.
  - `--pick <paths>` — comma-separated dot-paths → emit a JSON object
    with each path as a key. Good for trimming output for agents.

  Examples:
  ```
  1688 offer X --get supplier.name             # 深圳狼途实业科技有限公司
  1688 offer X --get supplier                  # {"name":"...","loginId":"..."}
  1688 offer X --get 'skus[*].price'           # 49 \n 68 \n 98.75 ...
  1688 offer X --pick price,supplier.name      # {"price":1.25,"supplier.name":"..."}
  1688 offer X --json --pretty                 # full pretty-printed JSON in TTY
  ```

  Implemented in `src/io/output.ts`; flags are added to every command
  through a recursive walk of commander's command tree plus a `preAction`
  hook that pushes the values into the output module before `emit()` runs.

## [0.1.26] - 2026-05-13

### Fixed
- **Windows daemon never started** (`EACCES: permission denied` on
  `daemon.sock`). Node's `net.listen()` can't bind a filesystem path on
  Windows — it needs a named pipe (`\\.\pipe\...`). The daemon now uses
  `\\.\pipe\1688-cli-daemon` on Windows and skips the `fs.unlink` of the
  socket path (named pipes auto-clean). Unix behavior is unchanged.
- `isDaemonReachable()` on Windows no longer fails the existence check
  before connecting — named pipes don't appear in the filesystem.

## [0.1.25] - 2026-05-13

### Added
- **`1688 similar <offerId>`** — find similar offers ("找同款") via the
  shared search mtop endpoint. Sorted by price, useful for comparing
  suppliers of the same product.
- **`1688 seller messages --watch [--interval <s>]`** — live-tail a
  conversation. Polls and emits only newly-arrived messages as
  line-delimited JSON when stdout is piped. Dedup is by server-side
  `messageId`. Default interval 30 s, minimum 10 s.
- `seller messages` results now include richer `kind` subtypes:
  `text` / `offerCard` / `orderCard` / `autoReply` / `assessment` /
  `image` / `other`, plus a stable `messageId`. Offer/order cards expose
  `card.url`, and offer cards are enriched with `card.title` / `.price` /
  `.image` from the IM client's hydrated card.
- `cart add` JSON response now includes `isNewRow` (bool) and
  `addedQuantity` (number). Pipelines can pick up the new cartId reliably
  even when the SKU is merged into an existing row.
- `offer` returns a much richer payload: `priceTiers[]`, `attributes[]`,
  `packageInfo[]`, `images[]`, `saleCount`, `categoryId`, and a fuller
  `supplier` (loginId, memberId, province, city). SKU variants gain
  `multiPrice`, `saleCount`, and `image`.
- `order list` returns `actions[]` (buyer-side ops with jump URLs),
  `services[]` (insurance / refund metadata with payer), `badges[]`,
  `originalAmount`, `discountAmount`, `adjustment`, and `bizType`.

### Changed
- **`cart add` now uses mtop hijack (Route B)** instead of full UI replay.
  Wall time is similar (~6 s) but works uniformly across single-attr and
  multi-attr SKU layouts, including dropdown-style selectors and hidden
  rows that previously broke the UI path.
- **`seller messages` now uses WebSocket / LWP protocol interception
  (Route C)** instead of DOM scraping. Server-truth timestamps
  (millisecond `createAt`), stable `messageId`, and URL extraction from
  offer/order cards. DOM scraping is retained as a fallback when no
  WebSocket frames are captured.
- `image-search` reuses the search mtop interception path; shared parser
  helpers (`parseMtopJsonp`, `mapOffer`, `SEARCH_MTOP_API`) are now
  exported from `search.ts` for `similar` to consume too.

### Fixed
- `cart list` returned `amount: 2` for items priced over ¥1,000 because
  `parseFloat("2,094.00")` stops at the thousand-separator comma. Now
  uses the integer-cent fields (`unitPriceCent`, `amountCent`) when
  present, with a comma-stripping string parser as fallback.
- `cart add` could return the wrong `cartId` when the same SKU was
  already in the cart (the server merges into the existing row). Now
  snapshots the cart before/after and diffs to find the affected row,
  exposing whether it was a new row or a merge plus the delta quantity.

## [0.1.24] - 2026-05-13

### Fixed
- `BB1688_PROBE=1` output was silent when stdout was piped because `info()`
  is suppressed under JSON mode. The probe now writes directly to stderr,
  and prints `[probe] active` on start so you can confirm it's running.
- Broader JSON markers (`window.runParams`, `"offerList"`, `"offerId":`).

## [0.1.23] - 2026-05-13

### Changed
- `BB1688_PROBE=1` now also logs non-mtop XHR calls and scans the SSR HTML
  response for inline JSON markers (`window.__INITIAL_STATE__`, etc.). If
  search doesn't fire any mtop, the SSR HTML is the real data source.

## [0.1.22] - 2026-05-13

### Added
- `BB1688_PROBE=1` diagnostic: when set, `search` prints every mtop API call
  fired during the page load. Used to identify the right endpoint for
  migrating `search` / `image-search` from DOM scraping to mtop interception
  (which is what `order` / `cart` already use).

## [0.1.21] - 2026-05-13

### Fixed
- `search` / `image-search` result extraction was returning garbage fields:
  the title held the entire card's concatenated text, the price was a
  bulk-order tier (`¥0.011000000~4999999`), and every row showed the same
  supplier. Three independent bugs:
  - Card boundary "walk up until parent has price + img" over-walked into
    the results container, so all rows shared one ancestor.
  - Title fallback used `anchor.textContent`; when the anchor wraps the
    whole card that's the whole card text.
  - Price regex ran on concatenated innerText where neighbour numbers had
    no whitespace separator.

  Replaced with: walk up until parent contains more than one offerId; title
  from `[class*=title]` / `img[alt]` / `<a title>` only; price from leaf
  elements whose total text matches a price pattern (with sanity bounds);
  supplier from `shop*.1688.com` / `winport` subdomain links only.

## [0.1.20] - 2026-05-13

### Fixed
- Daemon auto-starts on any command that wants to use it, not just `login`.
  After `npm i -g 1688-cli` the postinstall stops the previous daemon (since
  0.1.3); previously you had to manually run `1688 daemon start` or `1688
  login` to bring it back. Now `1688 search ...` etc. will start the daemon
  transparently if it's not running.

## [0.1.19] - 2026-05-13

### Fixed
- `search`: removed a second hardcoded `waitForSelector('.search-offer-item ...')`
  that ran AFTER `waitPastBlocking`. The class name is gone from current
  1688 markup, so the wait timed out — 15s on headless, 180s on `--headed`.
  `waitPastBlocking` already confirmed the page loaded; the extra gate was
  redundant.
- `extractOffers` rewritten to be class-agnostic: seed from offer-detail
  anchor hrefs (URL pattern stable for years), walk up to find the card-like
  ancestor, extract title/price/image. Survives 1688 markup reshuffles.

## [0.1.18] - 2026-05-13

### Fixed
- Any inline-mode command (`--headed`, `--profile`, `BB1688_NO_DAEMON=1`) no
  longer fails with `LOCK_BUSY` when the daemon is running. Dispatch now
  pauses the daemon for the duration of the inline call and resumes it
  after, mirroring what `checkout confirm` already did. Affects `search
  --headed`, `image-search --headed`, etc.

## [0.1.17] - 2026-05-13

### Fixed
- `login`: idempotent — running `1688 login` a second time while the daemon
  is alive no longer fails with `LOCK_BUSY`. The already-logged-in check
  now reads cached identity from `state.json` first (no browser, no lock)
  and only falls back to a browser cookie peek if the cache is missing.

## [0.1.16] - 2026-05-13

### Changed
- `search`: lowered detection thresholds (anchors 30→15, bodyLen 2000→800) so
  partially-hydrated SPA results pages clear faster.
- `search`: `BB1688_DEBUG=1` now prints `url / title / anchorCount / bodyLen`
  every second during the wait — makes it visible whether the page is
  loading, on a slider, or our detection just under-triggered.

## [0.1.15] - 2026-05-13

### Fixed
- Auto-clean stale `.lock.lock` directory when no daemon is alive. Previously,
  killing a `--headed` flow with Ctrl+C left a lock that blocked every
  subsequent command with `LOCK_BUSY` until manually `rm -rf`'d. The probe
  is safe: if a daemon process actually holds the lock, the original
  "Another 1688 command is running" error is preserved.

## [0.1.14] - 2026-05-13

### Changed
- Description in `package.json` and the GitHub repo "About" updated to reflect
  the actual core flow (sourcing + orders) instead of niche shortcuts.

## [0.1.13] - 2026-05-13

### Added
- `seller messages --offer <offerId>`: read pre-sale inquiry replies scoped
  by offerId, symmetric to `seller inquire`. Previously you had to
  remember the seller's name and pass it in sidebar mode.

## [0.1.12] - 2026-05-13

### Changed
- README: showcase now highlights the actual core procurement flow
  (search → image-search → offer → inquire → order list → order get →
  logistics → post-sale chat), not the niche `stuck` / `fake-shipped`
  shortcuts. Those remain in the Workflow shortcuts section.

## [0.1.11] - 2026-05-13

### Fixed
- `search`: result-page detection no longer binds to specific card class
  names (which 1688 reshuffles every few months). Now uses two resilient
  signals — page URL not on a punish host, plus a large anchor count and
  body length. Previously the command would hang after a user solved the
  slider in `--headed` mode because none of the hardcoded selectors matched
  the current markup.

## [0.1.10] - 2026-05-13

### Changed
- `package.json`: corrected `repository`, `homepage`, and `bugs` URLs to the
  actual GitHub user `superjack2050/1688-cli`. The npm package page will now
  link to the public source.

## [0.1.9] - 2026-05-13

### Changed
- Rewrote `README.md` for end users (was still MVP-era developer notes).
  Now covers the full command catalog, JSON-for-agents flow, and risk-control
  guidance. 0.1.8 carried the manifest changes but the README write failed —
  this is the real publish.
- Added badges (version, downloads, license, node) to the README.

## [0.1.8] - 2026-05-13

### Changed
- Added `keywords`, `repository`, `homepage`, `bugs` to `package.json` for
  npm search discoverability.

## [0.1.7] - 2026-05-13

### Changed
- `search`: replaced 1.5s-interval polling of the result-page selectors with
  event-driven `waitForSelector`. Saves up to 1.5s per search when cards
  render before the next poll tick.

## [0.1.6] - 2026-05-13

### Changed
- `search`: always warm up `s.1688.com` before the actual search (instead of
  only on first run). Cookie-presence checks can't detect server-side
  invalidation or expiry, so a constant ~1.5s overhead trades small latency
  for stability.
- `search`: on a headless WAF trigger, automatically re-warm with a longer
  pause and retry once before bailing. Cuts manual `--headed` interventions.

## [0.1.5] - 2026-05-13

### Fixed
- `search`: result page detection only checked the legacy `.search-offer-item`
  class; 1688 reshuffles markup periodically and the new class names caused
  the command to hang on a fully-loaded page until timeout. Now matches
  multiple known selectors plus the offer-detail link pattern.
- `search`: dropped body-text matching from the WAF detector — product names
  and footer ads occasionally contain `滑动` / `验证` substrings, producing
  false positives. URL path + page title is enough.

## [0.1.4] - 2026-05-13

### Changed
- `search`: warm up `s.1688.com` (visit the homepage first) on the very first
  search per browser session so the WAF sees an organic browse before the
  search request. Skipped on subsequent searches (cookies already cached).
  Cold-start search was the #1 trigger of the slider challenge.

## [0.1.3] - 2026-05-13

### Fixed
- Postinstall: stop any running daemon during `npm i -g 1688-cli` so the next
  command auto-starts a fresh daemon running the new code. Previously the
  long-lived daemon kept serving the old code after an upgrade until the user
  ran `1688 daemon stop` manually.

## [0.1.2] - 2026-05-13

### Fixed
- `doctor`: the "browser launch" check now mirrors runtime preference — tries
  system Chrome first via `channel: 'chrome'`, falls back to bundled Chromium.
  Previously failed after Playwright minor bumps left the bundled Chromium
  version stale, even though the runtime already prefers Chrome.

## [0.1.1] - 2026-05-13

### Added
- Update notifier: prints a one-line banner on next run when a newer version
  is on npm. Checks at most once per day; non-blocking, ignored in CI / pipes.
- MIT license.

### Changed
- Postinstall: skip Chromium download when a system Chrome is detected
  (macOS / Windows / Linux). Runtime already prefers system Chrome via
  `channel: 'chrome'`, so most users save the 150MB download.
- Postinstall: auto-select the npmmirror Playwright mirror on China timezones
  (`Asia/Shanghai` etc.) — no env-var required. International users still hit
  the official source.

## [0.1.0] - 2026-05-12

Initial release.

Commands: `login`, `logout`, `whoami`, `doctor`, `daemon`,
`search`, `image-search`, `offer`,
`order list/get/logistics`,
`cart list/add/remove`,
`checkout prepare/confirm`,
`seller chat/inquire/messages`,
`shipped`, `stuck`, `fake-shipped`, `seller-history`.
