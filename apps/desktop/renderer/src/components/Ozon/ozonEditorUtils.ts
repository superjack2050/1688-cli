import type { OzonCategoryAttribute, OzonDraft } from '../../services/api';
import type { OzonListingTask } from '../Results/ozonListing/types';
import { unique } from '../Results/ozonListing/precheck';

export const ATTR_PRODUCT_NAME = 4180;
export const ATTR_BRAND = 85;
export const ATTR_MODEL = 9048;
export const ATTR_DESCRIPTION = 4191;
export const ATTR_TAGS = 23171;
export const ATTR_WEIGHT = 4497;
export const ATTR_RICH_CONTENT = 11254;
export const CONTROLLED_ATTR_IDS = new Set([
  ATTR_PRODUCT_NAME,
  ATTR_BRAND,
  ATTR_MODEL,
  ATTR_DESCRIPTION,
  ATTR_TAGS,
  ATTR_WEIGHT,
  ATTR_RICH_CONTENT,
]);

export type DraftForm = {
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
  richContent: string;
};

export type DraftBuildResult = {
  draft: OzonDraft;
  firstItem: Record<string, unknown>;
  missing: string[];
  validation: DraftValidationBreakdown;
};

export type DraftValidationBreakdown = {
  main: string[];
  attributes: string[];
  variants: string[];
  payload: string[];
  /** payload errors not locatable in any of the three UI sections — must be empty */
  payloadOnly: string[];
  all: string[];
};

export type AttributeLoadState = 'idle' | 'loading' | 'ready' | 'error';

export type EditorActions = {
  canSave: boolean;
  canValidate: boolean;
  canSubmit: boolean;
  canAiFill: boolean;
};

/**
 * Pure gating rule shared by the bottom bar and the editor handlers.
 * Only `ready` category metadata unlocks save/validate/submit/AI fill;
 * submitting disables every dangerous action, including AI fill.
 */
export function deriveEditorActions(input: {
  attributeLoadState: AttributeLoadState;
  validationState: 'idle' | 'validating' | 'valid' | 'invalid';
  submitting: boolean;
  aiFilling?: boolean;
  hasDraft: boolean;
}): EditorActions {
  const attributeReady = input.attributeLoadState === 'ready';
  const notBusy = !input.submitting;
  return {
    canSave: attributeReady && notBusy && input.hasDraft,
    canValidate: attributeReady && notBusy && input.hasDraft,
    canSubmit: attributeReady && notBusy && input.hasDraft && input.validationState === 'valid',
    canAiFill: attributeReady && notBusy && !input.aiFilling,
  };
}

export type VariantRowView = {
  key: string;
  itemIndex: number;
  skuName: string;
  images: string[];
  offerId: string;
  price: string;
  stock: string;
  values: Record<string, unknown>;
};

export type ImageManagerSession = {
  session: number;
  itemIndex: number;
  single: boolean;
  images: string[];
};

/**
 * The ImageManager must edit exactly what the table row shows. The session
 * snapshots row.images at open time so both views share one source.
 */
export function createImageManagerSession(row: VariantRowView, single: boolean, session = Date.now()): ImageManagerSession {
  return { session, itemIndex: row.itemIndex, single, images: [...row.images] };
}

export function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Detects Han (Chinese) characters in a value. Only the actual characters are
 * matched — full-width digits, CJK punctuation and UI labels are not Han.
 */
export function containsChineseText(value: unknown): boolean {
  return /\p{Script=Han}/u.test(String(value ?? ''));
}

/**
 * Every Chinese-violation message ends with this phrase. Used to separate
 * "cannot save" blockers (syntax/conflicts) from validation-only violations
 * (Chinese text must NOT block saving a draft).
 */
export function isChineseTextViolationMessage(message: string): boolean {
  return message.endsWith('不能包含中文');
}

export function numberText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? String(number) : text(value);
}

export function positiveInteger(value: string): number {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : 0;
}

/**
 * Strict user-input measurement parser. Rejects anything that is not a plain
 * positive decimal number — `-500`, `abc10`, `10mm` and `0` are all invalid.
 * Do NOT use `positiveInteger` for editor form values: its regex extracts
 * digits from garbage, silently turning -500 into 500.
 */
export function parseStrictPositiveMeasurement(value: string): number | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

/**
 * Strict measurement for the payload. Invalid input yields 0 (validation
 * blocks save/submit anyway), valid decimals are rounded up to a whole
 * millimeter/gram. 12.5 → 13.
 */
export function measurementIntegerForPayload(value: string): number {
  const parsed = parseStrictPositiveMeasurement(value);
  if (parsed === null) return 0;
  return Math.max(1, Math.round(parsed));
}

export function priceForPayload(value: string, fallback = '1'): string {
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return fallback;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return fallback;
  return String(Math.max(number, fallback === '0' ? 0 : 1));
}

