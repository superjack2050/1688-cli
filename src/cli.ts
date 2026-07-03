#!/usr/bin/env node
import { Command } from 'commander';
import { CliError } from './io/errors.js';
import {
  currentCommandName,
  isJson,
  isJsonV2,
  makeEnvelope,
  setOutputFlags,
} from './io/output.js';
import updateNotifier from 'update-notifier';
import pkg from '../package.json' with { type: 'json' };
import { sanitiseCliArgs } from './util/cli-args.js';

// Background check (once/day). On a TTY this prints a human banner.
// In JSON mode we surface a structured `_notice` line on stderr (see the
// preAction hook below) so agents can detect updates without parsing the
// banner.
const _notifier = updateNotifier({
  pkg,
  updateCheckInterval: 1000 * 60 * 60 * 24,
});
_notifier.notify({ defer: false, isGlobal: true });

const program = new Command();

program
  .name('1688')
  .description('1688 CLI for humans, Codex, and Claude Code')
  .version(pkg.version);

program
  .command('login')
  .description('Log in to 1688 by scanning a QR code (auto-starts daemon afterwards)')
  .option('--force', 'Re-login even if a session already exists')
  .option('--timeout <seconds>', 'Seconds to wait for QR scan', '300')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a real browser window instead of terminal QR')
  .option('--no-daemon', 'Do not auto-start the daemon after login')
  .action(async (opts) => {
    const { run } = await import('./commands/login.js');
    await run(opts);
  });

program
  .command('search')
  .description('Search 1688 by keyword')
  .argument('<keyword>', 'Keyword to search (use quotes for multi-word)')
  .option('--max <n>', 'Maximum number of results', '10')
  .option('--sort <sort>', 'Sort: relevance | best-selling | price-asc | price-desc', 'relevance')
  .option('--price-min <n>', 'Minimum unit price')
  .option('--price-max <n>', 'Maximum unit price')
  .option('--province <name>', 'Filter supplier province')
  .option('--city <name>', 'Filter supplier city')
  .option('--verified <kind>', 'Filter: any | factory | business | super-factory', 'any')
  .option('--min-turnover <n>', 'Minimum parsed turnover/order count')
  .option('--exclude-ads', 'Exclude P4P/ad results')
  .option('--deeppro', 'After search, deep collect each offer using pro inline mode (retry up to 3x)')
  .option('--deeppro-delay-min <seconds>', 'Minimum delay between deeppro offer collections', '6')
  .option('--deeppro-delay-max <seconds>', 'Maximum delay between deeppro offer collections', '10')
  .option('--deeppro-output-dir <dir>', 'Write deeppro search, attempt, final, failure, and summary JSON files to a directory')
  .option('--deeppro-search-mode <mode>', 'Initial search mode for deeppro: inline | daemon', 'inline')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a browser window (use to pass slider verification)')
  .action(async (keyword, opts) => {
    const { run } = await import('./commands/search.js');
    await run(keyword, opts);
  });

program
  .command('research')
  .description('Run multi-keyword sourcing research with scoring and optional enrichment')
  .argument('<keywords...>', 'One or more keywords to research')
  .option('--max-per-query <n>', 'Maximum search results per keyword', '20')
  .option('--sort <sort>', 'Sort: relevance | best-selling | price-asc | price-desc', 'best-selling')
  .option('--price-min <n>', 'Minimum unit price')
  .option('--price-max <n>', 'Maximum unit price')
  .option('--province <name>', 'Filter supplier province')
  .option('--city <name>', 'Filter supplier city')
  .option('--verified <kind>', 'Filter: any | factory | business | super-factory', 'any')
  .option('--min-turnover <n>', 'Minimum parsed turnover/order count')
  .option('--exclude-ads', 'Exclude P4P/ad results')
  .option('--enrich <spec>', 'Enrich top N offers via detail pages: top:N, N, 0, none', '0')
  .option('--jsonl', 'Emit one JSON object per research item')
  .option('--csv', 'Emit CSV')
  .option('--output <file>', 'Write JSONL/CSV export to a file')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (keywords, opts) => {
    const { run } = await import('./commands/research.js');
    await run({ ...opts, keywords });
  });

program
  .command('compare')
  .description('Compare multiple offer detail pages for sourcing decisions')
  .argument('<offerIds...>', 'Offer IDs to compare')
  .option('--csv', 'Emit CSV')
  .option('--output <file>', 'Write CSV export to a file')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (offerIds, opts) => {
    const { run } = await import('./commands/compare.js');
    await run({ ...opts, offerIds });
  });

