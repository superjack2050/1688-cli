import type { BrowserContext, Page, Response as PWResponse } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { withSession } from '../session/context.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import { sleep } from '../session/wait.js';
import { parseMtop } from '../session/mtop.js';
import { startResponseCapture } from '../session/response-capture.js';
import { debugTmpPath } from '../util/temp.js';

export interface OfferOpts {
  offerId?: string;
  offerIds?: string[];
  profile?: string;
  headed?: boolean;
  pro?: boolean;
}

export interface OfferFailure {
  offerId: string;
  code: string;
  message: string;
}

export interface OfferBatchResult {
  mode: 'batch';
  total: number;
  success: number;
  failed: number;
  offerIds: string[];
  offers: OfferResult[];
  failures: OfferFailure[];
}

export interface OfferArgs {
  offerId: string;
  headed?: boolean;
}

export interface OfferResult {
  offerId: string;
  title: string;
  url: string;
  priceRange: string | null;
  priceMin: number | null;
  priceMax: number | null;
  /** Display unit ("件" / "个" / "米" ...) */
  unitName: string | null;
  /** 起订量 — minimum order quantity for a single SKU buy. */
  minOrderQty: number | null;
  /** 混批起订量 — minimum quantity when mixing SKUs in one order. */
  mixOrderQty: number | null;
  /** Bulk-discount tiers, e.g. [{minQty: 1, price: 4.16}, {minQty: 100, price: 3.50}]. */
  priceTiers: PriceTier[];
  /** Long-form detail page URL (rich images / text). */
  detailUrl: string | null;
  /** Product attributes (材质 / 规格 / 产地 ...). Empty when the seller
   *  didn't fill them in. */
  attributes: ProductAttribute[];
  /** Per-SKU package dimensions (件重尺) when the seller filled them in.
   *  Empty array for small items (clothes, etc.) where 1688 omits this. */
  packageInfo: SkuPackage[];
  supplier: {
    name: string | null;
    loginId: string | null;
    memberId: string | null;
    userId: string | null;
  };
  freight: {
    receiveAddress: string | null;
    sendArea: string | null;
    province: string | null;
    city: string | null;
    unitWeight: number | null;
  };
  saledCount: number | null;
  categoryId: string | null;
  options: SkuOption[];
  skus: SkuVariant[];
  mainImage: string | null;
  images: string[];
}

