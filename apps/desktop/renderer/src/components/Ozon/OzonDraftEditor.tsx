import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getApi,
  type OzonAttributeValue,
  type OzonCategoryAttribute,
  type OzonCategoryEntry,
  type OzonCategoryRawNode,
  type OzonDraft,
} from '../../services/api';
import type { OzonListingTask, OzonListingTaskPatch, OzonListingTaskStatus } from '../Results/ozonListing/types';
import { formatMissingFields, unique } from '../Results/ozonListing/precheck';
import OzonEditorNav, { type EditorSectionId } from './OzonEditorNav';
import OzonEditorBottomBar, { type ValidationState } from './OzonEditorBottomBar';
import OzonCategoryDrawer from './OzonCategoryDrawer';

const ATTR_BRAND = 85;
const ATTR_MODEL = 9048;
const ATTR_DESCRIPTION = 4191;
const ATTR_TAGS = 23171;
const ATTR_WEIGHT = 4497;
const ATTR_RICH_CONTENT = 11254;
const CONTROLLED_ATTR_IDS = new Set([ATTR_BRAND, ATTR_MODEL, ATTR_DESCRIPTION, ATTR_TAGS, ATTR_WEIGHT, ATTR_RICH_CONTENT]);

type DraftForm = {
  name: string;
  offerId: string;
  barcode: string;
  price: string;
  oldPrice: string;
  currencyCode: string;
  descriptionCategoryId: string;
  typeId: string;
  categoryPath: string;
  brand: string;
  model: string;
  description: string;
  tags: string;
  images: string;
  dimensionUnit: string;
  depth: string;
  width: string;
  height: string;
  weightUnit: string;
  weight: string;
  customAttributes: string;
};

type DraftBuildResult = {
  draft: OzonDraft;
  firstItem: Record<string, unknown>;
  missing: string[];
};

type DictionaryValueIds = Record<string, Record<string, number>>;

type VariantRowView = {
  key: string;
  skuName: string;
  images: string[];
  offerId: string;
  price: string;
  stock: string;
  values: Record<string, unknown>;
};

type Props = {
  task: OzonListingTask;
  onTaskUpdate?: (key: string, patch: OzonListingTaskPatch) => void;
  onBackTo1688: () => void;
  onToast?: (message: string) => void;
};

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? String(number) : text(value);
}

function positiveInteger(value: string): number {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : 0;
}

function priceForPayload(value: string, fallback = '1'): string {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return fallback;
  return String(Math.max(number, fallback === '0' ? 0 : 1));
}