const supplier = program
  .command('supplier')
  .description('Supplier inspection and trust signals');

supplier
  .command('inspect')
  .description('Inspect supplier signals from an offerId or b2b-* memberId')
  .argument('<target>', 'offerId, offer URL, b2b-* memberId, or factory-card URL')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (target, opts) => {
    const { run } = await import('./commands/supplier-inspect.js');
    await run({ ...opts, target });
  });

supplier
  .command('search')
  .description('Search suppliers from 1688 company search')
  .argument('<keywords...>', 'One or more supplier/company search keywords')
  .option('--max <n>', 'Maximum suppliers per keyword', '20')
  .option('--factory-only', 'Only keep suppliers with factory signals')
  .option('--province <name>', 'Filter supplier province')
  .option('--city <name>', 'Filter supplier city')
  .option('--min-years <n>', 'Minimum supplier service years')
  .option('--min-repeat-rate <n>', 'Minimum repeat rate, e.g. 0.4 or 40')
  .option('--min-response-rate <n>', 'Minimum Wangwang response rate, e.g. 0.6 or 60')
  .option('--enrich <spec>', 'Enrich top N suppliers via supplier inspect: top:N, N, all, 0, none', '0')
  .option('--jsonl', 'Emit one JSON object per supplier')
  .option('--csv', 'Emit CSV')
  .option('--output <file>', 'Write JSONL/CSV export to a file')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (keywords, opts) => {
    const { run } = await import('./commands/supplier-search.js');
    await run({ ...opts, keywords });
  });

supplier
  .command('research')
  .description('Run supplier research from 1688 company search with scoring and inspect enrichment')
  .argument('<keywords...>', 'One or more supplier/company search keywords')
  .option('--max <n>', 'Maximum suppliers per keyword', '20')
  .option('--factory-only', 'Only keep suppliers with factory signals')
  .option('--province <name>', 'Filter supplier province')
  .option('--city <name>', 'Filter supplier city')
  .option('--min-years <n>', 'Minimum supplier service years')
  .option('--min-repeat-rate <n>', 'Minimum repeat rate, e.g. 0.4 or 40')
  .option('--min-response-rate <n>', 'Minimum Wangwang response rate, e.g. 0.6 or 60')
  .option('--enrich <spec>', 'Enrich top N suppliers via supplier inspect: top:N, N, all, 0, none', 'top:10')
  .option('--jsonl', 'Emit one JSON object per supplier')
  .option('--csv', 'Emit CSV')
  .option('--output <file>', 'Write JSONL/CSV export to a file')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (keywords, opts) => {
    const { runResearch } = await import('./commands/supplier-search.js');
    await runResearch({ ...opts, keywords });
  });

program
  .command('image-search')
  .description('Search 1688 by image (local file or http(s) URL)')
  .argument('<imagePathOrUrl>', 'Local file path OR http(s) image URL')
  .option('--max <n>', 'Maximum number of results', '20')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .option('--debug-image', 'Include upload/capture diagnostics in JSON output')
  .action(async (imagePath, opts) => {
    const { run } = await import('./commands/image-search.js');
    await run({ ...opts, imagePath });
  });

program
  .command('offer')
  .description('Show details of one or more 1688 offers')
  .argument('<offerIds...>', 'One or more offer IDs (digits)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a browser window (fallback for risk control)')
  .option('--pro', 'Run offer collection inline and bypass daemon health pause')
  .action(async (offerIds: string[], opts) => {
    const { run } = await import('./commands/offer.js');
    await run({ ...opts, offerIds });
  });

program
  .command('similar')
  .description(
    'Find similar / 找同款 offers for a given offerId (compare suppliers, sorted by price)',
  )
  .argument('<offerId>', 'Offer ID (digits)')
  .option('--max <n>', 'Maximum number of similar offers', '20')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (offerId, opts) => {
    const { run } = await import('./commands/similar.js');
    await run({ ...opts, offerId });
  });

program
  .command('inbox')
  .description('List recent 旺旺 IM conversations (newest first)')
  .option('--limit <n>', 'Max conversations to return (default 20, max 200)', '20')
  .option('--unread', 'Only show conversations with unread messages')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (opts) => {
    const { run } = await import('./commands/inbox.js');
    await run(opts);
  });

const seller = program
  .command('seller')
  .description('Seller communication (旺旺 IM). See also: `1688 inbox`.');