export interface PriceTier {
  minQty: number;
  price: number;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface SkuPackage {
  skuId: string;
  spec: string;
  /** cm */
  length: number | null;
  width: number | null;
  height: number | null;
  /** Stated weight (raw value — 1688 sometimes uses grams or kg per offer). */
  weight: number | null;
  /** Volume (cm³). */
  volume: number | null;
}

export interface SkuOption {
  prop: string;
  values: { name: string; imageUrl: string | null }[];
}

export interface SkuVariant {
  skuId: string;
  specs: string;
  price: number | null;
  /** Bulk-tier price when 1688 surfaces a separate multi-piece price. */
  multiPrice: number | null;
  stock: number | null;
  saleCount: number;
  /** Best-effort image URL derived from the first option (颜色/款式) match. */
  image: string | null;
}

const SKU_API_RE = /wosc\.queryofferskuselectormodel/i;
let DETAIL_SEQ = 0;

export async function execute(
  ctx: BrowserContext,
  args: OfferArgs,
): Promise<OfferResult> {
  if (!/^\d+$/.test(args.offerId)) {
    throw new CliError(2, 'BAD_INPUT', `Invalid offerId: ${args.offerId}`);
  }
  return withRecovery(
    ctx,
    { cmd: 'offer', args },
    () => executeRaw(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

export async function executeRaw(
  ctx: BrowserContext,
  args: OfferArgs,
): Promise<OfferResult> {
  const page = await ctx.newPage();

  const skuCapture = startResponseCapture<SkuBizModel>({
    page,
    timeoutMs: 18000,
    matcher: SKU_API_RE,
    parse: async (resp) => {
      const text = await resp.text();
      if (process.env.BB1688_PROBE === '1') {
        try {
          const fs = await import('node:fs/promises');
          const file = debugTmpPath('1688-sku-raw.json');
          await fs.writeFile(file, text);
          process.stderr.write(
            `[probe] saved sku → ${file} (${text.length} bytes)\n`,
          );
        } catch {
          /* ignore */
        }
      }
      const json = parseMtop<{ data?: { skuSelectorBizModel?: SkuBizModel } }>(
        text,
      );
      return json?.data?.skuSelectorBizModel ?? null;
    },
  });
  const onResp = async (resp: PWResponse) => {
    // Probe: save every offerdetail.service response so we can see which
    // call carries productAttributes.
    if (
      process.env.BB1688_PROBE === '1' &&
      /mmga\.offerdetail\.service/i.test(resp.url())
    ) {
      try {
        const text = await resp.text();
        const fs = await import('node:fs/promises');
        DETAIL_SEQ++;
        const file = debugTmpPath(
          `1688-offerdetail-${String(DETAIL_SEQ).padStart(2, '0')}.json`,
        );
        await fs.writeFile(file, text);
        process.stderr.write(
          `[probe] saved offerdetail → ${file} (${text.length} bytes)\n`,
        );
      } catch {
        /* ignore */
      }
    }
  };
  page.on('response', onResp);

  if (process.env.BB1688_PROBE === '1') {
    const log = (line: string) => process.stderr.write(line + '\n');
    log('[probe] active (offer)');
    let mtopSeq = 0;
    let htmlSeq = 0;
    page.on('response', async (resp) => {
      const u = resp.url();
      const ct = resp.headers()['content-type'] ?? '';
      if (
        /\.(png|jpg|jpeg|gif|webp|css|woff2?|svg|ico|mp4|ttf|otf|js|map)(\?|$)/i.test(
          u,
        )
      )
        return;
      if (/mmstat\.com|google-analytics|alicdn\.com\/sufei/.test(u)) return;
      try {
        const path = new URL(u).pathname;
        // mtop OR any non-mtop XHR-style endpoint (wosc.*, *.json, etc.)
        const isApi =
          /mtop[.\/]|wosc\.|h5api|\/api\/|\/ajax\/|\.json/i.test(path) ||
          /json/i.test(ct);
        if (isApi) {
          let body = '';
          try {
            body = await resp.text();
          } catch {
            /* ignore */
          }
          const offerHits = (body.match(/"offerId|offerId":/g) ?? []).length;
          const titleHits = (body.match(/"subject"|"title"/g) ?? []).length;
          const priceHits = (body.match(/"price"|priceInfo|priceRange/g) ?? [])
            .length;
          log(
            `[api ] ${path.slice(0, 80)} ct=${ct.slice(0, 25)} bodyLen=${body.length} offerId×${offerHits} title×${titleHits} price×${priceHits}`,
          );
          if (body.length > 3000 && (offerHits > 0 || titleHits > 0)) {
            try {
              const fs = await import('node:fs/promises');
              const seq = (++mtopSeq).toString().padStart(2, '0');
              const tag = path.split('/').filter(Boolean).pop() ?? 'api';
              const file = debugTmpPath(`1688-offer-mtop-${seq}-${tag.slice(0, 40)}.json`);
              await fs.writeFile(file, body);
              log(`[api ] saved → ${file}`);
            } catch {
              /* ignore */
            }
          }
          return;
        }
        // HTML responses on detail.1688.com — likely SSR shell with inline data
        if (
          /detail\.1688\.com|detail\.m\.1688\.com/.test(u) &&
          /text\/html/i.test(ct)
        ) {
          const body = await resp.text();
          try {
            const fs = await import('node:fs/promises');
            const seq = (++htmlSeq).toString().padStart(2, '0');
            const file = debugTmpPath(`1688-offer-page-${seq}.html`);
            await fs.writeFile(file, body);
            // Probe for known inline-JSON variables.
            const markers = [
              'window.runParams',
              'window.detailData',
              'window.context',
              'window.offerDetail',
              'window.__INITIAL_DATA__',
              'window.__detail__',
              'window.__VITA_DATA__',
              'window.dataLayer',
              '"offerId":',
              '"subject":',
              '"sellerLoginId":',
            ];
            const hits = markers.filter((k) => body.includes(k));
            log(
              `[html] saved → ${file} (${body.length} bytes) markers=[${hits.join(', ')}]`,
            );
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    });
  }

  const url = `https://detail.1688.com/offer/${args.offerId}.html`;
  try {
    info(`Fetching offer ${args.offerId}...`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      throw new CliError(
        9,
        'NETWORK_ERROR',
        `Failed to load offer page: ${(e as Error).message}`,
      );
    }
    // Captcha/punish page — abort immediately, don't wait for timeout
    if (/\/punish|x5secdata=/.test(page.url())) {
      throw new CliError(104, 'CAPTCHA_INTERCEPT', 'Captcha page detected — skipping immediately');
    }
    if (/login\.1688\.com|login\.taobao\.com/.test(page.url())) {
      throw new CliError(
        3,
        'NOT_LOGGED_IN',
        'Session expired. Run `1688 login`.',
      );
    }

    const sku = await skuCapture.wait();
    const pageInfo = await readPageInfo(page);
    return assemble(args.offerId, url, sku, pageInfo);
  } finally {
    skuCapture.dispose();
    page.off('response', onResp);
    await page.close().catch(() => {});
  }
}

interface SkuBizModel {
  skuProps?: { prop?: string; value?: { name?: string; imageUrl?: string }[] }[];
  skuInfoMap?: Record<
    string,
    {
      skuId?: string;
      specAttrs?: string;
      price?: string;
      discountPrice?: string;
      multiPrice?: string;
      canBookCount?: string;
      saleCount?: string | number;
    }
  >;
  skuPriceScale?: string;
  skuSelectorModel?: {
    tradeModel?: {
      beginAmount?: number | string;
      saleCount?: number | string;
      unit?: string;
      mixModel?: { mixAmount?: number | string };
      offerPriceModel?: {
        currentPrices?: { beginAmount?: number | string; price?: number | string }[];
      };
    };
  };
  extraInfo?: {
    freightInfo?: {
      unitWeight?: number;
      receiveAddress?: string;
      sendAddressCode?: string;
      sellerUserId?: number | string;
    };
  };
}

interface PageInfo {
  title: string;
  supplierName: string | null;
  sellerLoginId: string | null;
  sellerMemberId: string | null;
  sellerUserId: string | null;
  saledCount: number | null;
  mainImage: string | null;
  images: string[];
  sendArea: string | null;
  province: string | null;
  city: string | null;
  categoryId: string | null;
  detailUrl: string | null;
  attributes: ProductAttribute[];
  packageInfo: SkuPackage[];
}

/**
 * Extract product info from the inline `window.context.result.data` JS
 * object that 1688 ships in the SSR HTML response. Bypasses fragile DOM
 * selectors by letting Playwright serialize the parsed JS object back to
 * Node over the wire.
 *
 * Falls back to DOM scraping if the inline data isn't available for some
 * reason (e.g. server rendered a fallback view).
 */
async function readPageInfo(page: Page): Promise<PageInfo> {
  const debug = process.env.BB1688_DEBUG === '1';
  if (debug) {
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[bb1688-probe]') || t.includes('[bb1688]'))
        process.stderr.write(t + '\n');
    });
  }

  try {
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          context?: {
            result?: { data?: { productTitle?: { fields?: object } } };
          };
        };
        return !!w.context?.result?.data?.productTitle?.fields;
      },
      { timeout: 8000 },
    );
  } catch {
    return scrapeDomFallback(page);
  }
  // Modest scroll to trigger lazy modules near the SKU + 参数 section.
  // Avoid scrolling to bottom — 1688 detail pages infinite-scroll related
  // products there, which can hang the renderer.
  try {
    await page.evaluate(() => window.scrollTo(0, 1500));
    await sleep(1000);
    await page.evaluate(() => window.scrollTo(0, 3000));
    await sleep(1000);
  } catch {
    /* best-effort */
  }

  const fromContext = await page
    .evaluate((debugMode: boolean) => {
      type ImageEntry =
        | string
        | {
            fullPathImageURI?: string;
            imageURI?: string;
            size310x310ImageURI?: string;
          };
      type TempModel = {
        companyName?: string;
        sellerLoginId?: string;
        sellerMemberId?: string;
        sellerUserId?: number | string;
        saledCount?: number | string;
        postCategoryId?: number | string;
        topCategoryId?: number | string;
      };
      type OfferData = {
        subject?: string;
        images?: ImageEntry[];
        freightInfo?: {
          sendAddress?: string;
          sendCityText?: string;
          sendProvinceText?: string;
          sendArea?: string;
        };
        tempModel?: TempModel;
      };
      const w = window as unknown as {
        context?: { result?: { data?: OfferData } };
        FE_GLOBALS?: {
          offerLoginId?: string;
          loginId?: string;
          memberId?: string;
        };
      };
      const d = w.context?.result?.data as Record<string, unknown> | undefined;
      if (!d) return null;
      const feg = w.FE_GLOBALS ?? {};

      // description module — has detailUrl + leafCategoryId.
      const descFields = (d.description as {
        fields?: {
          detailUrl?: string;
          leafCategoryId?: number | string;
          detailVideoId?: string;
        };
      })?.fields ?? {};

      // Product attributes live in a deeply-nested branch (1688 typically
      // serializes them under `globalData.model.offerDetail.featureAttributes`,
      // but the wrapping path varies). Walk the entire window.context tree
      // (bounded depth) looking for the canonical featureAttributes array.
      const attributes: { name: string; value: string }[] = [];
      const root = (w.context ?? d) as Record<string, unknown>;
      const stack: { v: unknown; depth: number }[] = [{ v: root, depth: 0 }];
      while (stack.length && attributes.length === 0) {
        const { v, depth } = stack.shift()!;
        if (depth > 12) continue;
        if (!v || typeof v !== 'object') continue;
        if (Array.isArray(v)) {
          // Detect attribute-list array shape.
          if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
            const first = v[0] as Record<string, unknown>;
            if (
              typeof first.name === 'string' &&
              ('value' in first || 'values' in first)
            ) {
              for (const item of v) {
                if (!item || typeof item !== 'object') continue;
                const it = item as Record<string, unknown>;
                const name =
                  typeof it.name === 'string' ? it.name.trim() : '';
                let value = '';
                if (typeof it.value === 'string') value = it.value;
                else if (Array.isArray(it.values))
                  value = (it.values as unknown[])
                    .filter((x) => typeof x === 'string')
                    .join(',');
                if (name && value) attributes.push({ name, value });
              }
            }
          }
          for (const item of v) stack.push({ v: item, depth: depth + 1 });
        } else {
          // Prioritize keys that hint at attribute containers.
          const obj = v as Record<string, unknown>;
          // Direct hit
          const direct =
            obj.featureAttributes ?? obj.productAttributes ?? obj.attributes;
          if (Array.isArray(direct))
            stack.unshift({ v: direct, depth: depth + 1 });
          for (const k of Object.keys(obj))
            stack.push({ v: obj[k], depth: depth + 1 });
        }
      }

      // Package info — per-SKU dimensions/weight (件重尺).
      const packRaw = (
        d.productPackInfo as {
          fields?: { pieceWeightScale?: { pieceWeightScaleInfo?: unknown[] } };
        }
      )?.fields?.pieceWeightScale?.pieceWeightScaleInfo;
      const packageInfo: {
        skuId: string;
        spec: string;
        length: number | null;
        width: number | null;
        height: number | null;
        weight: number | null;
        volume: number | null;
      }[] = [];
      if (Array.isArray(packRaw)) {
        for (const p of packRaw) {
          if (!p || typeof p !== 'object') continue;
          const o = p as {
            skuId?: number | string;
            sku1?: string;
            length?: number;
            width?: number;
            height?: number;
            weight?: number;
            volume?: number;
          };
          packageInfo.push({
            skuId: o.skuId != null ? String(o.skuId) : '',
            spec: o.sku1 ?? '',
            length: o.length ?? null,
            width: o.width ?? null,
            height: o.height ?? null,
            weight: o.weight ?? null,
            volume: o.volume ?? null,
          });
        }
      }

      // Page is organized by widget modules; real data lives in `<mod>.fields`.
      const productTitle = (d.productTitle as {
        fields?: {
          title?: string;
          shopInfo?: {
            companyName?: string;
            authCompanyName?: string;
            sellerSlrServiceScore?: string;
          };
          newSaleCount?: string;
          unit?: string;
        };
      })?.fields ?? {};
      const gallery = (d.gallery as {
        fields?: {
          mainImage?: unknown;
          offerId?: number | string;
          subject?: string;
          video?: { coverUrl?: string; videoId?: string };
        };
      })?.fields ?? {};
      const shop = productTitle.shopInfo ?? {};

      const imgs: string[] = [];
      const rawImgs = gallery.mainImage;
      if (Array.isArray(rawImgs)) {
        for (const img of rawImgs) {
          if (typeof img === 'string') imgs.push(img);
          else if (img && typeof img === 'object') {
            const o = img as {
              fullPathImageURI?: string;
              size310x310ImageURI?: string;
              imageURI?: string;
            };
            const url =
              o.fullPathImageURI ?? o.size310x310ImageURI ?? o.imageURI ?? '';
            if (url) {
              imgs.push(
                url.startsWith('http') ? url : `https://cbu01.alicdn.com/${url}`,
              );
            }
          }
        }
      }
      const catId =
        descFields.leafCategoryId != null
          ? String(descFields.leafCategoryId)
          : null;
      return {
        detailUrl: descFields.detailUrl ?? null,
        attributes,
        packageInfo,
        title: productTitle.title ?? gallery.subject ?? '',
        supplierName:
          shop.companyName ?? shop.authCompanyName ?? null,
        sellerLoginId: feg.offerLoginId ?? feg.loginId ?? null,
        sellerMemberId: feg.memberId ?? null,
        sellerUserId: null,
        saledCount: null,
        mainImage: imgs[0] ?? null,
        images: imgs,
        sendArea: null,
        province: null,
        city: null,
        categoryId: catId,
      };
    }, debug)
    .catch(() => null);

  if (!fromContext) return scrapeDomFallback(page);

  // Title from <title> as backup when subject empty.
  let title = fromContext.title;
  if (!title) {
    const raw = await page.title();
    title = raw.replace(/\s*-\s*阿里巴巴\s*$/, '').trim();
  }
  return { ...fromContext, title };
}

async function scrapeDomFallback(page: Page): Promise<PageInfo> {
  const raw = await page.title();
  const title = raw.replace(/\s*-\s*阿里巴巴\s*$/, '').trim();
  const info = await page.evaluate(() => {
    function txt(sel: string): string | null {
      const e = document.querySelector(sel);
      return e?.textContent?.trim() ?? null;
    }
    function imgSrc(sel: string): string | null {
      const e = document.querySelector(sel) as HTMLImageElement | null;
      return e?.src ?? e?.getAttribute('data-src') ?? null;
    }
    return {
      supplierName: txt('h1') ?? null,
      mainImage:
        imgSrc('.v-image-wrap img') ??
        imgSrc('.ant-image-img') ??
        imgSrc('img[alt*="主图"]'),
    };
  });
  return {
    title,
    supplierName: info.supplierName,
    sellerLoginId: null,
    sellerMemberId: null,
    sellerUserId: null,
    saledCount: null,
    mainImage: info.mainImage,
    images: info.mainImage ? [info.mainImage] : [],
    sendArea: null,
    province: null,
    city: null,
    categoryId: null,
    detailUrl: null,
    attributes: [],
    packageInfo: [],
  };
}

function assemble(
  offerId: string,
  url: string,
  sku: SkuBizModel | null,
  info: PageInfo,
): OfferResult {
  const priceRange = sku?.skuPriceScale ?? null;
  const { min: priceMin, max: priceMax } = parseRange(priceRange);

  const options: SkuOption[] = (sku?.skuProps ?? []).map((p) => ({
    prop: p.prop ?? '',
    values: (p.value ?? []).map((v) => ({
      name: v.name ?? '',
      imageUrl: v.imageUrl ?? null,
    })),
  }));

  // Build a map: option value name → image (e.g. "22管径长方头" → cbu URL).
  // Used to derive a per-SKU image since the SKU itself doesn't carry one.
  const valueImage = new Map<string, string>();
  for (const opt of options) {
    for (const v of opt.values) {
      if (v.imageUrl) valueImage.set(v.name, v.imageUrl);
    }
  }
  // SKU specs is HTML-encoded ("&gt;" = ">"). Split by either, take first part.
  // Falls back to the offer's main image when the seller didn't upload
  // per-spec thumbnails — keeps every SKU with a usable preview URL.
  const fallbackSkuImage =
    info.mainImage ?? options[0]?.values[0]?.imageUrl ?? null;
  function deriveSkuImage(spec: string): string | null {
    const firstPart = spec.split(/&gt;|>/)[0]?.trim() ?? '';
    return valueImage.get(firstPart) ?? fallbackSkuImage;
  }

  const skus: SkuVariant[] = Object.entries(sku?.skuInfoMap ?? {}).map(
    ([k, v]) => {
      const specs = v.specAttrs ?? k;
      return {
        skuId: v.skuId ?? '',
        specs,
        price: parseFloatOrNull(v.discountPrice ?? v.price),
        multiPrice: parseFloatOrNull(v.multiPrice),
        stock: parseIntOrNull(v.canBookCount),
        saleCount:
          typeof v.saleCount === 'number'
            ? v.saleCount
            : parseIntOrNull(v.saleCount) ?? 0,
        image: deriveSkuImage(specs),
      };
    },
  );

  const freight = {
    receiveAddress: sku?.extraInfo?.freightInfo?.receiveAddress ?? null,
    sendArea: info.sendArea,
    province: info.province,
    city: info.city,
    unitWeight: sku?.extraInfo?.freightInfo?.unitWeight ?? null,
  };

  const fallbackImage =
    info.mainImage ?? options[0]?.values[0]?.imageUrl ?? null;

  const trade = sku?.skuSelectorModel?.tradeModel;
  const priceTiers: PriceTier[] = (trade?.offerPriceModel?.currentPrices ?? [])
    .map((t) => ({
      minQty: parseIntOrNull(String(t.beginAmount ?? '')) ?? 0,
      price: parseFloatOrNull(String(t.price ?? '')) ?? 0,
    }))
    .filter((t) => t.minQty > 0 && t.price > 0);
  const tradeSaleCount =
    typeof trade?.saleCount === 'number'
      ? trade.saleCount
      : parseIntOrNull(trade?.saleCount as string | undefined);

  return {
    offerId,
    title: info.title,
    url,
    priceRange,
    priceMin,
    priceMax,
    unitName: trade?.unit ?? null,
    minOrderQty: parseIntOrNull(String(trade?.beginAmount ?? '')),
    mixOrderQty: parseIntOrNull(String(trade?.mixModel?.mixAmount ?? '')),
    priceTiers,
    detailUrl: info.detailUrl,
    attributes: info.attributes,
    packageInfo: info.packageInfo,
    supplier: {
      name: info.supplierName,
      loginId: info.sellerLoginId,
      memberId: info.sellerMemberId,
      // sellerUserId is exposed via SKU mtop freightInfo; window.context omits it.
      userId:
        info.sellerUserId ??
        (sku?.extraInfo?.freightInfo?.sellerUserId != null
          ? String(sku.extraInfo.freightInfo.sellerUserId)
          : null),
    },
    freight,
    saledCount:
      tradeSaleCount ??
      info.saledCount ??
      (skus.length > 0
        ? skus.reduce((s, x) => s + (x.saleCount || 0), 0)
        : null),
    categoryId: info.categoryId,
    options,
    skus,
    mainImage: fallbackImage,
    images: info.images,
  };
}

function parseRange(s: string | null): { min: number | null; max: number | null } {
  if (!s) return { min: null, max: null };
  const matches = Array.from(s.matchAll(/([\d.]+)/g)).map((m) => parseFloat(m[1]!));
  if (matches.length === 0) return { min: null, max: null };
  return {
    min: matches[0] ?? null,
    max: matches.length > 1 ? matches[1]! : matches[0]!,
  };
}

function parseFloatOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export async function run(opts: OfferOpts): Promise<void> {
  // Normalise: single offerId or batch offerIds.
  const ids = opts.offerIds?.length
    ? opts.offerIds
    : opts.offerId
      ? [opts.offerId]
      : [];

  info(`[offer] received ids=${ids instanceof Array ? ids.length : String(ids).length}, pro=${opts.pro === true}, headed=${opts.headed === true}, profile=${opts.profile || 'default'}`);

  if (ids.length === 0) {
    throw new CliError(2, 'BAD_INPUT', 'offerId required.');
  }

  // Single ID — original behaviour, original JSON shape.
  if (ids.length === 1) {
    const data = await dispatch<OfferArgs, OfferResult>(
      'offer',
      { offerId: ids[0]!, headed: opts.headed },
      { headed: opts.headed, profile: opts.profile, noDaemon: opts.pro === true },
    );
    emit({
      human: () => printOffer(data),
      data,
    });
    return;
  }

  // Batch mode — multiple IDs, serial collection, partial results.
  // For --pro + --headed, keep one visible browser/session open for the whole batch.
  // This avoids opening and closing the browser for every single offer.
  if (opts.pro === true && opts.headed === true) {
    info(`[offer] entering headed pro batch path, ids=${ids instanceof Array ? ids.length : String(ids).length}`);
    const result = await runOfferBatchInOneSession(ids, opts);
    emit({
      human: () => printBatch(result),
      data: result,
    });
    return;
  }

  // Non-headed / daemon-friendly batch mode keeps the existing dispatch path.
  const offers: OfferResult[] = [];
  const failures: OfferFailure[] = [];

  for (let i = 0; i < ids.length; i++) {
    const offerId = ids[i]!;
    if (!/^\d+$/.test(offerId)) {
      failures.push({ offerId, code: 'BAD_INPUT', message: 'Invalid offerId' });
      continue;
    }

    process.stderr.write(`[${i + 1}/${ids.length}] collecting offerId ${offerId}\n`);

    try {
      const data = await dispatch<OfferArgs, OfferResult>(
        'offer',
        { offerId, headed: opts.headed },
        { headed: opts.headed, profile: opts.profile, noDaemon: opts.pro === true },
      );
      offers.push(data);
    } catch (error) {
      const err = error as Error & { code?: string };
      const message = sanitiseFailMessage(err.message || String(error));
      failures.push({
        offerId,
        code: err.code || 'DEEP_COLLECT_FAILED',
        message,
      });
    }
  }

  const result: OfferBatchResult = {
    mode: 'batch',
    total: ids.length,
    success: offers.length,
    failed: failures.length,
    offerIds: ids,
    offers,
    failures,
  };

  emit({
    human: () => printBatch(result),
    data: result,
  });
}

function printOffer(o: OfferResult): void {
  process.stdout.write(`${o.title}\n`);
  process.stdout.write(`  offerId:  ${o.offerId}\n`);
  if (o.priceRange) {
    process.stdout.write(`  price:    ${o.priceRange}\n`);
  } else if (o.priceMin !== null) {
    const range =
      o.priceMax !== null && o.priceMax !== o.priceMin
        ? `¥${o.priceMin.toFixed(2)} - ¥${o.priceMax.toFixed(2)}`
        : `¥${o.priceMin.toFixed(2)}`;
    process.stdout.write(`  price:    ${range}\n`);
  }
  if (o.supplier.name) {
    process.stdout.write(`  supplier: ${o.supplier.name}\n`);
  }
  if (o.freight.receiveAddress) {
    process.stdout.write(
      `  freight:  to ${o.freight.receiveAddress}` +
        (o.freight.unitWeight ? `, ${o.freight.unitWeight}kg/unit` : '') +
        '\n',
    );
  }
  process.stdout.write(`  url:      ${o.url}\n`);
  if (o.options.length) {
    process.stdout.write(`\nOptions (${o.options.length}):\n`);
    for (const opt of o.options) {
      process.stdout.write(
        `  ${opt.prop}: ${opt.values.map((v) => v.name).slice(0, 5).join(' | ')}`,
      );
      if (opt.values.length > 5)
        process.stdout.write(` ... (+${opt.values.length - 5})`);
      process.stdout.write('\n');
    }
  }
  if (o.skus.length) {
    const sample = o.skus.slice(0, 5);
    process.stdout.write(`\nSKUs (${o.skus.length} total, showing ${sample.length}):\n`);
    for (const s of sample) {
      const price = s.price !== null ? `¥${s.price.toFixed(2)}` : '?';
      const stock = s.stock !== null ? `${s.stock} in stock` : '';
      process.stdout.write(`  ${price.padEnd(10)} ${stock.padEnd(15)} ${s.specs}\n`);
    }
  }
}

function printBatch(result: OfferBatchResult): void {
  process.stdout.write(
    `Batch offer results: ${result.success}/${result.total} ok` +
      (result.failed ? `, ${result.failed} failed` : '') +
      '\n\n',
  );
  for (const o of result.offers) {
    process.stdout.write(
      `${o.offerId} | ${(o.title || '').slice(0, 80)}\n` +
        `  SKUs: ${o.skus.length} | packages: ${o.packageInfo.length}` +
        (o.priceRange ? ` | price: ${o.priceRange}` : '') +
        '\n\n',
    );
  }
  if (result.failures.length > 0) {
    process.stdout.write('Failures:\n');
    for (const f of result.failures) {
      process.stdout.write(`  ${f.offerId}  ${f.code}  ${f.message}\n`);
    }
  }
}

/** Strip long risk-control URLs from error messages. */
function sanitiseFailMessage(message: string): string {
  if (/x5secdata|punish|captcha|verify|nocaptcha/i.test(message)) {
    return '1688 触发滑块验证，请使用 --headed 手动处理。';
  }
  return message;
}

async function pauseDaemonForInlineBatch(profile?: string): Promise<{ resume: () => Promise<void> }> {
  try {
    const { status, stop, start } = await import('../daemon/manager.js');
    const st = await status(profile);
    if (!st.running) return { resume: async () => {} };

    info(`Pausing daemon for profile "${profile || 'default'}" for headed batch run...`);
    await stop(profile);

    return {
      resume: async () => {
        try {
          info(`Resuming daemon for profile "${profile || 'default'}"...`);
          await start(profile);
        } catch (e) {
          info(`(Daemon resume failed for profile "${profile || 'default'}": ${(e as Error).message})`);
        }
      },
    };
  } catch {
    return { resume: async () => {} };
  }
}

async function runOfferBatchInOneSession(ids: string[], opts: OfferOpts): Promise<OfferBatchResult> {
  info(`[offer-batch] one headed session start: ${ids.length} offer(s): ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `... (+${ids.length - 5})` : ''}`);
  const offers: OfferResult[] = [];
  const failures: OfferFailure[] = [];
  const profile = opts.profile;

  const daemonMgr = await pauseDaemonForInlineBatch(profile);

  try {
    await withSession(
      { headless: opts.headed !== true, profile },
      async (ctx) => {
        for (let i = 0; i < ids.length; i++) {
          const offerId = ids[i]!;
          if (!/^\d+$/.test(offerId)) {
            failures.push({ offerId, code: 'BAD_INPUT', message: 'Invalid offerId' });
            continue;
          }

          process.stderr.write(`[${i + 1}/${ids.length}] collecting offerId ${offerId}\n`);

          try {
            const data = await execute(ctx, { offerId, headed: opts.headed });
            offers.push(data);
          } catch (error) {
            const err = error as Error & { code?: string };
            const message = sanitiseFailMessage(err.message || String(error));
            failures.push({
              offerId,
              code: err.code || 'DEEP_COLLECT_FAILED',
              message,
            });
          }

          if (i < ids.length - 1) {
            await sleep(500);
          }
        }
      },
      {
        requestId: `offer-batch-${Date.now()}`,
        cmd: 'offer-batch',
        args: { offerIds: ids, headed: opts.headed, profile },
      },
    );
  } finally {
    await daemonMgr.resume();
  }

  return {
    mode: 'batch',
    total: ids.length,
    success: offers.length,
    failed: failures.length,
    offerIds: ids,
    offers,
    failures,
  };
}