function intForPayload(value: string): number {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function lengthToMillimeter(value: unknown, sourceUnit: string): string {
  const number = Number(numberText(value));
  if (!Number.isFinite(number) || number <= 0) return '';
  return sourceUnit === 'cm' ? String(Math.round(number * 10)) : String(Math.round(number));
}

function attributeValue(item: Record<string, unknown>, attrId: number): string {
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  for (const rawAttr of attrs) {
    const attr = objectOf(rawAttr);
    if (Number(attr.id) !== attrId) continue;
    const values = Array.isArray(attr.values) ? attr.values : [];
    return values
      .map((value) => text(objectOf(value).value || objectOf(value).dictionary_value_id || value))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function attributeValuesById(item: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {};
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  for (const rawAttr of attrs) {
    const attr = objectOf(rawAttr);
    const attrId = Number(attr.id);
    if (!attrId) continue;
    const attrValues = Array.isArray(attr.values) ? attr.values : [];
    const lines = attrValues
      .map((value) => text(objectOf(value).value || objectOf(value).dictionary_value_id || value))
      .filter(Boolean);
    if (lines.length) values[String(attrId)] = lines.join('\n');
  }
  return values;
}

function attributeDictionaryIdsById(item: Record<string, unknown>): DictionaryValueIds {
  const values: DictionaryValueIds = {};
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  for (const rawAttr of attrs) {
    const attr = objectOf(rawAttr);
    const attrId = Number(attr.id);
    if (!attrId) continue;
    const attrValues = Array.isArray(attr.values) ? attr.values : [];
    for (const rawValue of attrValues) {
      const value = objectOf(rawValue);
      const label = text(value.value);
      const dictionaryValueId = Number(value.dictionary_value_id || 0);
      if (!label || dictionaryValueId <= 0) continue;
      values[String(attrId)] = { ...(values[String(attrId)] || {}), [label]: dictionaryValueId };
    }
  }
  return values;
}

function lineList(value: string): string[] {
  return unique(
    String(value || '')
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function normalizeImageUrl(value: string): string {
  const url = value.trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function imageLinesFromItem(item: Record<string, unknown>, task: OzonListingTask): string {
  const values = Array.isArray(item.images) ? item.images : [];
  const urls = values.map((value) => normalizeImageUrl(text(value))).filter(Boolean);
  const primary = normalizeImageUrl(text(item.primary_image || task.image));
  if (primary && !urls.includes(primary)) urls.unshift(primary);
  return urls.slice(0, 15).join('\n');
}

function removeCjk(value: string): string {
  return value.replace(/[㐀-鿿]+/g, '').trim();
}

function formatTagsForUi(value: string): string {
  return unique(
    String(value || '')
      .replace(/,/g, '\n')
      .split(/\r?\n/)
      .map((line) => removeCjk(line.trim().replace(/^#|^＃/, '').trim()))
      .filter(Boolean)
      .map((line) => `#${line}`),
  ).join('\n');
}

function normalizeTagsForPayload(value: string): string {
  return unique(
    String(value || '')
      .replace(/,/g, '\n')
      .split(/\r?\n/)
      .map((line) => removeCjk(line.trim().replace(/^#|^＃/, '').trim()))
      .filter(Boolean),
  ).join('\n');
}

function buildAttribute(attrId: number, value: string, dictionaryIds?: Record<string, number>): Record<string, unknown> | null {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return {
    id: attrId,
    complex_id: 0,
    values: lines.map((line) => {
      const dictionaryValueId = Number(dictionaryIds?.[line] || 0);
      return dictionaryValueId > 0
        ? { dictionary_value_id: dictionaryValueId, value: line }
        : { value: line };
    }),
  };
}

function parseCustomAttributes(value: string): Record<string, unknown>[] {
  const attrs: Record<string, unknown>[] = [];
  const seen = new Set<number>();

  for (const line of String(value || '').split(/\r?\n/)) {
    if (!line.includes('=')) continue;
    const [rawId, ...valueParts] = line.split('=');
    const attrId = Number(rawId.trim());
    if (!Number.isFinite(attrId) || attrId <= 0 || seen.has(attrId)) continue;
    const attr = buildAttribute(Math.round(attrId), valueParts.join('=').trim());
    if (!attr) continue;
    attrs.push(attr);
    seen.add(Math.round(attrId));
  }

  return attrs;
}

function buildDynamicAttributes(
  dynamicValues: Record<string, string>,
  categoryAttributes: OzonCategoryAttribute[],
  dictionaryValueIds: DictionaryValueIds,
): Record<string, unknown>[] {
  const attrs: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  const knownIds = new Set(categoryAttributes.map((attr) => attr.id));

  for (const [rawId, value] of Object.entries(dynamicValues)) {
    const attrId = Number(rawId);
    if (!attrId || CONTROLLED_ATTR_IDS.has(attrId) || seen.has(attrId)) continue;
    if (knownIds.size > 0 && !knownIds.has(attrId)) continue;
    const attr = buildAttribute(attrId, value, dictionaryValueIds[String(attrId)]);
    if (!attr) continue;
    attrs.push(attr);
    seen.add(attrId);
  }

  return attrs;
}

function buildAttributes(
  baseItem: Record<string, unknown>,
  form: DraftForm,
  dynamicValues: Record<string, string>,
  categoryAttributes: OzonCategoryAttribute[],
  dictionaryValueIds: DictionaryValueIds,
): Record<string, unknown>[] {
  const customAttrs = parseCustomAttributes(form.customAttributes);
  const dynamicAttrs = buildDynamicAttributes(dynamicValues, categoryAttributes, dictionaryValueIds);
  const customIds = new Set(customAttrs.map((attr) => Number(attr.id)).filter(Boolean));
  const dynamicIds = new Set(dynamicAttrs.map((attr) => Number(attr.id)).filter(Boolean));
  const baseAttrs = Array.isArray(baseItem.attributes) ? baseItem.attributes : [];
  const preserved = baseAttrs
    .map(objectOf)
    .filter((attr) => {
      const attrId = Number(attr.id);
      return attrId > 0 && !CONTROLLED_ATTR_IDS.has(attrId) && !customIds.has(attrId) && !dynamicIds.has(attrId);
    });

  const controlled = [
    buildAttribute(ATTR_BRAND, form.brand, dictionaryValueIds[String(ATTR_BRAND)]),
    buildAttribute(ATTR_MODEL, form.model),
    buildAttribute(ATTR_WEIGHT, String(positiveInteger(form.weight))),
    buildAttribute(ATTR_DESCRIPTION, form.description),
    buildAttribute(ATTR_TAGS, normalizeTagsForPayload(form.tags)),
  ].filter(Boolean) as Record<string, unknown>[];

  return [...preserved, ...controlled, ...dynamicAttrs, ...customAttrs];
}

function firstItemOf(task: OzonListingTask): Record<string, unknown> {
  return objectOf(task.draft?.items?.[0]);
}

function firstRowOf(task: OzonListingTask): Record<string, unknown> {
  return objectOf(task.draft?.sourceRows?.[0]);
}

function createDraftForm(task: OzonListingTask): DraftForm {
  const item = firstItemOf(task);
  const row = firstRowOf(task);
  const generated = objectOf(task.draft?.generated);
  const matchedCategory = objectOf(generated.matched_category);
  const tagsFromGenerated = Array.isArray(generated.tags) ? generated.tags.map(text).filter(Boolean).join('\n') : '';
  const description = attributeValue(item, ATTR_DESCRIPTION) || text(generated.description_ru);
  const model = attributeValue(item, ATTR_MODEL) || text(generated.model_name);
  const tags = attributeValue(item, ATTR_TAGS) || tagsFromGenerated;
  const sourceUnit = text(item.dimension_unit) || 'cm';

  return {
    name: text(item.name) || text(generated.title_ru) || text(row.product_title) || task.title || '',
    offerId: text(item.offer_id) || task.offerId || text(row.offer_id),
    barcode: text(item.barcode),
    price: numberText(item.price || task.price || row.sku_price),
    oldPrice: numberText(item.old_price || '0'),
    currencyCode: text(item.currency_code) || 'CNY',
    descriptionCategoryId: numberText(item.description_category_id || matchedCategory.description_category_id),
    typeId: numberText(item.type_id || matchedCategory.type_id),
    categoryPath: text(item._category_path) || text(matchedCategory.path),
    brand: attributeValue(item, ATTR_BRAND) || 'NO NAME',
    model,
    description,
    tags: formatTagsForUi(tags),
    images: imageLinesFromItem(item, task),
    dimensionUnit: 'mm',
    depth: lengthToMillimeter(item.depth, sourceUnit),
    width: lengthToMillimeter(item.width, sourceUnit),
    height: lengthToMillimeter(item.height, sourceUnit),
    weightUnit: text(item.weight_unit) || 'g',
    weight: numberText(item.weight),
    customAttributes: '',
  };
}

function collectProductPageMissing(form: DraftForm): string[] {
  const missing: string[] = [];
  if (!form.categoryPath.trim() || !intForPayload(form.descriptionCategoryId) || !intForPayload(form.typeId)) missing.push('类目和类型');
  if (!form.offerId.trim()) missing.push('货号');
  if (Number(priceForPayload(form.price, '0')) <= 0) missing.push('价格');
  if (!positiveInteger(form.depth)) missing.push('包装长度');
  if (!positiveInteger(form.width)) missing.push('包装宽度');
  if (!positiveInteger(form.height)) missing.push('包装高度');
  if (!positiveInteger(form.weight)) missing.push('含包装重量');
  return missing;
}

function isMediaAttributeName(attr: OzonCategoryAttribute): boolean {
  const name = `${attr.name} ${attr.description} ${attr.groupName}`.toLowerCase();
  return /video|rich|pdf|json|image|picture|видео|медиа|изображ|фото|富内容|视频|图片|封面|pdf/i.test(name);
}

function collectAttributeMissing(
  form: DraftForm,
  dynamicValues: Record<string, string>,
  attrs: OzonCategoryAttribute[],
): string[] {
  const missing: string[] = [];
  if (!form.model.trim()) missing.push('型号名称');
  for (const attr of attrs) {
    if (!attr.isRequired) continue;
    if (!text(dynamicValues[String(attr.id)])) missing.push(attr.name || `属性 ${attr.id}`);
  }
  return unique(missing);
}

function collectPayloadMissing(
  draft: OzonDraft,
  items: Record<string, unknown>[],
  attributeMissing: string[],
): string[] {
  const missing = new Set<string>(attributeMissing);
  for (const item of items) {
    if (!text(item.name)) missing.add('俄语标题');
    if (!text(item.primary_image)) missing.add('主图');
    if (!Number(item.description_category_id) || !Number(item.type_id)) missing.add('Ozon 类目');
    if (!Number(item.price)) missing.add('价格');
  }
  return Array.from(missing);
}

function statusFromSubmitResponse(response: Record<string, unknown>): OzonListingTask['status'] {
  const status = text(response.importStatus || response.status);
  if (status === 'listing_ready') return 'listing_ready';
  if (status === 'imported') return 'imported';
  if (status === 'pending' || status === 'import_pending') return 'import_pending';
  return 'imported';
}

function messageFromSubmitResponse(response: Record<string, unknown>): string {
  const warnings = Array.isArray(response.warnings) ? response.warnings.map(text).filter(Boolean) : [];
  const taskId = text(response.taskId);
  const status = statusFromSubmitResponse(response);
  const suffix = taskId ? `（Task ID: ${taskId}）` : '';

  if (status === 'listing_ready') return `Ozon 已导入，价格和库存已更新${suffix}。`;
  if (status === 'imported') {
    return warnings.length
      ? `Ozon 已导入，价格已更新；${warnings.join('；')}${suffix}。`
      : `Ozon 已导入，价格已更新${suffix}。`;
  }
  return `Ozon 已接收导入任务，仍在等待导入结果${suffix}。`;
}

function buildDraft(
  task: OzonListingTask,
  form: DraftForm,
  dynamicValues: Record<string, string>,
  categoryAttributes: OzonCategoryAttribute[],
  dictionaryValueIds: DictionaryValueIds,
  requiredAttrs: OzonCategoryAttribute[],
): DraftBuildResult | null {
  if (!task.draft) return null;

  const draft = task.draft;
  const sourceItems = draft.items.length ? draft.items : [{}];
  const baseFirst = objectOf(sourceItems[0]);
  const images = lineList(form.images).map(normalizeImageUrl).filter(Boolean).slice(0, 15);
  const descriptionCategoryId = intForPayload(form.descriptionCategoryId);
  const typeId = intForPayload(form.typeId);
  const attributes = buildAttributes(baseFirst, form, dynamicValues, categoryAttributes, dictionaryValueIds);

  const firstItem: Record<string, unknown> = {
    ...baseFirst,
    name: form.name.trim().slice(0, 500),
    barcode: form.barcode.trim(),
    offer_id: form.offerId.trim().slice(0, 50),
    price: priceForPayload(form.price, '1'),
    old_price: priceForPayload(form.oldPrice, '0'),
    currency_code: form.currencyCode.trim() || 'CNY',
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    images,
    primary_image: images[0] || '',
    dimension_unit: form.dimensionUnit || 'mm',
    depth: positiveInteger(form.depth),
    width: positiveInteger(form.width),
    height: positiveInteger(form.height),
    weight_unit: form.weightUnit || 'g',
    weight: positiveInteger(form.weight),
    attributes,
    complex_attributes: Array.isArray(baseFirst.complex_attributes) ? baseFirst.complex_attributes : [],
    _category_path: form.categoryPath.trim(),
  };

  const nextItems = sourceItems.map((rawItem, index) => {
    if (index === 0) return firstItem;
    const item = objectOf(rawItem);
    return {
      ...item,
      currency_code: firstItem.currency_code,
      description_category_id: firstItem.description_category_id,
      type_id: firstItem.type_id,
      attributes,
      _category_path: firstItem._category_path,
    };
  });

  const attributeMissing = collectAttributeMissing(form, dynamicValues, requiredAttrs);
  const missing = collectPayloadMissing({ ...draft, items: nextItems }, nextItems, attributeMissing);
  const tags = normalizeTagsForPayload(form.tags).split(/\r?\n/).filter(Boolean);
  const estimatedDimensions = objectOf(draft.generated?.estimated_dimensions);
  const lengthCm = form.dimensionUnit === 'mm' ? Number(firstItem.depth) / 10 : Number(firstItem.depth) || 0;
  const widthCm = form.dimensionUnit === 'mm' ? Number(firstItem.width) / 10 : Number(firstItem.width) || 0;
  const heightCm = form.dimensionUnit === 'mm' ? Number(firstItem.height) / 10 : Number(firstItem.height) || 0;
  const generated = {
    ...draft.generated,
    title_ru: firstItem.name,
    model_name: form.model.trim(),
    description_ru: form.description.trim(),
    tags,
    matched_category: {
      ...objectOf(draft.generated?.matched_category),
      description_category_id: descriptionCategoryId,
      type_id: typeId,
      path: form.categoryPath.trim(),
    },
    estimated_dimensions: {
      ...estimatedDimensions,
      length_cm: Number.isFinite(lengthCm) ? lengthCm : 0,
      width_cm: Number.isFinite(widthCm) ? widthCm : 0,
      height_cm: Number.isFinite(heightCm) ? heightCm : 0,
      weight_g: Number(firstItem.weight) || 0,
    },
  };

  return {
    draft: {
      ...draft,
      status: missing.length ? 'needs_review' : 'ready',
      generated,
      items: nextItems,
      missing,
    },
    firstItem,
    missing,
  };
}

function sourceSummary(task: OzonListingTask): string {
  const row = firstRowOf(task);
  return [
    task.offerId || text(row.offer_id),
    text(row.sku_name),
    text(row.detail_url),
  ].filter(Boolean).join(' / ') || '来自 1688 深采结果';
}

function draftStatusLabel(status: OzonListingTaskStatus): string {
  switch (status) {
    case 'draft_ready': return '草稿已保存';
    case 'queued':
    case 'waiting_deep_collect':
    case 'deep_collecting':
    case 'generating_draft': return '草稿生成中';
    case 'import_pending': return '提交中';
    case 'imported': return '已导入';
    case 'listing_ready': return '已上架';
    case 'needs_manual':
    case 'deep_failed':
    case 'failed':
    case 'submit_failed': return '需要处理';
    default: return status;
  }
}

function variantOf(draft?: OzonDraft): Record<string, unknown> {
  if (!draft) return {};
  const generated = objectOf(draft.generated);
  const root = objectOf(draft.variant);
  return Object.keys(root).length ? root : objectOf(generated.variant_mapping);
}

function variantRows(variant: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(variant.variants) ? variant.variants.map(objectOf).filter(Boolean) : [];
}

function variantDimensions(variant: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(variant.dimensions) ? variant.dimensions.map(objectOf).filter(Boolean) : [];
}

function variantImageListFromItem(item: Record<string, unknown>): string[] {
  const images: string[] = [];
  const primary = normalizeImageUrl(text(item.primary_image));
  if (primary) images.push(primary);
  const values = Array.isArray(item.images) ? item.images : [];
  for (const value of values) {
    const url = normalizeImageUrl(text(value));
    if (url && !images.includes(url)) images.push(url);
  }
  return images.slice(0, 8);
}

function buildVariantTableView(
  task: OzonListingTask,
  draft: OzonDraft | undefined,
  firstItem: Record<string, unknown>,
): { rows: VariantRowView[]; dims: Record<string, unknown>[] } {
  const variant = variantOf(draft);
  const variantRowList = variantRows(variant);
  const dims = variantDimensions(variant);
  if (variantRowList.length) {
    const items = Array.isArray(draft?.items) ? draft.items : [];
    const rows = variantRowList.map((row, index) => {
      const item = objectOf(items[Number(row.item_index) ?? index] ?? items[index]);
      return {
        key: `${text(row.offer_id) || `sku-${index}`}-${index}`,
        skuName: text(row.source_sku_name) || text(item.name) || `SKU ${index + 1}`,
        images: variantImageListFromItem({ primary_image: row.image || item.primary_image, images: item.images }),
        offerId: text(row.offer_id),
        price: text(row.price),
        stock: text(row.stock),
        values: objectOf(row.values),
      };
    });
    return { rows, dims };
  }

  const row = firstRowOf(task);
  const stock = text(firstItem.stock) || text(row.sku_stock) || text(row.stock) || text(row.available_stock);
  return {
    rows: [{
      key: 'single-0',
      skuName: text(firstItem.name) || 'SKU 1',
      images: variantImageListFromItem(firstItem),
      offerId: text(firstItem.offer_id),
      price: text(firstItem.price),
      stock,
      values: {},
    }],
    dims: [],
  };
}

function categoryDescriptionId(entry: OzonCategoryEntry): number {
  return Number(entry.descriptionCategoryId || entry.description_category_id || 0);
}

function categoryTypeId(entry: OzonCategoryEntry): number {
  return Number(entry.typeId || entry.type_id || 0);
}

function FieldError({ show, text: value }: { show: boolean; text: string }) {
  if (!show) return null;
  return <small className="ozon-attr-error-text">{value}</small>;
}

function normalizeAttributeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeOptionText(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function containsCyrillic(value: unknown): boolean {
  return /[Ѐ-ӿ]/.test(String(value || ''));
}

function shouldTranslateDictionaryValue(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  if (/[一-鿿]/.test(raw)) return false;      // already Chinese
  if (/^[a-z0-9\s()+./_\-]+$/i.test(raw)) return false; // safe ASCII (abbreviations, English)
  if (/[Ѐ-ӿ]/.test(raw)) return true;        // Cyrillic → needs translation
  return false;
}

function dictionaryDisplayKey(attrId: number, valueId: number, rawValue: string): string {
  return `${attrId}:${valueId}:${rawValue}`;
}

function normalizeDictionaryDisplayText(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  if (/[一-鿿]/.test(raw)) return raw;
  // Keep NO NAME → 无品牌 fallback for brand field
  if (raw.trim().toUpperCase() === 'NO NAME') return '无品牌';
  if (/^[a-z0-9\s()+./_\-]+$/i.test(raw)) return raw;
  if (containsCyrillic(raw)) return raw; // let async translation handle
  return raw;
}

function isOriginCountryAttribute(attr: OzonCategoryAttribute): boolean {
  const name = normalizeAttributeName(attr.name);
  return name.includes('原产国')
    || name.includes('制造国')
    || name.includes('countryoforigin')
    || name.includes('страна');
}

function rankDictionaryOptions(options: OzonAttributeValue[], query: string): OzonAttributeValue[] {
  const needle = normalizeOptionText(query);
  if (!needle) return [];
  return options
    .map((option) => {
      const label = normalizeOptionText(option.value);
      let score = 0;
      if (label === needle) score += 100;
      if (label.startsWith(needle)) score += 70;
      if (label.includes(needle)) score += 50;
      if (needle.includes(label)) score += 30;
      if (['中国', 'china', 'китай'].includes(needle) && ['中国', 'china', 'китай'].some((item) => label.includes(item))) score += 120;
      return { option, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.option);
}

function normalizeBrandText(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function rankBrandOptions(options: OzonAttributeValue[], query: string): OzonAttributeValue[] {
  const needle = normalizeBrandText(query);
  if (!needle) return [];

  return options
    .map((option) => {
      const label = normalizeBrandText(option.value);
      let score = 0;
      if (label === needle) score += 100;
      if (label.startsWith(needle)) score += 70;
      if (label.includes(needle)) score += 50;
      if (needle.includes(label)) score += 20;
      return { option, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.option);
}

function BrandDictionaryField({
  attr,
  value,
  valueIds,
  descriptionCategoryId,
  typeId,
  onChange,
}: {
  attr: OzonCategoryAttribute;
  value: string;
  valueIds: Record<string, number>;
  descriptionCategoryId: number;
  typeId: number;
  onChange: (value: string, valueIds: Record<string, number>) => void;
}) {
  const [query, setQuery] = useState(value || 'NO NAME');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [options, setOptions] = useState<OzonAttributeValue[]>([]);
  const [searched, setSearched] = useState(false);

  async function searchBrand(searchText?: string) {
    const keyword = text(searchText ?? query);
    if (!keyword) { setMessage('请输入品牌关键词。'); return; }
    if (!descriptionCategoryId || !typeId) { setMessage('请先选择 Ozon 类目和类型。'); return; }

    setLoading(true);
    setMessage('');
    setSearched(true);
    try {
      const response = await getApi().ozon.getCategoryAttributeValues({
        descriptionCategoryId,
        typeId,
        attributeId: attr.id,
        language: 'ZH_HANS',
        limit: 200,
        query: keyword,
      });
      const values = response.values || [];
      const ranked = rankBrandOptions(values, keyword);
      setOptions(ranked);
      setMessage(ranked.length ? '' : '未找到相近品牌。');
    } catch (error) {
      setOptions([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function selectOption(option: OzonAttributeValue) {
    const label = text(option.value);
    if (!label) return;
    setQuery(label);
    onChange(label, { [label]: option.id });
    setOptions([]);
    setSearched(false);
    setMessage('');
  }

  return (
    <div className="ozon-brand-dictionary-field">
      <div className="ozon-brand-search-row">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearched(false);
            setOptions([]);
            setMessage('');
            onChange(event.target.value, {});
          }}
          placeholder="输入品牌"
        />
        <button type="button" onClick={() => searchBrand()} disabled={loading}>
          🔍
        </button>
      </div>

      {message && <small>{message}</small>}

      {searched && options.length > 0 && (
        <div className="ozon-brand-options">
          {options.map((option) => {
            const label = text(option.value);
            return (
              <button key={option.id} type="button" onClick={() => selectOption(option)}>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DictionaryAttributeField({
  attr,
  value,
  valueIds,
  descriptionCategoryId,
  typeId,
  onChange,
  onLoadOptions,
  getDisplayLabel,
}: {
  attr: OzonCategoryAttribute;
  value: string;
  valueIds: Record<string, number>;
  descriptionCategoryId: number;
  typeId: number;
  onChange: (value: string, valueIds: Record<string, number>) => void;
  onLoadOptions?: (attr: OzonCategoryAttribute, options: OzonAttributeValue[]) => void;
  getDisplayLabel?: (attrId: number, option: OzonAttributeValue) => string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<OzonAttributeValue[]>([]);
  const selected = lineList(value);
  const selectedSet = new Set(selected);
  const multi = attr.isCollection || attr.maxValueCount !== 1;
  const maxCount = attr.maxValueCount > 1 ? attr.maxValueCount : 0;
  const filteredOptions = options.filter((option) => {
    const needle = `${option.value} ${option.info || ''} ${option.id}`.toLowerCase();
    return !query.trim() || needle.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    setOpen(false);
    setLoading(false);
    setMessage('');
    setQuery('');
    setOptions([]);
  }, [attr.id, descriptionCategoryId, typeId]);

  async function loadValues() {
    if (loading || options.length) return;
    if (!descriptionCategoryId || !typeId) {
      setMessage('请先选择 Ozon 类目和类型。');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const response = await getApi().ozon.getCategoryAttributeValues({
        descriptionCategoryId,
        typeId,
        attributeId: attr.id,
        language: 'ZH_HANS',
        limit: 2000,
      });
      const rawOptions = response.values || [];
      setOptions(rawOptions);
      onLoadOptions?.(attr, rawOptions);
      setMessage(response.hasNext ? '字典值较多，已显示前 2000 个。' : '');
    } catch (error) {
      setOptions([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function openDropdown() {
    setOpen(true);
    void loadValues();
  }

  function selectOption(option: OzonAttributeValue) {
    const payloadLabel = text(option.value);
    if (!payloadLabel) return;
    const label = getDisplayLabel ? getDisplayLabel(attr.id, option) : text(option.value);

    if (!multi) {
      onChange(label, { [label]: option.id, [payloadLabel]: option.id });
      setOpen(false);
      setQuery('');
      return;
    }

    const nextSelected = selectedSet.has(label)
      ? selected.filter((item) => item !== label)
      : [...selected, label];

    if (!selectedSet.has(label) && maxCount > 0 && selected.length >= maxCount) {
      setMessage(`最多选择 ${maxCount} 个值。`);
      return;
    }

    const nextIds: Record<string, number> = {};
    for (const item of nextSelected) {
      const id = item === label ? option.id : valueIds[item];
      if (id) nextIds[item] = id;
    }
    if (option.id) nextIds[payloadLabel] = option.id;
    onChange(nextSelected.join('\n'), nextIds);
  }

  return (
    <div
      className="ozon-dictionary-field"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!next || !event.currentTarget.contains(next as Node)) setOpen(false);
      }}
    >
      <button type="button" className="ozon-dictionary-trigger" onClick={openDropdown}>
        <span>{selected.length ? selected.join(' / ') : '点击选择 Ozon 字典值'}</span>
        <b>{loading ? '加载中' : '选择'}</b>
      </button>

      {open && (
        <div className="ozon-dictionary-dropdown">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => void loadValues()}
            placeholder="搜索已加载字典值"
          />
          {message && <small>{message}</small>}
          <div className="ozon-dictionary-options">
            {loading ? (
              <div className="ozon-dictionary-state">正在加载 Ozon 字典值...</div>
            ) : filteredOptions.length ? (
              filteredOptions.map((option) => {
                const label = getDisplayLabel ? getDisplayLabel(attr.id, option) : text(option.value);
                const selectedOption = selectedSet.has(label);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={selectedOption ? 'selected' : ''}
                    onClick={() => selectOption(option)}
                  >
                    <span>{label}</span>
                  </button>
                );
              })
            ) : (
              <div className="ozon-dictionary-state">暂无可选字典值</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type CategoryTreeViewNode = {
  id: string;
  label: string;
  path: string;
  depth: number;
  descriptionCategoryId: number;
  typeId: number;
  selectable: boolean;
  children: CategoryTreeViewNode[];
};

function rawTreeRoots(tree: unknown): OzonCategoryRawNode[] {
  if (!tree || typeof tree !== 'object') return [];
  const obj = tree as Record<string, unknown>;

  for (const key of ['result', 'items', 'categories']) {
    const value = obj[key];
    if (Array.isArray(value)) return value as OzonCategoryRawNode[];
    if (value && typeof value === 'object') {
      const nested = rawTreeRoots(value);
      if (nested.length) return nested;
    }
  }

  if (obj.data && typeof obj.data === 'object') return rawTreeRoots(obj.data);
  return [];
}

function buildCategoryTreeView(
  nodes: OzonCategoryRawNode[],
  parents: string[] = [],
  inheritedDescriptionCategoryId = 0,
): CategoryTreeViewNode[] {
  const result: CategoryTreeViewNode[] = [];

  for (const node of nodes) {
    if (!node || node.disabled === true) continue;

    const label = String(node.category_name || node.type_name || '').trim();
    const descriptionCategoryId = Number(node.description_category_id || inheritedDescriptionCategoryId || 0);
    const typeId = Number(node.type_id || 0);
    const pathParts = label ? [...parents, label] : [...parents];
    const path = pathParts.join(' / ');
    const rawChildren = Array.isArray(node.children) ? node.children : [];

    const children = buildCategoryTreeView(rawChildren, pathParts, descriptionCategoryId);
    const selectable = Boolean(typeId && descriptionCategoryId);

    if (!label && !children.length) continue;

    result.push({
      id: selectable
        ? `type:${descriptionCategoryId}:${typeId}:${path}`
        : `category:${descriptionCategoryId || path}:${path}`,
      label: label || path || '未命名类目',
      path,
      depth: pathParts.length,
      descriptionCategoryId,
      typeId,
      selectable,
      children,
    });
  }

  return result;
}

function treeNodeToCategoryEntry(node: CategoryTreeViewNode): OzonCategoryEntry {
  return {
    keyword: node.label,
    path: node.path,
    typeId: node.typeId,
    type_id: node.typeId,
    descriptionCategoryId: node.descriptionCategoryId,
    description_category_id: node.descriptionCategoryId,
    disabled: false,
    searchIndex: `${node.path} ${node.descriptionCategoryId} ${node.typeId}`,
  };
}

function isSelectableCategoryNode(node: CategoryTreeViewNode): boolean {
  return node.selectable;
}

export default function OzonDraftEditor({ task, onTaskUpdate, onBackTo1688, onToast }: Props) {
  const [form, setForm] = useState(() => createDraftForm(task));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [shopLabel, setShopLabel] = useState('Ozon 店铺：未检查');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryAttributes, setCategoryAttributes] = useState<OzonCategoryAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesMessage, setAttributesMessage] = useState('尚未加载类目特征');
  const [attributeReloadKey, setAttributeReloadKey] = useState(0);
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>(() => attributeValuesById(firstItemOf(task)));
  const [attemptedProduct, setAttemptedProduct] = useState(false);
  const [attemptedAttributes, setAttemptedAttributes] = useState(false);
  const [categoryTreeNodes, setCategoryTreeNodes] = useState<CategoryTreeViewNode[]>([]);
  const [categoryTreeLoading, setCategoryTreeLoading] = useState(false);
  const [categoryTreeMessage, setCategoryTreeMessage] = useState('');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Record<string, boolean>>({});
  const [dictionaryValueIds, setDictionaryValueIds] = useState<DictionaryValueIds>(() => attributeDictionaryIdsById(firstItemOf(task)));
  const [showMoreAttributes, setShowMoreAttributes] = useState(false);
  const [activeSection, setActiveSection] = useState<EditorSectionId>('main');
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<OzonCategoryEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const brandAttribute = useMemo(
    () => categoryAttributes.find((attr) => attr.id === ATTR_BRAND) || null,
    [categoryAttributes],
  );
  const brandIsDictionary = Boolean(brandAttribute?.dictionaryId);

  const [attributeAiFilling, setAttributeAiFilling] = useState(false);
  const [attributeAiFilledKey, setAttributeAiFilledKey] = useState('');
  const attributeAutoFillKey = `${task.key}:${form.descriptionCategoryId}:${form.typeId}`;

  // Dynamic dictionary translation cache (attrId:valueId:rawValue → displayValue)
  const [dictionaryDisplayLabels, setDictionaryDisplayLabels] = useState<Record<string, string>>({});
  // Payload value mapping (attrId → { displayValue → payloadValue })
  const [dictionaryPayloadValues, setDictionaryPayloadValues] = useState<Record<string, Record<string, string>>>({});

  function dictionaryDisplayLabelForOption(attrId: number, option: OzonAttributeValue): string {
    const key = dictionaryDisplayKey(attrId, option.id, text(option.value));
    return dictionaryDisplayLabels[key] || text(option.value);
  }

  function updateDictionarySelection(
    attrId: number,
    displayValue: string,
    payloadValue: string,
    dictionaryValueId: number,
  ) {
    updateDictionaryValueIds(attrId, {
      [displayValue]: dictionaryValueId,
      [payloadValue]: dictionaryValueId,
    });
    setDictionaryPayloadValues((prev) => ({
      ...prev,
      [String(attrId)]: {
        ...(prev[String(attrId)] || {}),
        [displayValue]: payloadValue,
        [payloadValue]: payloadValue,
      },
    }));
  }

  async function translateVisibleDictionaryOptions(attr: OzonCategoryAttribute, options: OzonAttributeValue[], limit = 50) {
  }

  const currentDraft = task.draft;

  const variantOfDraft = useMemo(() => variantOf(currentDraft), [currentDraft]);
  const variantRowsOfDraft = useMemo(() => variantRows(variantOfDraft), [variantOfDraft]);
  const variantDimsOfDraft = useMemo(() => variantDimensions(variantOfDraft), [variantOfDraft]);

  const variantDimensionAttrIds = useMemo(() => {
    const ids = new Set<number>();
    for (const dim of variantDimsOfDraft) {
      const id = Number(dim.ozon_attribute_id || 0);
      if (id > 0) ids.add(id);
    }
    return ids;
  }, [variantDimsOfDraft]);

  const moreCategoryAttributes = useMemo(
    () => categoryAttributes
      .filter((attr) => !CONTROLLED_ATTR_IDS.has(attr.id))
      .filter((attr) => !isMediaAttributeName(attr))
      .filter((attr) => !variantDimensionAttrIds.has(attr.id)),
    [categoryAttributes, variantDimensionAttrIds],
  );

  const hiddenRequiredAttributes = useMemo(
    () => moreCategoryAttributes.filter(
      (attr) => attr.isRequired && !text(dynamicValues[String(attr.id)]),
    ),
    [moreCategoryAttributes, dynamicValues],
  );

  async function resolveDictionaryValueForSuggestion(attr: OzonCategoryAttribute, query: string): Promise<{ label: string; id: number } | null> {
    if (!text(query)) return null;
    const descId = intForPayload(form.descriptionCategoryId);
    const typeId = intForPayload(form.typeId);
    if (!descId || !typeId) return null;

    try {
      // Step 1: search by keyword to find the matching dictionary_value_id.
      // The search endpoint does NOT support language: ZH_HANS, so results may be Russian.
      const searchResp = await getApi().ozon.getCategoryAttributeValues({
        descriptionCategoryId: descId,
        typeId,
        attributeId: attr.id,
        limit: 20,
        query,
      });
      const searchOptions = searchResp.values || [];
      const ranked = rankDictionaryOptions(searchOptions, query);
      if (!ranked.length) return null;
      const matchedId = ranked[0].id;

      // Step 2: look up the Chinese display value by ID using the list endpoint with ZH_HANS.
      const zhResp = await getApi().ozon.getCategoryAttributeValues({
        descriptionCategoryId: descId,
        typeId,
        attributeId: attr.id,
        language: 'ZH_HANS',
        limit: 2000,
      });
      const zhOptions = zhResp.values || [];
      const zhMatch = zhOptions.find((item) => item.id === matchedId);
      const label = zhMatch ? text(zhMatch.value) : text(ranked[0].value);
      return { label, id: matchedId };
    } catch {
      return null;
    }
  }

  async function applyDefaultOriginCountry(attrs: OzonCategoryAttribute[]) {
    const originAttr = attrs.find(isOriginCountryAttribute);
    if (!originAttr) return;
    if (text(dynamicValues[String(originAttr.id)])) return;
    if (!originAttr.dictionaryId) {
      updateDynamicValue(originAttr.id, '中国');
      return;
    }
    const selected = await resolveDictionaryValueForSuggestion(originAttr, '中国');
    if (!selected) return;
    updateDynamicValue(originAttr.id, selected.label);
    updateDictionaryValueIds(originAttr.id, { [selected.label]: selected.id });
  }

  function applyPrefilledAttributeValues(
    values: Array<{ attribute_id: number; value_text: string; dictionary_value_id?: number }>,
  ) {
    for (const v of values) {
      const attrKey = String(v.attribute_id);
      if (text(dynamicValues[attrKey])) continue; // don't overwrite user edits
      updateDynamicValue(v.attribute_id, v.value_text);
      if (v.dictionary_value_id) {
        updateDictionaryValueIds(v.attribute_id, { [v.value_text]: v.dictionary_value_id });
      }
    }
  }

  async function applyAttributeSuggestions(
    suggestions: Array<{ attribute_id: number; value_text: string; dictionary_query?: string }>,
    attrs: OzonCategoryAttribute[],
  ) {
    const attrMap = new Map(attrs.map((attr) => [Number(attr.id), attr]));
    for (const suggestion of suggestions) {
      const attr = attrMap.get(Number(suggestion.attribute_id));
      if (!attr) continue;
      const attrKey = String(attr.id);
      if (text(dynamicValues[attrKey])) continue;

      const suggestedText = text(suggestion.value_text);
      const dictionaryQuery = text(suggestion.dictionary_query || suggestion.value_text);
      if (!suggestedText && !dictionaryQuery) continue;

      if (attr.dictionaryId) {
        const selected = await resolveDictionaryValueForSuggestion(attr, dictionaryQuery || suggestedText);
        if (!selected) continue;
        updateDynamicValue(attr.id, selected.label);
        updateDictionaryValueIds(attr.id, { [selected.label]: selected.id });
        continue;
      }
      updateDynamicValue(attr.id, suggestedText);
    }
  }

  async function fillCategoryAttributesByAi(forceFresh = false) {
    if (attributeAiFilling) return;
    const attrs = moreCategoryAttributes;
    if (!attrs.length) return;

    setAttributeAiFilledKey(attributeAutoFillKey);
    setAttributeAiFilling(true);

    // Pre-filled by the draft generation backend — apply immediately
    const prefillValues = task.draft?.generated &&
      typeof task.draft.generated === 'object' &&
      (task.draft.generated as Record<string, unknown>).attribute_values;
    const values = Array.isArray(prefillValues) ? prefillValues : [];

    if (values.length && !forceFresh) {
      setMessage('草稿已附带特征值，正在应用...');
      try {
        await applyDefaultOriginCountry(attrs);
        applyPrefilledAttributeValues(values);
        setMessage('AI 已尝试填写类目特征，请检查字典项是否正确。');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setAttributeAiFilling(false);
      }
      return;
    }

    setMessage('AI 正在根据商品数据填写类目特征...');
    try {
      await applyDefaultOriginCountry(attrs);

      const response = await getApi().ozon.generateAttributeSuggestions({
        sourceRows: task.draft?.sourceRows || [],
        categoryAttributes: attrs,
        form: { name: form.name, brand: form.brand, model: form.model, description: form.description, tags: form.tags, categoryPath: form.categoryPath },
        category: { descriptionCategoryId: intForPayload(form.descriptionCategoryId), typeId: intForPayload(form.typeId), path: form.categoryPath },
      });

      await applyAttributeSuggestions(response.attributes || [], attrs);
      setMessage('AI 已尝试填写类目特征，请检查字典项是否正确。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAttributeAiFilling(false);
    }
  }

  // Attribute values are pre-filled by the backend during generateOzonDraft.
  // They come from draft.items[0].attributes via attributeValuesById on mount.
  // No auto AI fill on open — user clicks "AI 补全属性" button to fill gaps.

  useEffect(() => {
    const nextForm = createDraftForm(task);
    setForm(nextForm);
    setDynamicValues(attributeValuesById(firstItemOf(task)));
    setDictionaryValueIds(attributeDictionaryIdsById(firstItemOf(task)));
    setCategoryAttributes([]);
    setMessage('');
    setShowMoreAttributes(false);
    setCategoryDrawerOpen(false);
    setPendingCategory(null);
    setAttemptedProduct(false);
    setAttemptedAttributes(false);
    setAttributeAiFilledKey('');
    setAttributeAiFilling(false);
  }, [task.key, task.draftId]);

  useEffect(() => {
    let alive = true;
    getApi().ozon.getSettings()
      .then((settings) => {
        if (!alive) return;
        const store = settings.ozon;
        setShopLabel(store.apiKeySet && store.clientId ? `Ozon 店铺：已绑定 ${store.shopName || store.clientId}` : 'Ozon 店铺：未绑定');
      })
      .catch(() => {
        if (alive) setShopLabel('Ozon 店铺：未检查');
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    loadCategoryTree(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-bind NO NAME dictionary_value_id for brand dictionary fields
  useEffect(() => {
    const descId = intForPayload(form.descriptionCategoryId);
    const typeId = intForPayload(form.typeId);
    if (!brandAttribute?.dictionaryId || !descId || !typeId) return;

    const currentBrand = text(form.brand) || 'NO NAME';
    const currentIds = dictionaryValueIds[String(ATTR_BRAND)] || {};
    if (currentIds[currentBrand]) return;
    if (currentBrand.toUpperCase() !== 'NO NAME') return;

    let alive = true;
    getApi().ozon.getCategoryAttributeValues({
      descriptionCategoryId: descId,
      typeId,
      attributeId: ATTR_BRAND,
      language: 'ZH_HANS',
      limit: 10,
      query: 'NO NAME',
    }).then((response) => {
      if (!alive) return;
      const values = response.values || [];
      const ranked = rankBrandOptions(values, 'NO NAME');
      const exact = ranked.length > 0 ? ranked[0] : undefined;
      const strictMatch = exact && normalizeBrandText(exact.value) === 'noname';
      const target = strictMatch ? exact : null;
      if (target?.id) {
        updateField('brand', text(target.value) || 'NO NAME');
        updateDictionaryValueIds(ATTR_BRAND, { [text(target.value) || 'NO NAME']: target.id });
      }
    }).catch(() => { /* non-blocking */ });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandAttribute?.dictionaryId, form.descriptionCategoryId, form.typeId]);

  useEffect(() => {
    const descriptionCategoryId = intForPayload(form.descriptionCategoryId);
    const typeId = intForPayload(form.typeId);
    if (!descriptionCategoryId || !typeId) {
      setCategoryAttributes([]);
      setAttributesMessage('请选择 Ozon 类目和类型后加载特征。');
      return;
    }

    let alive = true;
    setAttributesLoading(true);
    setAttributesMessage('正在加载类目特征...');
    getApi().ozon.getCategoryAttributes({ descriptionCategoryId, typeId, language: 'ZH_HANS' })
      .then((response) => {
        if (!alive) return;
        setCategoryAttributes(response.attributes || []);
        setAttributesMessage(`已加载 ${response.attributes.length} 项类目特征，其中必填 ${response.requiredCount} 项`);
      })
      .catch((error) => {
        if (!alive) return;
        setCategoryAttributes([]);
        setAttributesMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (alive) setAttributesLoading(false);
      });

    return () => { alive = false; };
  }, [attributeReloadKey, form.descriptionCategoryId, form.typeId]);

  // Scroll spy: keep the right-hand nav in sync with the editor scroll container.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
      let best: string | null = null;
      let bestTop = Infinity;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const top = entry.boundingClientRect.top;
        if (top < bestTop) {
          bestTop = top;
          best = entry.target.id;
        }
      }
      if (best === 'ozon-section-main') setActiveSection('main');
      else if (best === 'ozon-section-attributes') setActiveSection('attributes');
      else if (best === 'ozon-section-variants') setActiveSection('variants');
    }, { root, rootMargin: '0px 0px -55% 0px', threshold: 0 });

    for (const id of ['ozon-section-main', 'ozon-section-attributes', 'ozon-section-variants']) {
      const el = root.querySelector(`#${id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const productMissing = useMemo(() => collectProductPageMissing(form), [form]);
  const attributeMissing = useMemo(
    () => collectAttributeMissing(form, dynamicValues, moreCategoryAttributes),
    [moreCategoryAttributes, dynamicValues, form],
  );
  const buildResult = useMemo(
    () => buildDraft(task, form, dynamicValues, categoryAttributes, dictionaryValueIds, moreCategoryAttributes),
    [categoryAttributes, dictionaryValueIds, dynamicValues, form, moreCategoryAttributes, task],
  );
  const missing = buildResult?.missing || task.missingFields || task.draft?.missing || [];
  const firstItem = buildResult?.firstItem || firstItemOf(task);
  const canSubmit = Boolean(buildResult?.draft) && missing.length === 0 && !submitting;
  const validationState: ValidationState =
    submitting ? 'validating'
      : !buildResult?.draft ? 'invalid'
        : missing.length === 0 ? 'valid'
          : 'invalid';

  const missingCounts = {
    main: productMissing.length,
    attributes: attributeMissing.length,
    variants: 0,
  };

  const variantTable = useMemo(
    () => buildVariantTableView(task, buildResult?.draft || task.draft, firstItem),
    [buildResult?.draft, firstItem, task],
  );
  const visibleVariantDims = variantTable.dims.filter((dim) => dim.distinguishes_variants === true);

  function updateField<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDynamicValue(attrId: number, value: string) {
    setDynamicValues((prev) => ({ ...prev, [String(attrId)]: value }));
  }

  function updateDictionaryValueIds(attrId: number, values: Record<string, number>) {
    setDictionaryValueIds((prev) => ({ ...prev, [String(attrId)]: values }));
  }

  function applyCategory(entry: OzonCategoryEntry) {
    setForm((prev) => ({
      ...prev,
      descriptionCategoryId: String(categoryDescriptionId(entry)),
      typeId: String(categoryTypeId(entry)),
      categoryPath: entry.path || entry.keyword || '',
    }));
    setMessage('已选择 Ozon 类目，正在加载该类目的特征。');
  }

  async function loadCategoryTree(forceRefresh = false) {
    setCategoryTreeLoading(true);
    try {
      const response = await getApi().ozon.getCategoryTree({
        forceRefresh,
        language: 'ZH_HANS',
      });

      const roots = rawTreeRoots(response.tree);
      const treeNodes = buildCategoryTreeView(roots);

      setCategoryTreeNodes(treeNodes);
      setCategoryTreeMessage(
        response.message || (treeNodes.length ? `已加载 ${response.total || treeNodes.length} 个 Ozon 可选类目。` : '类目树为空，请同步最新类目。'),
      );
      setExpandedCategoryIds({});
    } catch (error) {
      setCategoryTreeNodes([]);
      setCategoryTreeMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCategoryTreeLoading(false);
    }
  }

  function toggleCategoryNode(id: string) {
    setExpandedCategoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function navigateToSection(id: EditorSectionId) {
    document.getElementById(`ozon-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  }

  function applyDraft(showToast = true): DraftBuildResult | null {
    const result = buildDraft(task, form, dynamicValues, categoryAttributes, dictionaryValueIds, moreCategoryAttributes);
    if (!result) {
      setMessage('当前任务还没有可编辑的 Ozon 草稿。');
      return null;
    }

    const patch: OzonListingTaskPatch = {
      draft: result.draft,
      title: text(result.firstItem.name) || task.title,
      price: text(result.firstItem.price) || task.price,
      image: text(result.firstItem.primary_image) || task.image,
      status: 'draft_ready',
      message: result.missing.length
        ? `需补充：${formatMissingFields(result.missing)}`
        : 'Ozon 草稿已保存，可进入预览提交。',
      updatedAt: new Date().toISOString(),
    };

    onTaskUpdate?.(task.key, patch);
    setLastSavedAt(new Date().toLocaleTimeString());
    if (showToast) onToast?.(result.missing.length ? '已保存，仍有必填项待补充' : '已保存 Ozon 草稿');
    setMessage(result.missing.length ? `仍需补充：${formatMissingFields(result.missing)}` : '已保存，payload 已同步更新。');
    return result;
  }

  function handleValidate() {
    setAttemptedProduct(true);
    setAttemptedAttributes(true);
    const result = applyDraft(false);
    if (!result) return;
    if (result.missing.length) {
      onToast?.(`校验未通过：${formatMissingFields(result.missing)}`);
    } else {
      onToast?.('校验通过，可以提交 Ozon');
    }
  }

  async function submitDraft() {
    setAttemptedProduct(true);
    setAttemptedAttributes(true);
    const result = applyDraft(false);
    if (!result) return;
    if (result.missing.length) {
      setMessage(`提交前还需要补充：${formatMissingFields(result.missing)}`);
      return;
    }
    if (!window.confirm('确认提交当前 Ozon 草稿？提交前请确认店铺设置已开启真实提交。')) return;

    setSubmitting(true);
    onTaskUpdate?.(task.key, {
      draft: result.draft,
      status: 'import_pending',
      message: '正在提交 Ozon 导入任务，并等待导入结果。',
      updatedAt: new Date().toISOString(),
      finishedAt: undefined,
    });
    try {
      const response = await getApi().ozon.submitDraft(result.draft, true);
      const normalizedResponse = objectOf(response);
      const nextStatus = statusFromSubmitResponse(normalizedResponse);
      onTaskUpdate?.(task.key, {
        draft: result.draft,
        status: nextStatus,
        message: messageFromSubmitResponse(normalizedResponse),
        updatedAt: new Date().toISOString(),
        finishedAt: nextStatus === 'import_pending' ? undefined : new Date().toISOString(),
        debug: normalizedResponse,
      });
      onToast?.(nextStatus === 'import_pending' ? 'Ozon 导入任务已提交' : 'Ozon 导入链路已更新');
      setMessage(messageFromSubmitResponse(normalizedResponse));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail || '提交失败，请检查店铺绑定与真实提交开关。');
      onTaskUpdate?.(task.key, {
        draft: result.draft,
        status: 'submit_failed',
        message: detail || '提交失败，请检查店铺绑定与真实提交开关。',
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        debug: { rawError: detail },
      });
      onToast?.('提交失败，请检查店铺设置');
    } finally {
      setSubmitting(false);
    }
  }

  if (!task.draft) {
    return (
      <div className="ozon-draft-empty-state">
        <h4>还没有生成 Ozon 草稿</h4>
        <p>当前任务仍在处理中或生成失败。回到 1688 商品卡重新生成草稿后，这里会显示可编辑表单。</p>
        <button type="button" onClick={onBackTo1688}>返回 1688</button>
      </div>
    );
  }

  const missingDims = productMissing.filter((item) => item.startsWith('包装'));

  return (
    <div className="ozon-ai-edit-page">
      <div className="ozon-ai-edit-topbar">
        <div>
          <h4>Ozon 上架转换</h4>
          <span>{sourceSummary(task)}</span>
        </div>
        <div className="ozon-ai-edit-top-actions">
          <span className={shopLabel.includes('已绑定') ? 'ready' : ''}>{shopLabel}</span>
          <span className={`ozon-ai-edit-draft-status ${missing.length ? 'warn' : ''}`}>{draftStatusLabel(task.status)}</span>
          <button type="button" onClick={onBackTo1688}>关闭</button>
        </div>
      </div>

      {message && <div className={`ozon-draft-notice ${missing.length ? 'warn' : 'ready'}`}>{message}</div>}

      <div className="ozon-ai-edit-scroll" ref={scrollRef}>
        <div className="ozon-ai-edit-layout">
          <main className="ozon-ai-edit-center">
            <section id="ozon-section-main" className="ozon-form-card">
              <div className="ozon-form-card-header">主要信息</div>
              <div className="ozon-attr-grid">
                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">上架店铺</label>
                  <div className="ozon-attr-control">
                    <input readOnly value={shopLabel} title="当前绑定的 Ozon 店铺" />
                  </div>
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">Ozon 类目 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <div className="ozon-category-current">
                      <span className={form.categoryPath ? '' : 'empty'}>{form.categoryPath || '未选择类目'}</span>
                      <button type="button" onClick={() => setCategoryDrawerOpen(true)}>更换类目</button>
                    </div>
                  </div>
                  <FieldError show={attemptedProduct && productMissing.includes('类目和类型')} text="请选择带 type_id 的 Ozon 末级类目" />
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">商品标题 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.name}
                      onChange={(event) => updateField('name', event.target.value)}
                      placeholder="商品标题（俄语）"
                    />
                  </div>
                  <FieldError show={attemptedProduct && missing.includes('俄语标题')} text="俄语标题不能为空" />
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">品牌 <span className="req">*</span>{brandIsDictionary ? <span className="unit-warning">（字典）</span> : null}</label>
                  <div className="ozon-attr-control">
                    {brandAttribute && brandIsDictionary ? (
                      <BrandDictionaryField
                        attr={brandAttribute}
                        value={form.brand}
                        valueIds={dictionaryValueIds[String(ATTR_BRAND)] || {}}
                        descriptionCategoryId={intForPayload(form.descriptionCategoryId)}
                        typeId={intForPayload(form.typeId)}
                        onChange={(nextValue, nextIds) => {
                          updateField('brand', nextValue);
                          updateDictionaryValueIds(ATTR_BRAND, nextIds);
                        }}
                      />
                    ) : (
                      <input value={form.brand} onChange={(event) => updateField('brand', event.target.value)} placeholder="如 NO NAME" />
                    )}
                  </div>
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">含包装重量（g）<span className="unit-warning">注意单位是克(g)</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.weight}
                      onChange={(event) => updateField('weight', event.target.value)}
                      inputMode="numeric"
                      placeholder="如: 800"
                    />
                  </div>
                  <FieldError show={attemptedProduct && productMissing.includes('含包装重量')} text="重量必须大于 0" />
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">包装尺寸（mm）<span className="unit-warning">注意单位是毫米(mm)</span></label>
                  <div className="ozon-dimension-row">
                    <div className="ozon-dimension-field">
                      <input value={form.depth} onChange={(event) => updateField('depth', event.target.value)} inputMode="numeric" placeholder="长" />
                      <span className="dimension-hint">长</span>
                    </div>
                    <span className="dimension-sep">×</span>
                    <div className="ozon-dimension-field">
                      <input value={form.width} onChange={(event) => updateField('width', event.target.value)} inputMode="numeric" placeholder="宽" />
                      <span className="dimension-hint">宽</span>
                    </div>
                    <span className="dimension-sep">×</span>
                    <div className="ozon-dimension-field">
                      <input value={form.height} onChange={(event) => updateField('height', event.target.value)} inputMode="numeric" placeholder="高" />
                      <span className="dimension-hint">高</span>
                    </div>
                  </div>
                  <FieldError show={attemptedProduct && missingDims.length > 0} text={`包装尺寸必须大于 0（${missingDims.join('、')}）`} />
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">价格（¥）<span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.price}
                      onChange={(event) => updateField('price', event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                  <FieldError show={attemptedProduct && productMissing.includes('价格')} text="价格必须大于 0" />
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">划线价（¥）</label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.oldPrice}
                      onChange={(event) => updateField('oldPrice', event.target.value)}
                      inputMode="decimal"
                      placeholder="0=清空"
                    />
                  </div>
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">货号 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input value={form.offerId} onChange={(event) => updateField('offerId', event.target.value)} placeholder="Ozon 商品货号" />
                  </div>
                  <FieldError show={attemptedProduct && productMissing.includes('货号')} text="货号不能为空" />
                </div>
              </div>
            </section>

            <section id="ozon-section-attributes" className="ozon-form-card">
              <div className="ozon-form-card-header">
                <span>产品属性</span>
                <div className="ozon-attr-header-actions">
                  {hiddenRequiredAttributes.length > 0 && !showMoreAttributes && (
                    <span className="ozon-more-attrs-hint">还有 {hiddenRequiredAttributes.length} 个必填项</span>
                  )}
                  <button
                    type="button"
                    className={`ozon-more-attrs-btn ${hiddenRequiredAttributes.length > 0 && !showMoreAttributes ? 'warn' : ''}`}
                    onClick={() => setShowMoreAttributes((value) => !value)}
                  >
                    <span className="ozon-more-attrs-arrow">{showMoreAttributes ? '↑' : '↓'}</span>
                    {showMoreAttributes ? '收起更多属性' : '填写更多属性'}
                  </button>
                </div>
              </div>

              <div className="ozon-attrs-status-row">
                <span>{attributesLoading ? '正在加载类目特征...' : attributesMessage}</span>
                <button type="button" onClick={() => setAttributeReloadKey((value) => value + 1)}>重新加载</button>
              </div>

              <div className="ozon-attr-grid">
                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">型号名称 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input value={form.model} onChange={(event) => updateField('model', event.target.value)} placeholder="型号名称" />
                  </div>
                  <FieldError show={attemptedAttributes && attributeMissing.includes('型号名称')} text="型号名称不能为空" />
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">条形码</label>
                  <div className="ozon-attr-control">
                    <input value={form.barcode} onChange={(event) => updateField('barcode', event.target.value)} placeholder="条形码（可选）" />
                  </div>
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">#主题标签</label>
                  <div className="ozon-attr-control">
                    <textarea
                      value={form.tags}
                      onChange={(event) => updateField('tags', event.target.value)}
                      rows={4}
                      placeholder="#keyword 每行一个"
                    />
                  </div>
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">简介 / 描述</label>
                  <div className="ozon-attr-control">
                    <textarea
                      value={form.description}
                      onChange={(event) => updateField('description', event.target.value)}
                      rows={6}
                      placeholder="商品描述（俄语）"
                    />
                  </div>
                </div>
              </div>

              {showMoreAttributes && (
                <div className="ozon-other-attrs-block">
                  <div className="ozon-other-attrs-divider">
                    <span>当前类目专有属性</span>
                    <small>{moreCategoryAttributes.length} 项</small>
                  </div>
                  <div className="ozon-other-attr-grid">
                    {moreCategoryAttributes.map((attr) => (
                      <div key={attr.id} className="ozon-other-attr-item">
                        <label className="ozon-attr-label ozon-other-attr-label">
                          {attr.name}{attr.isRequired ? <span className="req">*</span> : null}
                        </label>
                        <div className="ozon-attr-control ozon-other-attr-control">
                          {attr.dictionaryId ? (
                            <DictionaryAttributeField
                              attr={attr}
                              value={dynamicValues[String(attr.id)] || ''}
                              valueIds={dictionaryValueIds[String(attr.id)] || {}}
                              descriptionCategoryId={intForPayload(form.descriptionCategoryId)}
                              typeId={intForPayload(form.typeId)}
                              onLoadOptions={(a, opts) => { void translateVisibleDictionaryOptions(a, opts); }}
                              getDisplayLabel={(attrId, option) => dictionaryDisplayLabelForOption(attrId, option)}
                              onChange={(nextValue, nextIds) => {
                                updateDynamicValue(attr.id, nextValue);
                                updateDictionaryValueIds(attr.id, nextIds);
                                const payloadMap = { ...dictionaryPayloadValues[String(attr.id)] || {} };
                                for (const [key] of Object.entries(nextIds)) {
                                  payloadMap[key] = key;
                                }
                                setDictionaryPayloadValues((prev) => ({ ...prev, [String(attr.id)]: payloadMap }));
                              }}
                            />
                          ) : attr.maxValueCount !== 1 || attr.isCollection ? (
                            <textarea
                              value={dynamicValues[String(attr.id)] || ''}
                              onChange={(event) => updateDynamicValue(attr.id, event.target.value)}
                              rows={3}
                              placeholder="多个值可换行填写"
                            />
                          ) : (
                            <input
                              value={dynamicValues[String(attr.id)] || ''}
                              onChange={(event) => updateDynamicValue(attr.id, event.target.value)}
                              placeholder={attr.description || '填写属性值'}
                            />
                          )}
                        </div>
                        {attemptedAttributes && attr.isRequired && !text(dynamicValues[String(attr.id)]) && (
                          <small className="ozon-attr-error-text ozon-other-attr-error">该类目必填属性不能为空</small>
                        )}
                      </div>
                    ))}
                    {moreCategoryAttributes.length === 0 && (
                      <div className="ozon-other-attr-empty">该类目没有更多专有属性</div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section id="ozon-section-variants" className="ozon-form-card">
              <div className="ozon-form-card-header">
                <span>变体设置</span>
                <div className="ozon-variant-header-meta">
                  <span>{variantTable.rows.length} 个 SKU</span>
                  <small>{variantRowsOfDraft.length > 0 ? '来自 1688 SKU 规格解析' : '商品级主图已带入首行'}</small>
                </div>
              </div>

              <div className="ozon-variant-table-wrap">
                <table className="ozon-variant-table">
                  <thead>
                    <tr>
                      <th className="col-idx">#</th>
                      <th>SKU 名称 <span className="req">*</span></th>
                      <th>图片</th>
                      <th>货号 <span className="req">*</span></th>
                      <th>售价 <span className="req">*</span></th>
                      <th>库存</th>
                      {visibleVariantDims.map((dim) => (
                        <th key={text(dim.source_name)} title={text(dim.ozon_attribute_name)}>{text(dim.source_name)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {variantTable.rows.map((row, index) => (
                      <tr key={row.key}>
                        <td className="col-idx">{index + 1}</td>
                        <td className="col-sku-name">{row.skuName}</td>
                        <td className="col-images">
                          <div className="variant-img-list" title="变体图片（只读预览）">
                            {row.images.length ? (
                              row.images.slice(0, 3).map((img, ii) => (
                                <div key={ii} className="variant-img-item">
                                  <img src={img} alt="" />
                                  {ii === 2 && row.images.length > 3 && (
                                    <div className="variant-img-overlay">+{row.images.length - 3}</div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="variant-img-placeholder">暂无图片</div>
                            )}
                          </div>
                        </td>
                        <td className="col-offer-id">{row.offerId || '—'}</td>
                        <td className="col-price">{row.price || '—'}</td>
                        <td className="col-stock">{row.stock || '0'}</td>
                        {visibleVariantDims.map((dim) => (
                          <td key={text(dim.source_name)} className="col-dim">{text(row.values[text(dim.source_name)]) || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {visibleVariantDims.length > 0 && (
                <div className="ozon-variant-dims-hint">
                  变体维度：{visibleVariantDims.map((dim) => text(dim.source_name)).join(' / ')}
                  {variantRowsOfDraft.some((row) => Number(objectOf(row).status) > 0) ? '' : ''}
                </div>
              )}
            </section>
          </main>

          <aside className="ozon-ai-edit-nav">
            <OzonEditorNav
              activeSection={activeSection}
              missingCounts={missingCounts}
              onNavigate={navigateToSection}
            />
          </aside>
        </div>
      </div>

      <OzonEditorBottomBar
        submitting={submitting}
        hasDraft={Boolean(task.draft)}
        missingCount={missing.length}
        validationState={validationState}
        lastSavedAt={lastSavedAt}
        aiFilling={attributeAiFilling}
        onSave={() => applyDraft(true)}
        onValidate={handleValidate}
        onSubmit={submitDraft}
        onBack={onBackTo1688}
        onAiFillAttributes={() => fillCategoryAttributesByAi(false)}
      />

      <OzonCategoryDrawer
        open={categoryDrawerOpen}
        currentPath={form.categoryPath}
        query={categoryQuery}
        onQueryChange={setCategoryQuery}
        treeNodes={categoryTreeNodes}
        treeLoading={categoryTreeLoading}
        treeMessage={categoryTreeMessage}
        expandedIds={expandedCategoryIds}
        onToggleExpand={toggleCategoryNode}
        onSelectNode={(node) => { if (isSelectableCategoryNode(node)) setPendingCategory(treeNodeToCategoryEntry(node)); }}
        pendingEntry={pendingCategory}
        onConfirm={() => {
          if (pendingCategory) {
            applyCategory(pendingCategory);
            setPendingCategory(null);
            setCategoryDrawerOpen(false);
          }
        }}
        onCancel={() => {
          setPendingCategory(null);
          setCategoryDrawerOpen(false);
        }}
        onSyncTree={() => loadCategoryTree(true)}
      />
    </div>
  );
}