seller
  .command('inquire')
  .description(
    'Pre-sale inquiry: send a product link + question to seller (requires prior chat or --to)',
  )
  .argument('<offerId>', 'Offer ID (digits)')
  .argument('<message>', 'Question to ask (≤ 400 chars)')
  .option('--to <sellerLoginId>', 'Override seller lookup with explicit loginId')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (offerId, message, opts) => {
    const { run } = await import('./commands/seller-inquire.js');
    await run({ ...opts, offerId, message });
  });

seller
  .command('messages')
  .description('Read recent messages from a seller conversation')
  .argument('[target]', 'orderId (digits) OR seller loginId/name (omit if --offer)')
  .option('--offer <offerId>', 'Read pre-sale inquiry replies for this offerId')
  .option('--limit <n>', 'Max messages to return (default 20, max 200)', '20')
  .option(
    '--since <iso>',
    'Only show messages after this ISO timestamp (e.g. 2026-05-12T16:44:00+08:00)',
  )
  .option('--watch', 'Poll continuously and print new messages as they arrive')
  .option(
    '--interval <seconds>',
    'Polling interval in seconds for --watch (default 30, min 10)',
    '30',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (target, opts) => {
    const { run } = await import('./commands/seller-messages.js');
    await run({ ...opts, target });
  });

seller
  .command('chat')
  .description(
    'Send to seller. With orderId: sends order card link + message (use --no-card for follow-ups).',
  )
  .argument('<target>', 'orderId (digits) OR seller loginId/name')
  .argument('<message>', 'Message to send (≤ 500 chars)')
  .option(
    '--no-card',
    'Skip the order detail link card (for follow-up replies)',
  )
  .option(
    '--prefix',
    'Also prepend 【订单 XXX】 in message text',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (target, message, opts) => {
    const { run } = await import('./commands/seller-chat.js');
    await run({ ...opts, target, message });
  });

const checkout = program
  .command('checkout')
  .description('Checkout preview and confirmation (write operations)');

checkout
  .command('confirm')
  .description(
    'Place an order for selected cart items. Default: TTY+prompt. --agent: no prompt after external approval.',
  )
  .argument('<cartIds...>', 'cartIds to checkout (from `1688 cart list`)')
  .option('-y, --yes', 'Skip y/N prompt (TTY still required)')
  .option(
    '--agent',
    'Agent mode: no prompts. Use ONLY after user reviewed prepare.',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (cartIds, opts) => {
    const { run } = await import('./commands/checkout-confirm.js');
    await run({ ...opts, cartIds });
  });

checkout
  .command('prepare')
  .description('Preview total/address/items for a checkout (does NOT place order)')
  .argument('<cartIds...>', 'One or more cartIds from `1688 cart list`')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (cartIds, opts) => {
    const { run } = await import('./commands/checkout-prepare.js');
    await run({ ...opts, cartIds });
  });

const cart = program
  .command('cart')
  .description('1688 cart (采购车) operations');

cart
  .command('add')
  .description('Add one item to cart (UI replay, ~15s)')
  .argument('<offerId>', 'Offer ID (digits)')
  .requiredOption('--sku <skuId>', 'SKU ID (from `1688 offer <offerId>`)')
  .option('--qty <n>', 'Quantity', '1')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (offerId, opts) => {
    const { run } = await import('./commands/cart-add.js');
    await run({ ...opts, offerId });
  });

cart
  .command('remove')
  .description('Remove one item from cart by cartId (UI replay, ~10s)')
  .argument('<cartId>', 'Cart item ID (from `1688 cart list`)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (debug visibility)')
  .action(async (cartId, opts) => {
    const { run } = await import('./commands/cart-remove.js');
    await run({ ...opts, cartId });
  });

cart
  .command('list')
  .description('List items in your cart')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { run } = await import('./commands/cart-list.js');
    await run(opts);
  });

program
  .command('shipped')
  .description('Combined order detail + logistics for one orderId')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { runShipped } = await import('./commands/workflows.js');
    await runShipped({ ...opts, orderId });
  });

program
  .command('stuck')
  .description('Orders paid but not shipped after N days (default 3)')
  .option('--days <n>', 'Threshold in days', '3')
  .option('--limit <n>', 'Max orders to return', '50')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { runStuck } = await import('./commands/workflows.js');
    await runStuck(opts);
  });