export function intForPayload(value: string): number {
  const number = Number(String(value || '').trim());
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/**
 * User-input price validity: an empty, zero or negative price is never a
 * valid price, regardless of any payload-level defensive normalization.
 */
export function isValidPositivePrice(value: string): boolean {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0;
}

export function lengthToMillimeter(value: unknown, sourceUnit: string): string {
  const number = Number(numberText(value));
  if (!Number.isFinite(number) || number <= 0) return '';
  return sourceUnit === 'cm' ? String(Math.round(number * 10)) : String(Math.round(number));
}

export function lineList(value: string): string[] {
  return unique(
    String(value || '')
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function normalizeImageUrl(value: string): string {
  const url = value.trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export function imageLinesFromItem(item: Record<string, unknown>, task: OzonListingTask): string {
  const values = Array.isArray(item.images) ? item.images : [];
  const urls = values.map((value) => normalizeImageUrl(text(value))).filter(Boolean);
  const primary = normalizeImageUrl(text(item.primary_image || task.image));
  if (primary && !urls.includes(primary)) urls.unshift(primary);
  return urls.slice(0, 15).join('\n');
}

export function attributeValue(item: Record<string, unknown>, attrId: number): string {
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

export function attributeValuesById(item: Record<string, unknown>): Record<string, string> {
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

export type DictionaryValueIds = Record<string, Record<string, number>>;

export function attributeDictionaryIdsById(item: Record<string, unknown>): DictionaryValueIds {
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

function removeCjk(value: string): string {
  return value.replace(/[㐀-鿿]+/g, '').trim();
}

export function formatTagsForUi(value: string): string {
  return unique(
    String(value || '')
      .replace(/,/g, '\n')
      .split(/\r?\n/)
      .map((line) => removeCjk(line.trim().replace(/^#|^＃/, '').trim()))
      .filter(Boolean)
      .map((line) => `#${line}`),
  ).join('\n');
}

export function normalizeTagsForPayload(value: string): string {
  return unique(
    String(value || '')
      .replace(/,/g, '\n')
      .split(/\r?\n/)
      .map((line) => removeCjk(line.trim().replace(/^#|^＃/, '').trim()))
      .filter(Boolean),
  ).join('\n');
}

export function buildAttribute(attrId: number, value: string, dictionaryIds?: Record<string, number>): Record<string, unknown> | null {
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

/**
 * Attributes that carry a single opaque value (e.g. Rich Content JSON) must
 * never be split on newlines. The whole trimmed string is one value.
 */
export function buildSingleValueAttribute(attrId: number, value: string): Record<string, unknown> | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return {
    id: attrId,
    complex_id: 0,
    values: [{ value: normalized }],
  };
}

/**
 * Rich Content must be a single valid JSON document (object or array).
 * Empty input is valid (attribute simply omitted). Invalid JSON reports a
 * user-facing error instead of silently mangling the payload.
 */
export function normalizeRichContentJson(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { ok: true, value: '' };
  try {
    const parsed = JSON.parse(trimmed);
    return { ok: true, value: JSON.stringify(parsed) };
  } catch {
    return { ok: false, error: 'Rich Content JSON 格式无效' };
  }
}

export function parseCustomAttributes(value: string): Record<string, unknown>[] {
  return parseCustomAttributesDetailed(value, []).attributes;
}

export type CustomAttributeParseResult = {
  attributes: Record<string, unknown>[];
  errors: string[];
  conflicts: number[];
};

/**
 * Parse `ID=value` lines. Controlled attributes (brand/model/weight/...)
 * and attributes of the current category are rejected as conflicts — the
 * user must use the dedicated editors for those. Duplicate ids are dropped.
 */
export function parseCustomAttributesDetailed(
  value: string,
  categoryAttributes: Array<{ id: number }>,
): CustomAttributeParseResult {
  const attributes: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const conflicts: number[] = [];
  const seen = new Set<number>();
  const categoryIds = new Set(categoryAttributes.map((attr) => attr.id));

  for (const line of String(value || '').split(/\r?\n/)) {
    const normalizedLine = line.trim();
    if (!normalizedLine) continue;
    if (!normalizedLine.includes('=')) {
      errors.push(`自定义属性行格式无效：${normalizedLine}`);
      continue;
    }
    const [rawId, ...valueParts] = normalizedLine.split('=');
    const attrId = Number(rawId.trim());
    if (!Number.isFinite(attrId) || attrId <= 0) {
      errors.push(`自定义属性行格式无效：${normalizedLine}`);
      continue;
    }
    const id = Math.round(attrId);
    const attrValue = valueParts.join('=').trim();
    if (!attrValue) {
      errors.push(`属性 ${id} 缺少值`);
      continue;
    }
    if (containsChineseText(attrValue)) {
      errors.push(`属性 ${id} 不能包含中文`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`属性 ${id} 重复填写`);
      continue;
    }
    seen.add(id);
    if (CONTROLLED_ATTR_IDS.has(id)) {
      conflicts.push(id);
      errors.push(`属性 ${id} 已有专用编辑字段，请勿在自定义属性中重复填写。`);
      continue;
    }
    if (categoryIds.has(id)) {
      conflicts.push(id);
      errors.push(`属性 ${id} 属于当前类目属性，请在“填写更多属性”中编辑。`);
      continue;
    }
    const attr = buildAttribute(id, attrValue);
    if (attr) attributes.push(attr);
  }

  return { attributes, errors, conflicts };
}

export function buildDynamicAttributes(
  dynamicValues: Record<string, string>,
  categoryAttributes: Array<{ id: number }>,
  dictionaryValueIds: DictionaryValueIds,
  allowUnknownCategoryAttributes = false,
): Record<string, unknown>[] {
  const knownIds = new Set(categoryAttributes.map((attr) => attr.id));
  // When category metadata is unknown (not loaded / load failed), carrying
  // stale dynamic attributes from a previous category is unsafe: the editor
  // must not build them into a submittable payload.
  if (!allowUnknownCategoryAttributes && knownIds.size === 0) return [];
  const attrs: Record<string, unknown>[] = [];
  const seen = new Set<number>();

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

/**
 * Build the final attributes array for a draft item.
 *
 * - Preserved: original unmanaged attributes that belong to the current
 *   category (never carried over from a previously selected category).
 * - Controlled: brand / model / weight / description / tags / rich content,
 *   plus product name (4180) ONLY when the current category metadata
 *   actually declares attribute 4180 — its value always mirrors form.name.
 * - Dynamic: category attributes the user edited in the editor.
 * - Custom: `ID=value` lines the user typed in the advanced section; lines
 *   conflicting with controlled/category attributes are excluded here and
 *   surfaced as validation errors instead.
 */
export type BuildAttributesOptions = {
  attributeMetadataReady?: boolean;
};

export function buildAttributes(
  baseItem: Record<string, unknown>,
  form: DraftForm,
  dynamicValues: Record<string, string>,
  categoryAttributes: Array<{ id: number }>,
  dictionaryValueIds: DictionaryValueIds,
  options: BuildAttributesOptions = {},
): Record<string, unknown>[] {
  const attributeMetadataReady = options.attributeMetadataReady !== false;
  const custom = parseCustomAttributesDetailed(form.customAttributes, categoryAttributes);
  const customAttrs = custom.attributes;
  const dynamicAttrs = buildDynamicAttributes(dynamicValues, categoryAttributes, dictionaryValueIds);
  const customIds = new Set(customAttrs.map((attr) => Number(attr.id)).filter(Boolean));
  const dynamicIds = new Set(dynamicAttrs.map((attr) => Number(attr.id)).filter(Boolean));
  const categoryIds = new Set(categoryAttributes.map((attr) => attr.id));
  const baseAttrs = Array.isArray(baseItem.attributes) ? baseItem.attributes : [];
  const preserved = baseAttrs
    .map(objectOf)
    .filter((attr) => {
      const attrId = Number(attr.id);
      if (attrId <= 0 || CONTROLLED_ATTR_IDS.has(attrId)) return false;
      if (customIds.has(attrId) || dynamicIds.has(attrId)) return false;
      // Unmanaged attributes are only carried over when the current
      // category metadata actually declares them. Ready-but-empty metadata
      // (attributes=[]) must NOT preserve stale attributes from a previous
      // category; unknown metadata must not leak them into the draft either.
      if (!attributeMetadataReady) return false;
      return categoryIds.has(attrId);
    });

  const productNameAttr = categoryIds.has(ATTR_PRODUCT_NAME)
    ? buildAttribute(ATTR_PRODUCT_NAME, form.name)
    : null;
  const richContent = normalizeRichContentJson(form.richContent);
  const weight = measurementIntegerForPayload(form.weight);
  const controlled = [
    productNameAttr,
    buildAttribute(ATTR_BRAND, form.brand, dictionaryValueIds[String(ATTR_BRAND)]),
    buildAttribute(ATTR_MODEL, form.model),
    buildAttribute(ATTR_WEIGHT, String(weight)),
    buildAttribute(ATTR_DESCRIPTION, form.description),
    buildAttribute(ATTR_TAGS, normalizeTagsForPayload(form.tags)),
    buildSingleValueAttribute(ATTR_RICH_CONTENT, richContent.ok ? richContent.value : form.richContent.trim()),
  ].filter(Boolean) as Record<string, unknown>[];

  return [...preserved, ...controlled, ...dynamicAttrs, ...customAttrs];
}

export function collectProductPageMissing(form: DraftForm): string[] {
  const missing: string[] = [];
  if (!form.name.trim()) missing.push('俄语标题');
  if (!form.categoryPath.trim() || !intForPayload(form.descriptionCategoryId) || !intForPayload(form.typeId)) missing.push('类目和类型');
  if (!form.offerId.trim()) missing.push('货号');
  if (!isValidPositivePrice(form.price)) missing.push('价格');
  if (parseStrictPositiveMeasurement(form.depth) === null) missing.push('包装长度');
  if (parseStrictPositiveMeasurement(form.width) === null) missing.push('包装宽度');
  if (parseStrictPositiveMeasurement(form.height) === null) missing.push('包装高度');
  if (parseStrictPositiveMeasurement(form.weight) === null) missing.push('含包装重量');
  return missing;
}

export function isMediaAttributeName(attr: OzonCategoryAttribute): boolean {
  const name = `${attr.name} ${attr.description} ${attr.groupName}`.toLowerCase();
  return /video|rich|pdf|json|image|picture|видео|медиа|изображ|фото|富内容|视频|图片|封面|pdf/i.test(name);
}

/**
 * Required media attributes (video/pdf/etc.) must never silently disappear:
 * they stay visible in "填写更多属性" and block submission until the editor
 * supports them. Optional media attributes may stay hidden. Rich Content is
 * excluded — it has a dedicated editor.
 */
export function collectUnsupportedRequiredMediaAttributes(
  attrs: OzonCategoryAttribute[],
): OzonCategoryAttribute[] {
  return attrs.filter(
    (attr) => attr.isRequired && !CONTROLLED_ATTR_IDS.has(attr.id) && isMediaAttributeName(attr),
  );
}

export function filterCategoryAttributesForMoreAttrs(
  attrs: OzonCategoryAttribute[],
  variantDimensionAttrIds: Set<number>,
): OzonCategoryAttribute[] {
  return attrs
    .filter((attr) => !CONTROLLED_ATTR_IDS.has(attr.id))
    .filter((attr) => !isMediaAttributeName(attr) || attr.isRequired)
    .filter((attr) => !variantDimensionAttrIds.has(attr.id));
}

export function collectHiddenRequiredAttributes(
  moreAttrs: OzonCategoryAttribute[],
  dynamicValues: Record<string, string>,
): OzonCategoryAttribute[] {
  return moreAttrs.filter(
    (attr) => attr.isRequired && !text(dynamicValues[String(attr.id)]),
  );
}

/**
 * Drop dynamic attribute values that no longer belong to the current
 * category. Controlled attributes (brand/model/description/tags/weight/
 * rich content/product name) are never dropped.
 */
export function pruneDynamicValuesForCategory(
  dynamicValues: Record<string, string>,
  categoryAttributes: Array<{ id: number }>,
): Record<string, string> {
  const categoryIds = new Set(categoryAttributes.map((attr) => attr.id));
  const next: Record<string, string> = {};
  for (const [rawId, value] of Object.entries(dynamicValues)) {
    const attrId = Number(rawId);
    if (!attrId || CONTROLLED_ATTR_IDS.has(attrId) || categoryIds.has(attrId)) {
      next[rawId] = value;
    }
  }
  return next;
}

export function collectAttributeMissing(
  form: DraftForm,
  dynamicValues: Record<string, string>,
  attrs: Array<{ id: number; isRequired: boolean; name: string }>,
): string[] {
  const missing: string[] = [];
  if (!form.model.trim()) missing.push('型号名称');
  for (const attr of attrs) {
    if (!attr.isRequired) continue;
    if (!text(dynamicValues[String(attr.id)])) missing.push(attr.name || `属性 ${attr.id}`);
  }
  return unique(missing);
}

/**
 * Defensive payload-level validator. Uses the SAME canonical labels as the
 * UI sections (main/variants) so `validation.all` never counts an error
 * twice and every payload error is locatable in one of the three sections.
 */
export function collectPayloadMissing(
  draft: OzonDraft,
  items: Record<string, unknown>[],
  attributeMissing: string[],
): string[] {
  const missing = new Set<string>(attributeMissing);
  items.forEach((item, index) => {
    if (!text(item.name)) missing.add('俄语标题');
    if (!text(item.primary_image)) missing.add(index === 0 ? '主图' : `SKU ${index + 1} 主图`);
    if (!Number(item.description_category_id) || !Number(item.type_id)) missing.add('类目和类型');
    if (!Number(item.price)) missing.add(index === 0 ? '价格' : `SKU ${index + 1} 价格`);
  });
  return Array.from(missing);
}

/**
 * Variant-specific problems with canonical labels: the first SKU's primary
 * image is simply '主图', every following SKU gets a labeled 'SKU N ...'
 * entry, plus an unconfirmed variant dimension mapping for multi-SKU drafts.
 */
export function collectVariantViewMissing(
  items: Record<string, unknown>[],
  draft?: OzonDraft,
): string[] {
  const missing: string[] = [];
  if (items.length > 0 && !text(items[0].primary_image)) missing.push('主图');
  for (let index = 1; index < items.length; index++) {
    const item = items[index];
    const label = `SKU ${index + 1}`;
    if (!text(item.name)) missing.push(`${label} 名称`);
    if (!text(item.primary_image)) missing.push(`${label} 主图`);
    if (!Number(item.price)) missing.push(`${label} 价格`);
  }
  if (draft) {
    const variant = variantOf(draft);
    if (variantHasUnconfirmedMapping(draft, variant)) missing.push('规格属性映射');
  }
  return missing;
}

/**
 * Errors that block even saving a draft: malformed Rich Content JSON and
 * custom attribute syntax/conflict errors. Missing required fields do NOT
 * block saving — the user must be able to persist an incomplete draft.
 * Chinese-text violations are validation-only: a draft with Chinese free
 * text must still be savable (validation and submit are the hard gates).
 */
export function collectDraftBlockers(
  form: DraftForm,
  customCategoryAttributes: Array<{ id: number }>,
): string[] {
  const errors: string[] = [];
  const richContent = normalizeRichContentJson(form.richContent);
  if (!richContent.ok) errors.push(richContent.error);
  const custom = parseCustomAttributesDetailed(form.customAttributes, customCategoryAttributes);
  errors.push(...custom.errors.filter((error) => !isChineseTextViolationMessage(error)));
  return unique(errors);
}

/**
 * Chinese-text violations grouped by the right-side section they belong to.
 * `main` → 主要信息, `attributes` → 产品属性.
 */
export type ChineseTextViolations = {
  main: string[];
  attributes: string[];
};

/**
 * Canonical error text shared by the UI section, the payload defensive
 * validator and the tests — identical strings so `unique()` never counts
 * one violation twice across buckets.
 */
export function chineseViolationLabelFor(attrId: number, attrName: string): string {
  const label: Record<number, string> = {
    [ATTR_PRODUCT_NAME]: '商品标题不能包含中文',
    [ATTR_BRAND]: '品牌不能包含中文',
    [ATTR_MODEL]: '型号名称不能包含中文',
    [ATTR_DESCRIPTION]: '商品描述不能包含中文',
    [ATTR_TAGS]: '主题标签不能包含中文',
    [ATTR_RICH_CONTENT]: 'Rich Content 不能包含中文',
  };
  return label[attrId] || (attrName ? `${attrName}不能包含中文` : `属性 ${attrId} 不能包含中文`);
}

function categoryAttributeOf(
  categoryAttributes: OzonCategoryAttribute[],
  attrId: number,
): OzonCategoryAttribute | undefined {
  return categoryAttributes.find((attr) => attr.id === attrId);
}

/**
 * UI-level collector. Scans ONLY free-text fields that will be submitted to
 * Ozon as raw text:
 *
 * - main:   商品标题 (form.name)
 * - attributes: 型号/描述/主题标签/自由文本品牌/Rich Content/
 *               non-dictionary dynamic attributes/custom attribute values
 *
 * Dictionary attributes (dictionaryId > 0) are exempt: their Chinese text is
 * only a UI display label — the real payload is `dictionary_value_id`.
 * Brand follows the same rule via its category metadata. categoryPath and
 * shopLabel are UI-only information and are never scanned.
 */
export function collectChineseTextViolations(
  form: DraftForm,
  dynamicValues: Record<string, string>,
  categoryAttributes: OzonCategoryAttribute[],
): ChineseTextViolations {
  const main: string[] = [];
  const attributes: string[] = [];

  if (containsChineseText(form.name)) main.push(chineseViolationLabelFor(ATTR_PRODUCT_NAME, '商品标题'));
  if (containsChineseText(form.model)) attributes.push(chineseViolationLabelFor(ATTR_MODEL, '型号名称'));
  if (containsChineseText(form.description)) attributes.push(chineseViolationLabelFor(ATTR_DESCRIPTION, '商品描述'));
  if (containsChineseText(form.tags)) attributes.push(chineseViolationLabelFor(ATTR_TAGS, '主题标签'));

  const richContent = String(form.richContent || '').trim();
  if (richContent && containsChineseText(richContent)) {
    attributes.push(chineseViolationLabelFor(ATTR_RICH_CONTENT, 'Rich Content'));
  }

  const brandAttribute = categoryAttributeOf(categoryAttributes, ATTR_BRAND);
  const brandIsDictionary = Number(brandAttribute?.dictionaryId || 0) > 0;
  if (!brandIsDictionary && containsChineseText(form.brand)) {
    attributes.push(chineseViolationLabelFor(ATTR_BRAND, '品牌'));
  }

  for (const attr of categoryAttributes) {
    if (CONTROLLED_ATTR_IDS.has(attr.id)) continue;
    if (Number(attr.dictionaryId || 0) > 0) continue;
    if (containsChineseText(dynamicValues[String(attr.id)])) {
      attributes.push(chineseViolationLabelFor(attr.id, attr.name));
    }
  }

  const custom = parseCustomAttributesDetailed(form.customAttributes, categoryAttributes);
  for (const error of custom.errors) {
    if (isChineseTextViolationMessage(error)) attributes.push(error);
  }

  return { main: unique(main), attributes: unique(attributes) };
}

/**
 * Defensive payload-level validator. Scans exactly the free text that will
 * be submitted to Ozon:
 *
 * - item.name
 * - item.attributes[].values[].value — unless the value carries a valid
 *   dictionary_value_id (> 0), because then the Chinese text is only a UI
 *   label and the real payload is the dictionary id.
 *
 * Never scans sourceRows, generated debug data, matched_category.path,
 * messages or any internal metadata.
 */
export function collectPayloadChineseViolations(
  items: Record<string, unknown>[],
  categoryAttributes: Array<{ id: number; name: string }> = [],
): string[] {
  const violations: string[] = [];
  const categoryNameById = new Map(categoryAttributes.map((attr) => [attr.id, attr.name]));

  for (const item of items) {
    if (containsChineseText(item.name)) {
      violations.push(chineseViolationLabelFor(ATTR_PRODUCT_NAME, '商品标题'));
    }
    const attributes = Array.isArray(item.attributes) ? item.attributes : [];
    for (const rawAttr of attributes) {
      const attr = objectOf(rawAttr);
      const attrId = Number(attr.id);
      if (!attrId) continue;
      const attrName = categoryNameById.get(attrId) || '';
      const values = Array.isArray(attr.values) ? attr.values : [];
      for (const rawValue of values) {
        const value = objectOf(rawValue);
        if (Number(value.dictionary_value_id || 0) > 0) continue;
        if (containsChineseText(value.value)) {
          violations.push(chineseViolationLabelFor(attrId, attrName));
        }
      }
    }
  }

  return unique(violations);
}

/**
 * UI locator adapter: converts the business validation breakdown into
 * locatable issues. The validator stays the single source of truth —
 * an issue only exists for strings present in `validation.all`.
 */
export type ValidationTargetExpand = 'moreAttributes' | 'advanced' | null;

export type EditorValidationIssue = {
  id: string;
  /** canonical business message (exactly as it appears in validation.all) */
  message: string;
  /** human-friendly message shown in the issue list */
  displayMessage?: string;
  section: 'main' | 'attributes' | 'variants';
  targetKey: string;
  expand?: ValidationTargetExpand;
  /** false when the target has no meaningful focusable control */
  focus?: boolean;
};

export function validationSectionLabel(section: 'main' | 'attributes' | 'variants'): string {
  if (section === 'main') return '主要信息';
  if (section === 'attributes') return '产品属性';
  return '变体设置';
}

type FixedTarget = Pick<EditorValidationIssue, 'message' | 'section' | 'targetKey' | 'displayMessage' | 'expand'>;

const FIXED_VALIDATION_TARGETS: FixedTarget[] = [
  { message: '俄语标题', section: 'main', targetKey: 'main:name', displayMessage: '俄语标题不能为空' },
  { message: '商品标题不能包含中文', section: 'main', targetKey: 'main:name' },
  { message: '类目和类型', section: 'main', targetKey: 'main:category', displayMessage: '请选择带 type_id 的 Ozon 末级类目' },
  { message: '货号', section: 'main', targetKey: 'main:offerId', displayMessage: '货号不能为空' },
  { message: '价格', section: 'main', targetKey: 'main:price', displayMessage: '价格必须大于 0' },
  { message: '包装长度', section: 'main', targetKey: 'main:depth', displayMessage: '包装长度必须大于 0' },
  { message: '包装宽度', section: 'main', targetKey: 'main:width', displayMessage: '包装宽度必须大于 0' },
  { message: '包装高度', section: 'main', targetKey: 'main:height', displayMessage: '包装高度必须大于 0' },
  { message: '含包装重量', section: 'main', targetKey: 'main:weight', displayMessage: '重量必须大于 0' },
  { message: '品牌不能包含中文', section: 'main', targetKey: 'main:brand' },
  { message: '型号名称', section: 'attributes', targetKey: 'attributes:model', displayMessage: '型号名称不能为空' },
  { message: '型号名称不能包含中文', section: 'attributes', targetKey: 'attributes:model' },
  { message: '主题标签不能包含中文', section: 'attributes', targetKey: 'attributes:tags' },
  { message: '商品描述不能包含中文', section: 'attributes', targetKey: 'attributes:description' },
  { message: 'Rich Content JSON 格式无效', section: 'attributes', targetKey: 'advanced:rich-content', expand: 'advanced' },
  { message: 'Rich Content 不能包含中文', section: 'attributes', targetKey: 'advanced:rich-content', expand: 'advanced' },
  { message: '主图', section: 'variants', targetKey: 'variant:0:image', displayMessage: '主图不能为空' },
  { message: '规格属性映射', section: 'variants', targetKey: 'variant:mapping', displayMessage: '规格属性映射未确认' },
];

const FIXED_TARGET_BY_MESSAGE = new Map(FIXED_VALIDATION_TARGETS.map((item) => [item.message, item]));

const CUSTOM_ATTR_ERROR_RE = /^属性 \d+ (缺少值|重复填写|不能包含中文|已有专用编辑字段|属于当前类目属性)/;
const CUSTOM_LINE_ERROR_RE = /^自定义属性行格式无效/;
const SKU_LABEL_RE = /^SKU (\d+) (名称|主图|价格)$/;
const SKU_CELL_KEY: Record<string, string> = { '名称': 'name', '主图': 'image', '价格': 'price' };
const MEDIA_ATTR_ERROR_RE = /^该 Ozon 类目要求媒体属性 (.+?)，当前编辑器暂不支持直接填写/;
const METADATA_BLOCKER_RE = /^(类目属性尚未加载完成|Ozon 类目属性加载失败)/;

/**
 * Build the locatable issue list from the last validation result.
 *
 * Matching order: exact fixed-field map → custom attribute errors →
 * SKU labels → unsupported media → dynamic attributes (by attr id) →
 * category metadata blockers → section fallback. Every entry in
 * validation.all gets exactly one issue, in the same order.
 */
export function buildEditorValidationIssues(
  validation: DraftValidationBreakdown,
  context: {
    categoryAttributes: OzonCategoryAttribute[];
    moreCategoryAttributes: OzonCategoryAttribute[];
    variantRows?: VariantRowView[];
  },
): EditorValidationIssue[] {
  const issues: EditorValidationIssue[] = [];

  const renderedAttrs = context.moreCategoryAttributes.filter((attr) => !CONTROLLED_ATTR_IDS.has(attr.id));
  const attrIdsByName = new Map<string, number[]>();
  for (const attr of renderedAttrs) {
    const ids = attrIdsByName.get(attr.name) || [];
    ids.push(attr.id);
    attrIdsByName.set(attr.name, ids);
  }
  const attrById = new Map(renderedAttrs.map((attr) => [attr.id, attr]));

  const sectionFallback = (message: string, section: 'main' | 'attributes' | 'variants'): EditorValidationIssue => ({
    id: `${section}:section:${issues.length}`,
    message,
    section,
    targetKey: `section:${section}`,
    focus: false,
  });

  const dynamicTarget = (name: string, displayMessage: string, message: string): EditorValidationIssue | null => {
    const ids = attrIdsByName.get(name) || [];
    if (ids.length !== 1) return null; // unknown or ambiguous name → caller decides
    const attr = attrById.get(ids[0]);
    if (!attr) return null;
    return {
      id: `attr:${attr.id}:${issues.length}`,
      message,
      displayMessage,
      section: 'attributes',
      targetKey: `attr:${attr.id}`,
      expand: 'moreAttributes',
    };
  };

  for (const message of validation.all) {
    let issue: EditorValidationIssue | undefined;

    const fixed = FIXED_TARGET_BY_MESSAGE.get(message);
    if (fixed) {
      issue = { ...fixed, id: `${fixed.targetKey}:${issues.length}`, message };
    } else if (CUSTOM_LINE_ERROR_RE.test(message) || CUSTOM_ATTR_ERROR_RE.test(message)) {
      issue = {
        id: `advanced:custom:${issues.length}`,
        message,
        section: 'attributes',
        targetKey: 'advanced:custom',
        expand: 'advanced',
      };
    } else if (SKU_LABEL_RE.test(message)) {
      const match = message.match(SKU_LABEL_RE)!;
      const index = Number(match[1]) - 1;
      const cell = SKU_CELL_KEY[match[2]];
      issue = {
        id: `variant:${index}:${cell}:${issues.length}`,
        message,
        displayMessage: cell === 'price' ? `${message}必须大于 0` : `${message}不能为空`,
        section: 'variants',
        targetKey: `variant:${index}:${cell}`,
      };
    } else {
      const media = message.match(MEDIA_ATTR_ERROR_RE);
      if (media) {
        issue = dynamicTarget(media[1], message, message)
          || sectionFallback(message, 'attributes');
      } else if (message.endsWith('不能包含中文')) {
        issue = dynamicTarget(message.slice(0, -'不能包含中文'.length), message, message)
          || sectionFallback(message, 'attributes');
      } else if (METADATA_BLOCKER_RE.test(message)) {
        issue = sectionFallback(message, 'attributes');
      } else {
        const attrIds = attrIdsByName.get(message) || [];
        if (attrIds.length === 1) {
          const attr = attrById.get(attrIds[0])!;
          issue = {
            id: `attr:${attr.id}:${issues.length}`,
            message,
            displayMessage: `${attr.name}不能为空`,
            section: 'attributes',
            targetKey: `attr:${attr.id}`,
            expand: 'moreAttributes',
          };
        } else {
          // Unknown or ambiguous message: guess the section, never drop it.
          const section = message.startsWith('SKU')
            ? 'variants'
            : validation.attributes.includes(message) || validation.main.includes(message)
              ? (validation.main.includes(message) ? 'main' : 'attributes')
              : 'variants';
          issue = sectionFallback(message, section);
        }
      }
    }

    issues.push(issue!);
  }

  return issues;
}

/**
 * Single source of truth for the editor's final missing list.
 *
 * - main:      主要信息 (product page fields + 商品标题中文)
 * - attributes:产品属性 (model, required category attrs, rich content,
 *              custom attribute syntax/conflicts, Chinese free-text
 *              violations, unsupported required media, category metadata
 *              blockers)
 * - variants:  变体设置 (per-SKU problems + unconfirmed mapping)
 * - payload:   payload-level invariants (title/image/category/price +
 *              defensive Chinese free-text scan)
 *
 * `all` is the union of every bucket and equals the missing list used for
 * badges, validate, save status and submit gating.
 */
export function validateDraftForEditor(
  form: DraftForm,
  draft: OzonDraft,
  items: Record<string, unknown>[],
  dynamicValues: Record<string, string>,
  requiredAttrs: OzonCategoryAttribute[],
  categoryAttributes: OzonCategoryAttribute[],
  attributeMetadataMessage: string,
): DraftValidationBreakdown {
  const unsupportedMedia = collectUnsupportedRequiredMediaAttributes(requiredAttrs);
  const unsupportedMediaIds = new Set(unsupportedMedia.map((attr) => attr.id));
  const chinese = collectChineseTextViolations(form, dynamicValues, categoryAttributes);

  const main = unique([
    ...collectProductPageMissing(form),
    ...chinese.main,
  ]);
  const attributes = unique([
    ...collectAttributeMissing(form, dynamicValues, requiredAttrs.filter((attr) => !unsupportedMediaIds.has(attr.id))),
    ...collectDraftBlockers(form, categoryAttributes),
    ...chinese.attributes,
    ...unsupportedMedia.map((attr) => `该 Ozon 类目要求媒体属性 ${attr.name}，当前编辑器暂不支持直接填写，请勿提交。`),
    ...(attributeMetadataMessage ? [attributeMetadataMessage] : []),
  ]);
  const variants = collectVariantViewMissing(items, draft);
  const payload = unique([
    ...collectPayloadMissing(draft, items, []),
    ...collectPayloadChineseViolations(items, categoryAttributes),
  ]);
  const sectionUnion = unique([...main, ...attributes, ...variants]);
  const payloadOnly = unique(payload.filter((item) => !sectionUnion.includes(item)));
  const all = unique([...main, ...attributes, ...variants, ...payload]);

  return { main, attributes, variants, payload, payloadOnly, all };
}

export function variantOf(draft?: OzonDraft): Record<string, unknown> {
  if (!draft) return {};
  const generated = objectOf(draft.generated);
  const root = objectOf(draft.variant);
  return Object.keys(root).length ? root : objectOf(generated.variant_mapping);
}

export function variantRows(variant: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(variant.variants) ? variant.variants.map(objectOf).filter(Boolean) : [];
}

export function variantDimensions(variant: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(variant.dimensions) ? variant.dimensions.map(objectOf).filter(Boolean) : [];
}

export function variantImageListFromItem(item: Record<string, unknown>): string[] {
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

function variantHasUnconfirmedMapping(draft: OzonDraft, variant: Record<string, unknown>): boolean {
  const rows = Array.isArray(draft.sourceRows) ? draft.sourceRows : [];
  if (rows.length <= 1) return false;
  if (variant.confirmed === true) return false;
  const status = text(variant.status);
  if (status === 'confirmed' || status === 'not_required') return false;
  return true;
}

/**
 * Resolve the item index for a variant row with an explicit, non-accidental
 * fallback: `Number(undefined)` is NaN and `NaN ?? index` stays NaN, which
 * poisoned item lookups. The index must also be inside the items array.
 */
export function resolveVariantItemIndex(row: Record<string, unknown>, fallbackIndex: number, itemCount?: number): number {
  const rawItemIndex = Number(row.item_index);
  if (Number.isInteger(rawItemIndex) && rawItemIndex >= 0 && (itemCount === undefined || rawItemIndex < itemCount)) {
    return rawItemIndex;
  }
  return fallbackIndex;
}

export function buildVariantTableView(
  task: OzonListingTask,
  draft: OzonDraft | undefined,
  firstItem: Record<string, unknown>,
  variantImageEdits: Record<string, string[]> = {},
): { rows: VariantRowView[]; dims: Record<string, unknown>[] } {
  const variant = variantOf(draft);
  const variantRowList = variantRows(variant);
  const dims = variantDimensions(variant);
  if (variantRowList.length) {
    const items = Array.isArray(draft?.items) ? draft.items : [];
    const rows = variantRowList.map((row, index) => {
      const itemIndex = resolveVariantItemIndex(row, index, items.length);
      const item = objectOf(items[itemIndex] ?? items[index]);
      const editedImages = variantImageEdits[String(itemIndex)];
      const images = editedImages
        ? editedImages
        : variantImageListFromItem({ primary_image: row.image || item.primary_image, images: item.images });
      return {
        key: `${text(row.offer_id) || `sku-${index}`}-${index}`,
        itemIndex,
        skuName: text(row.source_sku_name) || text(item.name) || `SKU ${index + 1}`,
        images,
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
  const editedImages = variantImageEdits['0'];
  const images = editedImages ? editedImages : variantImageListFromItem(firstItem);
  return {
    rows: [{
      key: 'single-0',
      itemIndex: 0,
      skuName: text(firstItem.name) || 'SKU 1',
      images,
      offerId: text(firstItem.offer_id),
      price: text(firstItem.price),
      stock,
      values: {},
    }],
    dims: [],
  };
}

export function firstItemOf(task: OzonListingTask): Record<string, unknown> {
  return objectOf(task.draft?.items?.[0]);
}

export function firstRowOf(task: OzonListingTask): Record<string, unknown> {
  return objectOf(task.draft?.sourceRows?.[0]);
}

export function createDraftForm(task: OzonListingTask): DraftForm {
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
    richContent: attributeValue(item, ATTR_RICH_CONTENT),
  };
}

export function buildDraft(
  task: OzonListingTask,
  form: DraftForm,
  dynamicValues: Record<string, string>,
  categoryAttributes: Array<{ id: number; name: string; description: string; groupName: string }>,
  dictionaryValueIds: DictionaryValueIds,
  requiredAttrs: Array<{ id: number; isRequired: boolean; name: string }>,
  variantImageEdits: Record<string, string[]> = {},
  options: { attributeMetadataReady?: boolean; attributeMetadataMessage?: string } = {},
): DraftBuildResult | null {
  if (!task.draft) return null;

  const attributeMetadataReady = options.attributeMetadataReady !== false;
  const attributeMetadataMessage = attributeMetadataReady
    ? ''
    : options.attributeMetadataMessage || '类目属性尚未加载完成';

  const draft = task.draft;
  const sourceItems = draft.items.length ? draft.items : [{}];
  const baseFirst = objectOf(sourceItems[0]);
  const images = lineList(form.images).map(normalizeImageUrl).filter(Boolean).slice(0, 15);
  const descriptionCategoryId = intForPayload(form.descriptionCategoryId);
  const typeId = intForPayload(form.typeId);
  const attributes = buildAttributes(baseFirst, form, dynamicValues, categoryAttributes, dictionaryValueIds, {
    attributeMetadataReady,
  });

  const firstItem: Record<string, unknown> = {
    ...baseFirst,
    name: form.name.trim().slice(0, 500),
    barcode: form.barcode.trim(),
    offer_id: form.offerId.trim().slice(0, 50),
    // An invalid user price is never silently promoted to 1: keep the
    // payload truthful ('0') and let validation block save/submit.
    price: isValidPositivePrice(form.price) ? priceForPayload(form.price, '1') : '0',
    old_price: priceForPayload(form.oldPrice, '0'),
    currency_code: form.currencyCode.trim() || 'CNY',
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    images,
    primary_image: images[0] || '',
    dimension_unit: form.dimensionUnit || 'mm',
    depth: measurementIntegerForPayload(form.depth),
    width: measurementIntegerForPayload(form.width),
    height: measurementIntegerForPayload(form.height),
    weight_unit: form.weightUnit || 'g',
    weight: measurementIntegerForPayload(form.weight),
    attributes,
    complex_attributes: Array.isArray(baseFirst.complex_attributes) ? baseFirst.complex_attributes : [],
    _category_path: form.categoryPath.trim(),
  };

  const nextItems = sourceItems.map((rawItem, index) => {
    const item = index === 0
      ? firstItem
      : {
        ...objectOf(rawItem),
        currency_code: firstItem.currency_code,
        description_category_id: firstItem.description_category_id,
        type_id: firstItem.type_id,
        attributes,
        _category_path: firstItem._category_path,
      };
    const imageEditKey = String(index);
    // A key PRESENT in variantImageEdits means "user edited this SKU's
    // images", even when the array is empty (user deleted all images).
    // An absent key means "never edited" → keep original images.
    if (Object.prototype.hasOwnProperty.call(variantImageEdits, imageEditKey)) {
      const editedImages = variantImageEdits[imageEditKey];
      item.images = [...editedImages];
      item.primary_image = editedImages[0] || '';
    }
    return item;
  });

  const nextDraft: OzonDraft = { ...draft, items: nextItems };
  const validation = validateDraftForEditor(
    form,
    nextDraft,
    nextItems,
    dynamicValues,
    requiredAttrs as OzonCategoryAttribute[],
    categoryAttributes as OzonCategoryAttribute[],
    attributeMetadataMessage,
  );
  const missing = validation.all;
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
      ...nextDraft,
      status: missing.length ? 'needs_review' : 'ready',
      generated,
      items: nextItems,
      missing,
    },
    firstItem,
    missing,
    validation,
  };
}

// ── Category tree search (shared by the drawer and its tests) ──

export interface CategoryTreeViewNode {
  id: string;
  label: string;
  path: string;
  depth: number;
  descriptionCategoryId: number;
  typeId: number;
  selectable: boolean;
  children: CategoryTreeViewNode[];
}

export function filterTreeNodes(nodes: CategoryTreeViewNode[], q: string): CategoryTreeViewNode[] {
  if (!q.trim()) return nodes;
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result: CategoryTreeViewNode[] = [];
  for (const node of nodes) {
    const children = filterTreeNodes(node.children, q);
    const selfMatch = tokens.every((t) =>
      [node.label, node.path, String(node.descriptionCategoryId), String(node.typeId)]
        .join(' ').toLowerCase().includes(t),
    );
    if (selfMatch || children.length) {
      result.push({ ...node, children });
    }
  }
  return result;
}

/**
 * While a search query is active every visible non-leaf node is an ancestor
 * of at least one match — collect those ids so the drawer can auto-expand
 * them without touching the user's permanent expansion state.
 */
export function collectRequiredExpandedIds(nodes: CategoryTreeViewNode[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const node of nodes) {
    if (node.children.length) {
      out[node.id] = true;
      Object.assign(out, collectRequiredExpandedIds(node.children));
    }
  }
  return out;
}
