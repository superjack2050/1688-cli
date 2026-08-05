import type { ProgressOfferCardItem } from '../components/Results/ProgressOfferCard';

type Row = Record<string, unknown>;

export function progressCardToOzonRows(item: ProgressOfferCardItem): Row[] {
  const raw = objectOf(item.raw);
  const baseTitle = text(raw.title) || item.title || '';
  const offerId = text(raw.offerId) || item.offerId || '';
  const detailUrl = text(raw.url) || text(raw.detailUrl) || `https://detail.1688.com/offer/${offerId}.html`;
  const images = imageList(raw, item.image);
  const attributes = attributesObject(raw.attributes);
  const packages = packageMap(raw.packageInfo);
  let skus = Array.isArray(raw.skus) ? raw.skus.map(objectOf).filter(Boolean) : [];
  // Filter to only selected SKUs (set by SkuSelectModal, never mutates raw data)
  if (item._selectedSkuIds && item._selectedSkuIds.size > 0) {
    skus = skus.filter((s) => item._selectedSkuIds!.has(String(s.skuId ?? '')));
  }

  if (skus.length === 0) {
    return [baseRow({
      raw,
      offerId,
      detailUrl,
      title: baseTitle,
      skuName: baseTitle,
      price: item.price || priceText(raw),
      stock: '',
      image: item.image || images[0] || '',
      images,
      attributes,
      pack: {},
    })];
  }

  return skus.map((sku, index) => {
    const skuId = text(sku.skuId);
    const pack = (skuId && packages.get(skuId)) || {};
    return baseRow({
      raw,
      offerId,
      skuId,
      detailUrl,
      title: baseTitle,
      skuName: text(sku.specs) || `${baseTitle} SKU ${index + 1}`,
      price: text(sku.price) || text(sku.multiPrice) || item.price || priceText(raw),
      stock: text(sku.stock),
      image: text(sku.image) || item.image || images[0] || '',
      images,
      attributes,
      pack,
    });
  });
}

function baseRow(input: {
  raw: Row;
  offerId: string;
  skuId?: string;
  detailUrl: string;
  title: string;
  skuName: string;
  price: string;
  stock: string;
  image: string;
  images: string[];
  attributes: Record<string, string>;
  pack: Row;
}): Row {
  const row: Row = {
    status: 'ok',
    offer_id: input.offerId,
    source_offer_id: input.offerId,
    sku_id: input.skuId || '',
    sku_specs_text: input.skuName,
    detail_url: input.detailUrl,
    product_title: input.title,
    sku_name: input.skuName,
    sku_price: numericText(input.price),
    stock: input.stock,
    sku_image_url: input.image,
    main_image_url: input.images[0] || input.image,
    default_main_image_url: input.images[0] || input.image,
    gallery_image_urls: input.images,
    gallery_non_video_image_urls: input.images,
    additional_image_urls: input.images.slice(1),
    sku_image_candidates: input.image ? [input.image] : [],
    product_attributes_structured: input.attributes,
    source_category_path: text(input.raw.categoryPath),
    source_category_items: [text(input.raw.categoryId)].filter(Boolean),
    length_cm: text(input.pack.length),
    width_cm: text(input.pack.width),
    height_cm: text(input.pack.height),
    weight_g: normalizeWeight(input.pack.weight ?? objectOf(input.raw.freight).unitWeight),
    raw_1688: input.raw,
  };
  row.status = 'ok';
  return row;
}

function objectOf(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numericText(value: unknown): string {
  const match = text(value).match(/\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

function imageList(raw: Row, fallback?: string): string[] {
  const values: string[] = [];
  pushImage(values, fallback);
  pushImage(values, raw.mainImage);
  pushImage(values, raw.image);
  if (Array.isArray(raw.images)) raw.images.forEach((item) => pushImage(values, item));
  return values.slice(0, 15);
}

function pushImage(values: string[], value: unknown) {
  let url = text(value);
  if (!url) return;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^https?:\/\//.test(url) && !values.includes(url)) values.push(url);
}

function attributesObject(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(value)) return result;
  value.map(objectOf).forEach((item) => {
    const name = text(item.name);
    const val = text(item.value);
    if (name && val) result[name] = val;
  });
  return result;
}

function packageMap(value: unknown): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!Array.isArray(value)) return map;
  value.map(objectOf).forEach((item) => {
    const skuId = text(item.skuId);
    if (skuId) map.set(skuId, item);
  });
  return map;
}

function normalizeWeight(value: unknown): string {
  const number = Number(numericText(value));
  if (!Number.isFinite(number) || number <= 0) return '';
  return number > 0 && number < 20 ? String(Math.round(number * 1000)) : String(Math.round(number));
}

function priceText(raw: Row): string {
  return text(raw.priceRange) || text(raw.priceText) || text(raw.priceMin);
}
