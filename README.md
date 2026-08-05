# 1688 CLI: AI Agents Friendly Alibaba 1688.com Product Search & Supplier Scraper CLI

[![npm version](https://img.shields.io/npm/v/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![npm downloads](https://img.shields.io/npm/dm/1688-cli.svg)](https://www.npmjs.com/package/1688-cli)
[![license](https://img.shields.io/npm/l/1688-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/1688-cli.svg)](https://nodejs.org/)

[English](./README.md) | [简体中文](./README.zh-CN.md)

Command-line tool for Alibaba 1688.com wholesale: product search, supplier
company search, supplier scraper/research, image search, supplier inquiry, cart,
checkout, order tracking, and seller chat. Outputs JSON when piped (for Codex /
Claude Code / other AI agents) and pretty TTY text for humans.

The 6 things you can do from the terminal:

1. **Sourcing** — product scraper/research + supplier scraper/research
2. **Pre-sale inquiry** — ask the supplier, watch replies live
3. **Cart** — collect SKUs (with diff-based add confirmation)
4. **Checkout** — preview + place the order
5. **Order tracking** — list / detail / logistics / overdue detection
6. **Post-sale chat** — chase shipment, read replies as JSON stream

```bash
npm i -g 1688-cli
1688 login                                       # scan QR with the 1688 app

# Product scraper / product research
1688 search "佛龛柜" --max 10                                 # keyword search
1688 search "手机壳" --sort best-selling --price-max 50        # sorted/filtered sourcing
1688 research 手机壳 数据线 --max-per-query 50 --jsonl         # multi-keyword research dataset
1688 image-search ./sample.jpg                                # search by image
1688 offer 628196518518                                       # single product detail
1688 offer 628196518518 1234567890 --json --pretty --pro      # batch product detail, bypass daemon
1688 compare 628196518518 1234567890                          # compare offer details

# Supplier scraper / supplier research
1688 supplier search 键盘 --factory-only --json                # supplier discovery from company search
1688 supplier research 键盘 --enrich top:5 --csv               # supplier scoring + inspect enrichment
1688 supplier inspect 628196518518                            # inspect supplier/factory trust signals

# Pre-sale inquiry (with live watch for AI agents)
1688 seller inquire 628196518518 "支持定制 logo 吗？"          # ask seller
1688 seller messages --offer 628196518518                     # one-shot read
1688 seller messages --offer 628196518518 --watch             # live-tail new replies (JSON when piped)

# Order tracking & post-sale chat
1688 order list --status waitsellersend                       # list orders
1688 order get      <orderId>                                 # one order detail
1688 order logistics <orderId>                                # tracking + trace
1688 seller chat    <orderId> "麻烦尽快发货谢谢"               # chase shipment
1688 seller messages <orderId>                                # read seller's reply
```

---

## Why

Existing 1688 automation options are heavy: Selenium glue you maintain, browser
extensions you can't pipe into a shell, MCP servers that fight with your
agent's tooling. `1688-cli` is a single command:

- **Real Microsoft Edge under the hood** (`channel:'msedge'`). Same browser you'd
  use manually — your session is real, not a synthetic Chromium.
- **Persistent profiles** under `~/.1688/`. One login lasts for weeks, and
  multiple buyer profiles can stay isolated.
- **Profile-scoped daemon** — each profile can keep its own warm browser
  context, so subsequent commands reuse it without relaunching Chrome.
- **JSON-or-text dual mode** — `1688 order list | jq` works; `1688 order list`
  in your terminal pretty-prints.
- **Designed for AI agents.** See [AGENTS.md](./AGENTS.md) for the contract.

### Not in scope

This is not a marketing / scraping tool for bulk-listing the whole site, and
not a checkout automation farm. It mirrors what a buyer does manually: pick
a product, ask the seller a question, place an order, track shipping. Place
order (`checkout confirm`) is gated behind TTY prompts or an explicit
`--agent` flag so agents can't move money silently.

---

## Install

Requires Node 20+ and (recommended) Google Chrome installed. Without Chrome,
postinstall downloads Playwright's bundled Chromium (~150 MB; China users get
the npmmirror automatically).

```bash
npm i -g 1688-cli
1688 doctor                # verify environment
1688 login                 # one-time, scan QR on phone
```

---

## Command reference

| Command | Description |
|---|---|
| `1688 login` | Scan QR code to log in; auto-starts daemon |
| `1688 search <keyword>` | Keyword product search with filters |
| `1688 research <keywords...>` | Multi-keyword sourcing with scoring and enrichment |
| `1688 compare <offerIds...>` | Compare multiple offer detail pages |
| `1688 supplier inspect <target>` | Supplier identity, factory card, trust signals |
| `1688 supplier search <keywords...>` | Company-search supplier discovery |
| `1688 supplier research <keywords...>` | Scored supplier dataset with inspect enrichment |
| `1688 image-search <path\|url>` | Search by local image or http(s) URL |
| `1688 offer <offerIds...>` | Single or batch product detail (SKUs, package, images) |
| `1688 similar <offerId>` | Find similar / 找同款 offers (official entry point) |
| `1688 inbox` | List recent 旺旺 IM conversations |
| `1688 seller inquire` | Pre-sale inquiry: send product link + question |
| `1688 seller messages` | Read seller conversation messages |
| `1688 seller chat` | Send message to seller (order or pre-sale) |
| `1688 checkout prepare` | Preview total/address/items for checkout (read-only) |
| `1688 checkout confirm` | Place an order for selected cart items |
| `1688 cart list` | List items in your cart |
| `1688 cart add` | Add one item to cart by offerId + SKU |
| `1688 cart remove` | Remove one item from cart by cartId |
| `1688 shipped <orderId>` | Order detail + logistics merged |
| `1688 stuck` | Orders paid but not shipped after N days |
| `1688 fake-shipped` | Orders marked shipped but courier never collected |
| `1688 seller-history <seller>` | All orders from a seller + stats |
| `1688 order list` | List buyer orders by status |
| `1688 order get <orderId>` | Show one order by orderId |
| `1688 order logistics <orderId>` | Shipping status + tracking number |
| `1688 whoami` | Show the current logged-in account |
| `1688 logout` | Log out and clear local session |
| `1688 doctor` | Check environment, profile, Chromium, and session |
| `1688 serve` | Run the 1688 daemon in the foreground |
| `1688 daemon start\|stop\|reload\|status` | Manage the background daemon |
| `1688 profile list\|status` | Inspect local 1688 profiles |
| `1688 debug list\|last\|show` | Inspect recent command events and artifacts |
| `1688 feedback` | Submit feedback or a bug report |

---

## Commands

Organized by the buyer journey: discover → ask → decide → buy → track →
follow up.

### 1. Sourcing — Product Scraper and Supplier Scraper

Sourcing has two separate paths. Use **Product Scraper / Product Research**
when you start from products or offers. Use **Supplier Scraper / Supplier
Research** when you start from companies, factories, or supplier qualification.

#### Product Scraper / Product Research

```bash
1688 search 机械键盘 --max 20                    # keyword search
1688 search 手机壳 --sort best-selling --price-max 50 --exclude-ads
1688 research 手机壳 数据线 --max-per-query 50 --enrich top:5 --csv
1688 image-search ./shoe.jpg                     # search by local image
1688 image-search https://.../img.png            # search by http(s) URL
1688 offer 628196518518                          # single product detail (priceTiers, attributes, packageInfo, SKUs)
1688 offer 628196518518 1234567890 --pro --json  # batch product detail, bypass daemon
1688 compare 628196518518 1234567890             # compare price/MOQ/SKU/sales signals
```

#### Batch offer collection

Pass multiple offer IDs to collect them in sequence. Single ID keeps the
original JSON shape; multiple IDs return a batch envelope:

```bash
1688 offer 967417789506 --json --pretty                      # single → OfferResult
1688 offer 967417789506 --json --pretty --pro                # single, bypass daemon pause
1688 offer 967417789506 817273094122 --json --pretty --pro   # batch → OfferBatchResult
```

Batch output shape:

```json
{
  "mode": "batch",
  "total": 2,
  "success": 2,
  "failed": 0,
  "offerIds": ["967417789506", "817273094122"],
  "offers": [ /* ... */ ],
  "failures": []
}
```

- `--pro` bypasses daemon health pause for each offer.
- `RISK_CONTROL` per-offer failures appear in `failures[]`, don't stop the batch.
- Progress lines are written to stderr so `--json --pretty` stdout stays clean.

#### Deep pro search

Search first, then deep collect returned offer IDs in pro inline mode.
Each offer is retried up to 2 times after the first failed attempt.

```bash
# Official npm install
1688 search "修枝剪" --max 30 --deeppro --json --pretty

# Local dev build
node .\dist\cli.js search "修枝剪" --max 30 --deeppro --json --pretty

# Price-filtered deep search
1688 search "修枝剪" --max 15 --price-min 5 --price-max 20 --deeppro --json --pretty
```

> `--price-min` / `--price-max` filter the search-page card prices.
> DEEPPRO detail-page prices may exceed the search-page range because
> SKUs are fully expanded on the detail page.

Output includes a `deeppro` envelope alongside normal search results:

```json
{
  "keyword": "修枝剪",
  "total": 30,
  "offers": [ /* normal search results */ ],
  "deeppro": {
    "enabled": true,
    "total": 30,
    "success": 27,
    "failed": 3,
    "offers": [ /* full OfferResult deep collects */ ],
    "failures": [
      { "offerId": "...", "code": "RISK_CONTROL", "message": "...", "attempts": 3 }
    ]
  }
}
```

- `--max` controls how many search results are deep-collected.
- `--deeppro` uses pro inline collection for every offer, bypassing daemon health pause.
- `--deeppro-delay-min` / `--deeppro-delay-max` control the pause between offers (default 6–10 s).
- `--deeppro-search-mode inline` (default): search stage also bypasses daemon.
- `--deeppro-search-mode daemon`: search stage runs on daemon, offer deep collect still uses pro inline.
  This mode is closer to the legacy script workflow and may help with sensitive categories.
- `--deeppro-output-dir <dir>`: saves search.json, per-offer attempt JSON, error JSON, final JSON, and summary.json
  for offline debugging when deeppro reports failures unexpectedly.
- Each offer is retried up to 3 times total (1 initial + 2 retries).
- Progress is written to stderr; stdout remains clean JSON.
- `RISK_CONTROL` still means 1688 itself showed a verification challenge.

```bash
# Debug sensitive category with daemon search mode + output files
node .\dist\cli.js search "飞机杯" --max 5 --deeppro --deeppro-search-mode daemon \
  --deeppro-output-dir .\deeppro_debug --json --pretty \
  1> result.json 2> progress.txt
```

`1688 search` and `1688 research` are offer-first. They search product offers,
score offer results, export datasets, and can enrich top offers through detail
pages. Use this path when price, MOQ, SKU depth, sales signals, images, and
offer-level comparison are the first decision points.

`1688 similar <offerId>` is retained for compatibility with the official
1688 "找同款" entry point, but that entry point currently returns an empty
image-search shell for tested offers. The command does not fall back to
keyword or image search because those results are not strict same-product
matches.

#### Supplier Scraper / Supplier Research

```bash
1688 supplier search 键盘 --factory-only           # company-search supplier discovery, not offer aggregation
1688 supplier search 键盘 --max 20 --province 广东 --city 深圳
1688 supplier research 键盘 --enrich top:5 --csv   # supplier scoring + optional supplier inspect enrichment
1688 supplier inspect 628196518518                # supplier identity, factory card, trust/service signals
1688 supplier inspect b2b-22066467246504ba0d      # inspect by supplier memberId
```

`1688 supplier search` is the read-only 1688 Supplier Scraper. It pulls
supplier/company records directly from 1688 company search
(`companySearchBusinessService`) for a keyword and filters. It does not build
suppliers by grouping product-offer results.

`1688 supplier research` is the scored/export workflow on top of that supplier
scraper, with optional `supplier inspect` enrichment for the top companies.
Use this path when factory identity, service years, repeat/response rates,
location, company profile, and supplier qualification are the first decision
points.

#### Which path should I use?

| Need | Command |
|---|---|
| Find product offers | `1688 search <keyword...>` |
| Build a scored product dataset | `1688 research <keyword...>` |
| Official same-product matching | `1688 similar <offerId>` (currently unavailable when the official endpoint returns empty) |
| Inspect one product offer | `1688 offer <offerId>` |
| Batch collect product offers | `1688 offer <offerId...>` |
| Compare product offers | `1688 compare <offerId...>` |
| Find companies or factories directly | `1688 supplier search <keyword...>` |
| Build a scored supplier dataset | `1688 supplier research <keyword...>` |
| Inspect one supplier/factory | `1688 supplier inspect <offerId|memberId>` |

Supplier company-search flags:

```bash
1688 supplier search 键盘 --max 20 --factory-only --province 广东 --city 深圳
1688 supplier search 键盘 --min-years 3 --min-repeat-rate 0.4 --min-response-rate 0.6
1688 supplier research 键盘 --enrich top:10 --jsonl
1688 supplier research 键盘 --enrich top:5 --csv --output suppliers.csv
```

`supplier search` defaults to no enrichment (`--enrich 0`). `supplier research`
defaults to `--enrich top:10`, which calls `supplier inspect` for the top
company-search suppliers when a `memberId` is available. The supplier result
includes company name, `memberId`, shop URL, location, service years, factory
signals, repeat/response rates, 3-month order/amount signals, score breakdown,
and product previews from the company-search payload.

### 2. Pre-sale inquiry — ask the supplier

> Uses the same `seller messages` / `seller chat` tooling as §6, scoped by
> `--offer <offerId>` instead of an orderId.

```bash
1688 seller inquire 628196518518 "支持定制 logo 吗？"               # send a product link + question
1688 seller messages --offer 628196518518                          # read replies (one-shot)
1688 seller messages --offer 628196518518 --since 2026-05-13T10:00:00+08:00
1688 seller messages --offer 628196518518 --watch --interval 30    # live-tail new replies
```

**Watch mode** prints only newly-arrived messages as line-delimited JSON
when stdout is piped — pipe into any agent. Dedup is by server-side
`messageId`. Min interval 10 s.

### 3. Cart — collect SKUs

```bash
1688 cart list
1688 cart add    <offerId> --sku <skuId> --qty 2
1688 cart remove <cartId>
```

`cart add` returns `{added: CartItem, isNewRow, addedQuantity}` so pipelines
can pick up the new cartId reliably even when the same SKU is already in cart
(server merges into the existing row in that case):

```bash
id=$(1688 cart add 628196518518 --sku 6070845665229 --qty 1 | jq -r '.added.cartId')
1688 cart remove "$id"
```

PowerShell equivalent:

```powershell
$added = 1688 cart add 628196518518 --sku 6070845665229 --qty 1 --json | ConvertFrom-Json
1688 cart remove $added.added.cartId
```

### 4. Checkout — place the order

```bash
1688 checkout prepare <cartIds...>           # preview total/address/items — safe, read-only
1688 checkout confirm <cartIds...>           # default: TTY prompt y/N
1688 checkout confirm <cartIds...> -y        # skip prompt (TTY still required)
1688 checkout confirm <cartIds...> --agent   # AI-agent mode: no prompts (explicit autonomy opt-in)
```

### 5. Order tracking — follow the shipment

```bash
1688 order list                                       # all statuses (with actions, services, badges)
1688 order list --status waitsellersend               # paid, awaiting shipment
1688 order list --status waitbuyerreceive             # shipped, awaiting delivery
1688 order get   <orderId>                            # one order detail
1688 order logistics <orderId>                        # tracking number + trace
1688 order get  <orderId> --status waitbuyerreceive   # narrow the scan on heavy accounts

# Convenience views
1688 shipped <orderId>                  # order detail + logistics merged
1688 stuck --days 3                     # paid but not shipped > N days
1688 fake-shipped --days 1              # marked shipped but courier never collected (虚假发货)
1688 fake-shipped --debug               # show each candidate's status + remark
1688 seller-history <sellerName>        # all orders + avg ship days + on-time rate
```

### 6. Post-sale chat — chase delivery / claims

> Same tooling as §2, scoped by `<orderId>` so messages auto-attach the
> order card and replies thread under the right conversation.

```bash
1688 seller chat <orderId> "麻烦尽快发货谢谢"                     # send (auto-attaches order card)
1688 seller chat <orderId> "请问什么时候发货" --no-card           # follow-up, no card
1688 seller messages <orderId>                                  # read replies
1688 seller messages <orderId> --limit 50 --since 2026-05-01T00:00:00+08:00
1688 seller messages <orderId> --watch                          # live-tail
```

### Account & daemon

```bash
1688 login                              # scan QR; auto-starts daemon
1688 login --headed                     # open real window (fallback for risk control)
1688 login --force                      # re-login even if cached
1688 logout                             # clear cookies
1688 whoami                             # current nick + memberId
1688 doctor                             # environment check

1688 daemon start | stop | status | reload
```

### Profiles

Every command uses the `default` profile unless you pass `--profile <name>`.
Default behavior is backwards-compatible: `1688 search 雨伞` uses the default
profile, default daemon, default lock, and default cached identity.

Use profiles when you operate more than one buyer account or want isolated
cookie/session state:

```bash
1688 login --profile acc-a --headed
1688 login --profile acc-b --headed

1688 daemon start  --profile acc-a
1688 daemon start  --profile acc-b
1688 daemon status --profile acc-a
1688 daemon status --profile acc-b

1688 search "实木床头柜" --profile acc-a
1688 search "实木床头柜" --profile acc-b

1688 profile list
1688 profile status acc-a
1688 doctor --profile acc-a
```

Each profile has its own persistent browser directory, daemon process,
socket/named pipe, pid/version/log files, state file, and lock. Different
profiles can run in parallel; commands for one profile do not wait on another
profile's lock. Within one profile, daemon work remains serialized and paced.

### Inbox — 旺旺 conversations

```bash
1688 inbox --limit 20                    # recent conversations (newest first)
1688 inbox --unread                       # only unread conversations
1688 inbox --profile acc-a                # scoped to a named profile
```

### Debug — inspect command events

```bash
1688 debug list                           # recent command events
1688 debug list --limit 50 --failed       # failed events with more history
1688 debug last                           # most recent command event
1688 debug last --failed                  # most recent failed event
1688 debug show <requestId>               # full event + artifact location
```

### Feedback — submit bug reports

```bash
1688 feedback "search --deeppro failed on Windows" --bug --no-open
1688 feedback "offer batch should support --csv export" --submit
```

### Serve — foreground daemon

```bash
1688 serve --profile default              # run daemon in foreground
1688 serve --idle-timeout 60              # custom idle timeout (minutes)
1688 serve --no-prewarm                   # skip Chromium pre-warm at startup
```

### Doctor — environment check

```bash
1688 doctor                               # full check with Chromium launch
1688 doctor --no-launch                   # skip Chromium launch test (faster)
1688 doctor --live                        # read-only live probes (daemon, artifacts, event logging)
1688 doctor --profile acc-a               # check a specific profile
```

### Login — options

```bash
1688 login                                # scan QR, auto-start daemon
1688 login --timeout 300                  # wait up to 5 minutes for QR scan
1688 login --no-daemon                    # login without auto-starting daemon
1688 login --headed                       # open real browser window instead of terminal QR
1688 login --force                        # re-login even if session already exists
```

### Output shape principles

- **Normal search** (no `--deeppro`): returns `{ offers: Offer[] }` — behaviour unchanged.
- **Single offer**: returns one `OfferResult` — original shape preserved.
- **Batch offer**: returns `{ mode: "batch", offers: OfferResult[], failures: OfferFailure[] }`.
- **Search `--deeppro`**: returns normal `offers[]` + `deeppro: { offers: OfferResult[], failures: DeepProFailure[] }`.
- **Progress** lines are written to `stderr`; **JSON** output is written to `stdout`.

---

## FAQ

### Compared to alternatives

#### How does 1688-cli compare to MCP servers and Selenium scripts?

1688-cli runs as a regular shell command, not an MCP server. Agents call it
via `child_process` or shell pipes instead of the MCP protocol — easier to
compose with `jq`, `xargs`, and CI scripts. Compared to writing low-level
browser automation directly, 1688-cli ships with structured JSON output,
session persistence, and a daemon for warm context, so you don't reinvent
that per project.

#### Does 1688 have an official API I should use instead?

Alibaba offers a 1688 Open API at `open.1688.com`, but it's gated to
enterprise ISV partners with a sales contract and per-app authorization.
Individual buyers, small businesses, and AI agents typically can't get
access. 1688-cli uses your normal logged-in buyer account via a one-time
QR scan, mirroring what you can do manually in a browser — no developer
keys required.

### Account & verification

#### Does this tool require any 1688 developer account or API keys?

No. Login is a one-time QR scan with your normal 1688 mobile app — the
same flow as logging into 1688 on a fresh browser. The default session is
stored in your local profile (`~/.1688/profiles/default/`) and reused across
commands, so you only re-scan when 1688 invalidates it. Named profiles use
their own directories under `~/.1688/profiles/<name>/`.

#### What happens if 1688 shows a verification challenge (滑块)?

1688 occasionally shows a slider verification on unfamiliar sessions or
after long inactivity — the same one you'd see when logging in from a new
device manually. If a command fails because of this, run it once with
`--headed` (e.g. `1688 search 雨伞 --headed`); a real window opens, you
drag the slider yourself, and the verified session is reused for
subsequent commands. There is no automated solver — it's the same manual
step a person would take.

#### Is it safe to use? Will my account get rate-limited?

The tool drives your own logged-in browser session and only performs
actions you'd do manually — search, read order details, send chat
messages, place an order you confirmed. Use it at human pace (the default
`--watch` interval is 30 seconds, minimum 10) for one of your own
accounts. Aggressive automation, high-frequency scraping, or running it
across many accounts is outside the tool's design and increases the
chance of triggering 1688's risk controls.

---

## JSON for agents

Every command auto-switches to JSON when stdout is piped:

```bash
1688 order list --status waitsellersend | jq '.orders[] | {id: .orderId, paid: .paidAt}'
1688 fake-shipped --debug             | jq '.orders[].orderId'
1688 search 雨伞                       | jq '.offers[0:5]'
1688 supplier search 键盘              | jq '.items[0] | {company: .supplier.companyName, memberId: .supplier.memberId, score}'
1688 supplier research 键盘 --enrich top:1 | jq '{source,total,enrichedCount,first: .items[0].supplier.companyName}'
```

Supplier-search JSON explicitly carries source provenance:

```json
{
  "source": {
    "kind": "company-search",
    "endpoint": "companySearchBusinessService",
    "offerAggregation": false
  }
}
```

### Built-in JSON flags (no `jq` required)

Every command supports four output-shaping flags. Useful on Windows or any
environment where `jq` isn't installed — and for agents that want concise
output without parsing the full payload.

```bash
1688 offer <id> --json                       # force JSON even in a TTY
1688 offer <id> --json --pretty              # JSON with 2-space indent

1688 offer <id> --get supplier.name          # one scalar field, raw line
1688 offer <id> --get supplier               # sub-object as JSON
1688 offer <id> --get 'skus[0].skuId'        # array index
1688 offer <id> --get 'skus[*].price'        # wildcard — one line per element

1688 offer <id> --pick price,supplier.name,'skus[0].skuId'
# {"price":1.25,"supplier.name":"...","skus[0].skuId":"..."}
```

Path syntax: `field.sub`, `arr[N].field`, `arr[*].field`. Wildcards stream
one line per element; scalars print as a raw line (no quotes), objects and
arrays as JSON. The full payload still goes through when no `--get`/`--pick`
is given, so existing `| jq` pipelines keep working unchanged.

Force JSON in a TTY (alternative to `--json`):

```bash
BB1688_JSON=1 1688 doctor
```

PowerShell:

```powershell
$env:BB1688_JSON = "1"
1688 doctor
Remove-Item Env:\BB1688_JSON
```

### Windows / PowerShell examples

The npm `1688` shim works from PowerShell and cmd.exe. Prefer built-in
`--get` / `--pick` when `jq` is not installed:

```powershell
1688 offer 628196518518 --get supplier.name
1688 supplier search 键盘 --pick total,source.kind,'items[0].supplier.companyName'
1688 supplier research 键盘 --csv --output "$env:TEMP\suppliers.csv"
```

Daemon management is the same command surface:

```powershell
1688 daemon start
1688 daemon status --json
1688 daemon stop

1688 daemon start --profile acc-a
1688 daemon status --profile acc-a --json
1688 daemon stop --profile acc-a
```

---

## Risk control

If 1688 shows a slider verification (滑块), solve it once with `--headed`:

```bash
1688 search 雨伞 --headed     # window opens; drag the slider yourself
1688 supplier search 键盘 --headed
1688 search 雨伞              # subsequent calls reuse the verified session
```

See also the FAQ entry on [verification challenges](#what-happens-if-1688-shows-a-verification-challenge-滑块).

---

## Files & directories

```
~/.1688/profiles/default/   Chromium profile (macOS/Linux)
~/.1688/state.json          cached identity (macOS/Linux)
~/.1688/daemon.sock         daemon Unix socket (macOS/Linux)
~/.1688/daemon.pid          daemon PID
~/.1688/.lock               proper-lockfile (one process at a time)

~/.1688/profiles/<name>/state.json       named-profile cached identity
~/.1688/profiles/<name>/daemon.sock      named-profile daemon Unix socket
~/.1688/profiles/<name>/daemon.pid       named-profile daemon PID
~/.1688/profiles/<name>/.lock            named-profile lock

%USERPROFILE%\.1688\profiles\default\   Chromium profile (Windows)
%USERPROFILE%\.1688\state.json          cached identity (Windows)
\\.\pipe\1688-cli-daemon-<hash>         daemon named pipe (Windows)
\\.\pipe\1688-cli-daemon-<hash>-<hash>  named-profile daemon pipe (Windows)
```

## Environment variables

```
BB1688_NO_DAEMON=1          disable daemon, always run inline
BB1688_JSON=1               force JSON output on TTY
BB1688_DEBUG=1              verbose internal logs to stderr
BB1688_FORCE_CHROMIUM=1     skip system Chrome, use bundled Chromium
BB1688_HOME=<path>          override ~/.1688 or %USERPROFILE%\.1688
BB1688_SKIP_POSTINSTALL=1   skip Chromium download during npm install
PLAYWRIGHT_DOWNLOAD_HOST    custom Playwright mirror
```

---

## Status

Pre-1.0 — the surface is shaped but minor breaks are possible between minor
versions until 1.0. See [CHANGELOG.md](./CHANGELOG.md). Not affiliated with
Alibaba / 1688.

## Agent contract

If you're driving `1688-cli` from Codex, Claude Code, or another autonomous
agent, read [AGENTS.md](./AGENTS.md) — it documents JSON shapes, exit codes,
and the rules around the write commands.

## License

[MIT](./LICENSE)