program
  .command('fake-shipped')
  .description('Orders marked shipped but logistics frozen at 等待揽收 (likely 虚假发货)')
  .option('--days <n>', 'Days threshold since shippedAt', '1')
  .option('--max-pages <n>', 'Order list pages to scan (50/page)', '2')
  .option('--max-check <n>', 'Max candidates to query logistics for', '20')
  .option('--limit <n>', 'Max flagged orders to return', '50')
  .option('--debug', 'Print logistics status/remark for each candidate')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { runFakeShipped } = await import('./commands/workflows.js');
    await runFakeShipped(opts);
  });

program
  .command('seller-history')
  .description('All orders from a seller + avg shipping days + on-time rate')
  .argument('<seller>', 'Seller loginId or company name (partial match OK)')
  .option('--max-pages <n>', 'Max order list pages to scan (50/page)', '10')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (seller, opts) => {
    const { runSellerHistory } = await import('./commands/workflows.js');
    await runSellerHistory({ ...opts, seller });
  });

const order = program
  .command('order')
  .description('Buyer order operations');

order
  .command('logistics')
  .description('Show shipping status + tracking number for an order')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--max-scan-pages <n>', 'Max list pages to scan (50/page)', '5')
  .option(
    '--status <s>',
    'Narrow scan to one tradeStatus (waitbuyerreceive, waitsellersend, ...) — faster for heavy accounts',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { run } = await import('./commands/order-logistics.js');
    await run({ ...opts, orderId });
  });

order
  .command('get')
  .description('Show one order by orderId (scans recent pages)')
  .argument('<orderId>', 'Order ID (digits)')
  .option('--max-scan-pages <n>', 'Max list pages to scan (50/page)', '5')
  .option(
    '--status <s>',
    'Narrow scan to one tradeStatus (waitbuyerreceive, ...) — faster for heavy accounts',
  )
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (orderId, opts) => {
    const { run } = await import('./commands/order-get.js');
    await run({ ...opts, orderId });
  });

order
  .command('list')
  .description('List buyer orders')
  .option(
    '--status <s>',
    'Filter: all | waitbuyerpay | waitsellersend | waitbuyerreceive | success | cancel',
    'all',
  )
  .option('--page <n>', 'Page number', '1')
  .option('--page-size <n>', 'Page size (max 50)', '10')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--headed', 'Open a window (fallback for risk control)')
  .action(async (opts) => {
    const { run } = await import('./commands/order-list.js');
    await run(opts);
  });

program
  .command('whoami')
  .description('Show the current logged-in account')
  .option('--verify', 'Verify the session online (slower)')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/whoami.js');
    await run(opts);
  });

program
  .command('logout')
  .description('Log out and clear local session')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/logout.js');
    await run(opts);
  });

program
  .command('doctor')
  .description('Check environment, profile, Chromium, and session')
  .option('--no-launch', 'Skip the actual Chromium launch test (faster)')
  .option('--live', 'Run read-only live probes for daemon, artifacts, and event logging')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { run } = await import('./commands/doctor.js');
    await run(opts);
  });

program
  .command('serve')
  .description('Run the 1688 daemon in the foreground')
  .option('--profile <name>', 'Profile name (default: default)')
  .option('--idle-timeout <minutes>', 'Idle timeout in minutes', '30')
  .option('--no-prewarm', 'Skip pre-warming Chromium at startup')
  .action(async (opts) => {
    const { start } = await import('./daemon/server.js');
    await start({
      profile: opts.profile,
      idleTimeoutMs: Math.max(1, parseInt(opts.idleTimeout, 10)) * 60_000,
      prewarm: opts.prewarm !== false,
    });
  });

const daemon = program
  .command('daemon')
  .description('Manage the background 1688 daemon');

daemon
  .command('start')
  .description('Start the daemon as a background process')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { start } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const { pid, profile } = await start(opts.profile);
    emit({
      human: () =>
        process.stdout.write(
          `Daemon started for profile "${profile}" (pid ${pid}).\n`,
        ),
      data: { ok: true, profile, pid },
    });
  });

daemon
  .command('stop')
  .description('Stop the running daemon')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { stop } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const { stopped, profile } = await stop(opts.profile);
    emit({
      human: () =>
        process.stdout.write(
          stopped
            ? `Daemon stopped for profile "${profile}".\n`
            : `Daemon was not running for profile "${profile}".\n`,
        ),
      data: { ok: true, profile, stopped },
    });
  });

daemon
  .command('reload')
  .description('Restart the daemon (stop + start) to pick up new code')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { stop, start, status, cleanupLock } = await import(
      './daemon/manager.js'
    );
    const { defaultProfileName } = await import('./session/paths.js');
    const { emit, info } = await import('./io/output.js');
    const profile = defaultProfileName(opts.profile);
    const before = await status(profile);
    if (before.running) {
      info(`Stopping daemon for profile "${profile}"...`);
      await stop(profile);
    }
    // Force-clean stale lock — we own the lifecycle here, so this is safe.
    // proper-lockfile sometimes leaves the `.lock.lock` dir behind if the daemon
    // exits before its release callback runs to completion.
    info(`Cleaning stale lock for profile "${profile}"...`);
    await cleanupLock(profile);
    info(`Starting daemon for profile "${profile}"...`);
    const { pid } = await start(profile);
    emit({
      human: () =>
        process.stdout.write(
          `Daemon reloaded for profile "${profile}" (pid ${pid}).\n`,
        ),
      data: { ok: true, profile, pid, wasRunning: before.running },
    });
  });

daemon
  .command('status')
  .description('Show daemon status')
  .option('--profile <name>', 'Profile name (default: default)')
  .action(async (opts) => {
    const { status } = await import('./daemon/manager.js');
    const { emit } = await import('./io/output.js');
    const s = await status(opts.profile);
    emit({
      human: () => {
        if (!s.running) {
          process.stdout.write(`Daemon (${s.profile}): not running\n`);
          return;
        }
        process.stdout.write(`Daemon (${s.profile}): running (pid ${s.pid})\n`);
        if (s.version) {
          const suffix = s.versionMatches === false ? ' (restart recommended)' : '';
          process.stdout.write(`  version: ${s.version}${suffix}\n`);
        }
        if (s.reachable && s.stats && typeof s.stats === 'object') {
          const st = s.stats as Record<string, unknown>;
          process.stdout.write(`  uptime: ${Math.round((st.uptimeMs as number) / 1000)}s\n`);
          process.stdout.write(`  commands: ${st.commandCount}\n`);
          if (st.lastRequestAt) {
            process.stdout.write(`  last request: ${st.lastRequestAt}\n`);
          }
          const browser = st.browser as
            | { browserAlive?: boolean; currentUrl?: string | null; pageState?: { kind?: string } | null }
            | undefined;
          if (browser) {
            process.stdout.write(`  browser: ${browser.browserAlive ? 'alive' : 'not started'}\n`);
            if (browser.pageState?.kind) {
              process.stdout.write(`  page state: ${browser.pageState.kind}\n`);
            }
            if (browser.currentUrl) {
              process.stdout.write(`  current url: ${browser.currentUrl}\n`);
            }
          }
        }
      },
      data: s,
    });
  });

const profile = program
  .command('profile')
  .description('Inspect local 1688 profiles');

profile
  .command('list')
  .description('List local profiles')
  .action(async () => {
    const { list } = await import('./commands/profile.js');
    await list();
  });

profile
  .command('status')
  .description('Show profile status')
  .argument('[name]', 'Profile name', 'default')
  .action(async (name) => {
    const { status } = await import('./commands/profile.js');
    await status(name);
  });

const debug = program
  .command('debug')
  .description('Inspect recent command events and failure artifacts');

debug
  .command('list')
  .description('List recent command events')
  .option('--limit <n>', 'Max requests to show', '20')
  .option('--failed', 'Only show failed requests')
  .action(async (opts) => {
    const { list } = await import('./commands/debug.js');
    await list(opts);
  });

debug
  .command('last')
  .description('Show the most recent command event')
  .option('--failed', 'Show the most recent failed request')
  .action(async (opts) => {
    const { last } = await import('./commands/debug.js');
    await last(opts);
  });

debug
  .command('show')
  .description('Show events and artifact location for a request')
  .argument('<requestId>', 'Request ID')
  .action(async (requestId) => {
    const { show } = await import('./commands/debug.js');
    await show({ requestId });
  });

program
  .command('feedback')
  .description(
    'Submit feedback or a bug report. Default: opens a pre-filled GitHub issue. With --submit: posts directly via the `gh` CLI.',
  )
  // Variadic so macOS "smart quotes" can't truncate the message — words
  // are joined back together regardless of where the shell split them.
  .argument(
    '<message...>',
    'Your feedback or bug description (multiple words OK, quotes optional)',
  )
  .option('--bug', 'Tag the issue as a bug report')
  .option(
    '--submit',
    'Post the issue directly via the GitHub CLI (`gh`) — requires `gh auth login`',
  )
  .option('--no-open', 'Print the URL only; do not open a browser window')
  .action(async (messageParts: string[], opts) => {
    const { run } = await import('./commands/feedback.js');
    await run({ ...opts, message: messageParts.join(' ') });
  });

// Register the four output-shaping flags on every (sub)command so users
// don't have to remember a parent-command qualifier:
//   --json            Force JSON output even when stdout is a TTY.
//   --json-v2         Emit an opt-in response envelope for agent consumers.
//   --pretty          Pretty-print JSON (2-space indent).
//   --get <path>      Print one field by dot-path. Scalar → raw line,
//                     object/array → JSON. Supports a.b[0].c, arr[*].x
//                     (wildcards stream one line per element).
//   --pick <paths>    Comma-separated dot-paths → emit a JSON object with
//                     each path as a key.
//
// A preAction hook reads them via optsWithGlobals() and pushes into the
// output module before the command's run() calls emit().
function addOutputFlagsToAll(p: Command): void {
  for (const cmd of p.commands) {
    addOutputFlagsToAll(cmd);
    cmd.option('--json', 'Force JSON output even when stdout is a TTY');
    cmd.option('--json-v2', 'Emit an opt-in response envelope for agent consumers');
    cmd.option('--pretty', 'Pretty-print JSON output (use with --json or pipe)');
    cmd.option(
      '--get <path>',
      'Print one field by dot-path (a.b[0].c, arr[*].x). Scalar → raw line, object/array → JSON',
    );
    cmd.option(
      '--pick <paths>',
      'Comma-separated dot-paths → emit a JSON object with each as a key',
    );
  }
}
addOutputFlagsToAll(program);

program.hook('preAction', (_thisCmd, actionCmd) => {
  const opts = actionCmd.optsWithGlobals() as {
    json?: boolean;
    jsonV2?: boolean;
    pretty?: boolean;
    get?: string;
    pick?: string;
  };
  setOutputFlags({
    json: opts.json,
    jsonV2: opts.jsonV2,
    pretty: opts.pretty,
    get: opts.get,
    pick: opts.pick,
    cmd: actionCmd.name(),
  });

  // Agent-friendly update notice: in JSON mode, the human banner is
  // suppressed by update-notifier. Surface the same info as one line of
  // structured JSON on stderr so agents can detect updates programmatically.
  // See AGENTS.md → Update awareness.
  if (isJson() && _notifier.update) {
    const u = _notifier.update;
    process.stderr.write(
      JSON.stringify({
        _notice: 'updateAvailable',
        current: u.current,
        latest: u.latest,
        updateCommand: `npm i -g ${pkg.name}@latest`,
      }) + '\n',
    );
  }
});

try {
  await program.parseAsync(sanitiseCliArgs(), { from: 'user' });
} catch (e) {
  if (e instanceof CliError) {
    if (isJsonV2()) {
      process.stderr.write(
        JSON.stringify(
          makeEnvelope({
            cmd: currentCommandName(),
            error: {
              code: e.code,
              message: e.message,
              details: e.details,
            },
            artifactDir: e.details.artifactDir,
            verification: e.details.category
              ? { state: e.details.category, currentUrl: e.details.currentUrl }
              : undefined,
          }),
        ) + '\n',
      );
    } else if (isJson()) {
      process.stderr.write(
        JSON.stringify({
          ok: false,
          code: e.code,
          message: e.message,
          details: e.details,
        }) + '\n',
      );
    } else if (e.message) {
      process.stderr.write(`error: ${e.message}\n`);
      if (e.details.recoverHint) {
        process.stderr.write(`hint: ${e.details.recoverHint}\n`);
      }
      if (e.details.artifactDir) {
        process.stderr.write(`debug: ${e.details.artifactDir}\n`);
      }
    }
    process.exit(e.exitCode);
  }
  const err = e as Error;
  const msg = err?.message ?? String(e);
  // Playwright surfaces these when the user closes the browser mid-flow.
  if (
    /Target page, context or browser has been closed/i.test(msg) ||
    /Browser closed|Target closed/i.test(msg)
  ) {
    process.stderr.write('error: Canceled (browser closed).\n');
    process.exit(130);
  }
  process.stderr.write(`unexpected: ${err.stack ?? msg}\n`);
  process.exit(1);
}
