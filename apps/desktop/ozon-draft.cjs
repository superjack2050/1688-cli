const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getCategoryAttributes, getCategoryAttributeValues } = require('./ozon-settings.cjs');

const ATTR_MODEL_NAME = 9048;
const ATTR_DESCRIPTION = 4191;
const ATTR_TAGS = 23171;
const DEFAULT_IMPORT_POLL_ATTEMPTS = 10;
const DEFAULT_IMPORT_POLL_DELAY_MS = 2000;
const PRODUCT_IMPORT_ITEM_KEYS = new Set([
  'attributes',
  'barcode',
  'color_image',
  'complex_attributes',
  'currency_code',
  'depth',
  'description_category_id',
  'dimension_unit',
  'geo_names',
  'height',
  'images',
  'images360',
  'name',
  'new_description_category_id',
  'offer_id',
  'old_price',
  'pdf_list',
  'price',
  'primary_image',
  'promotions',
  'service_type',
  'type_id',
  'vat',
  'weight',
  'weight_unit',
  'width',
]);

async function generateOzonDraft(settings, rows = []) {
  const sourceRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  if (!sourceRows.length) throw new Error('没有可生成 Ozon 草稿的 1688 SKU 数据。');
  if (!settings.ai.apiKey) throw new Error('DeepSeek API Key 未配置。');

  const categoryContext = resolveCategoryForDraft(settings, sourceRows);

  const generated = await callAi(settings.ai, buildMessages(sourceRows, categoryContext.candidates));
  const normalized = normalizeGenerated(generated, categoryContext.candidates);

  if (categoryContext.exactCategory) {
    normalized.matched_category = categoryContext.exactCategory;
  }

  // Fill category attributes immediately — part of draft generation
  await fillCategoryAttributes(settings, sourceRows, normalized);

  const items = sourceRows.map((row, index) => buildOzonItem(row, normalized, settings, index));
  const variant = buildVariantDraft(sourceRows, items, normalized);
  if (variant) {
    normalized.variant_mapping = variant;
    normalized.variant_mapping_confirmed = variant.confirmed === true;
    applyVariantMetadata(items, variant);
  }
  const missing = collectDraftMissing(items, { sourceRows, generated: normalized, variant });

  process.stderr.write(`[ozon-draft] return: generated keys=${Object.keys(normalized).join(',')} attrValues=${normalized.attribute_values?.length || 0}\n`);

  return {
    draftId: `ozon-draft-${Date.now()}`,
    status: missing.length ? 'needs_review' : 'ready',
    sourceRows,
    generated: normalized,
    variant,
    items,
    missing,
    createdAt: new Date().toISOString(),
  };
}

async function submitOzonDraft(settings, draft, options = {}) {
  if (!settings?.ozon?.clientId || !settings?.ozon?.apiKey) {
    throw new Error('Ozon Client-Id 或 API-Key 未配置。');
  }
  const items = Array.isArray(draft?.items) ? draft.items : [];
  if (!items.length) throw new Error('草稿中没有可提交的 Ozon 商品。');
  const missing = collectDraftMissing(items, draft);
  if (missing.length) throw new Error(`草稿缺少必填项：${missing.join('、')}`);

  await validateRequiredCategoryAttributes(settings, items);

  const importItems = items.map((item) => toOzonImportItem(item));
  const importData = await callOzonSellerApi(settings.ozon, '/v3/product/import', { items: importItems });
  const taskId = extractImportTaskId(importData);
  if (!taskId) {
    throw new Error(`Ozon 导入未返回 task_id：${stringifyForError(importData)}`);
  }

  const importResult = await waitForImportResult(settings.ozon, taskId, options);
  if (importResult.status === 'failed') {
    throw new Error(`Ozon 导入失败：${importResult.errors.join('；') || stringifyForError(importResult.data)}`);
  }

  const submittedAt = new Date().toISOString();
  if (importResult.status === 'pending') {
    return {
      ok: true,
      transport: 'ozon_seller_api',
      operationId: 'ProductAPI_ImportProductsV3',
      taskId,
      importStatus: 'pending',
      importResult: importResult.data,
      warnings: ['Ozon 导入结果仍在处理中，尚未执行价格和库存更新。'],
      submittedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  const priceResult = await updateImportPrices(settings.ozon, importItems);
  const stockPlan = buildStockPayload(settings, draft, importItems);
  const warnings = [];
  let stockResult = null;

  if (stockPlan.stocks.length > 0) {
    if (stockPlan.warehouseId) {
      stockResult = await updateStocks(settings.ozon, stockPlan.stocks);
    } else {
      warnings.push('库存待配置：未设置 Ozon 仓库 ID，已跳过库存更新。');
    }
  }

  return {
    ok: true,
    transport: 'ozon_seller_api',
    operationId: 'ProductAPI_ImportProductsV3',
    taskId,
    importStatus: warnings.length ? 'imported' : 'listing_ready',
    importResult: importResult.data,
    priceResult,
    stockResult,
    warnings,
    submittedAt,
    checkedAt: new Date().toISOString(),
  };
}

async function callOzonSellerApi(ozon, endpoint, body) {
  const response = await fetch(`https://api-seller.ozon.ru${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-Id': ozon.clientId,
      'Api-Key': ozon.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Ozon API ${endpoint} 失败：HTTP ${response.status} ${stringifyForError(data)}`);
  }
  return data;
}

function toOzonImportItem(item) {
  const result = {};
  const source = item && typeof item === 'object' ? item : {};
  for (const [key, value] of Object.entries(source)) {
    if (PRODUCT_IMPORT_ITEM_KEYS.has(key)) result[key] = value;
  }
  return result;
}

async function validateRequiredCategoryAttributes(settings, items) {
  const ozon = settings.ozon;
  const categoryKeys = uniqueStrings(items.map((item) => {
    const desc = Number(item.description_category_id);
    const type = Number(item.type_id);
    return desc && type ? `${desc}:${type}` : '';
  }));
  const missing = [];

  for (const key of categoryKeys) {
    const [descId, typeId] = key.split(':').map(Number);
    const data = await callOzonSellerApi(ozon, '/v1/description-category/attribute', {
      description_category_id: descId,
      type_id: typeId,
      language: 'DEFAULT',
    });
    const requiredAttrs = extractRequiredAttributes(data);
    if (!requiredAttrs.length) continue;

    for (const item of items) {
      if (Number(item.description_category_id) !== descId || Number(item.type_id) !== typeId) continue;
      for (const attr of requiredAttrs) {
        if (!itemHasAttributeValue(item, attr.id)) missing.push(attr.name || `属性 ${attr.id}`);
      }
    }
  }

  const uniqueMissing = uniqueStrings(missing);
  if (uniqueMissing.length) {
    throw new Error(`草稿缺少类目必填属性：${uniqueMissing.join('、')}`);
  }
}

function extractRequiredAttributes(data) {
  const raw = Array.isArray(data?.result) ? data.result
    : Array.isArray(data?.attributes) ? data.attributes
      : Array.isArray(data?.result?.attributes) ? data.result.attributes
        : [];
  return raw
    .map((attr) => ({
      id: Number(attr?.id || attr?.attribute_id),
      name: String(attr?.name || attr?.attribute_name || attr?.id || '').trim(),
      isRequired: attr?.is_required === true || attr?.required === true,
    }))
    .filter((attr) => attr.id > 0 && attr.isRequired);
}

function itemHasAttributeValue(item, attrId) {
  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  for (const rawAttr of attrs) {
    const attr = rawAttr && typeof rawAttr === 'object' ? rawAttr : {};
    if (Number(attr.id || attr.attribute_id) !== Number(attrId)) continue;
    const values = Array.isArray(attr.values) ? attr.values : [];
    if (values.some((value) => {
      const raw = value && typeof value === 'object' ? value.value || value.dictionary_value_id : value;
      return String(raw ?? '').trim();
    })) return true;
  }
  return false;
}

function extractImportTaskId(data) {
  const value = data?.result?.task_id ?? data?.result?.taskId ?? data?.task_id ?? data?.taskId;
  const text = String(value ?? '').trim();
  return text || null;
}

async function waitForImportResult(ozon, taskId, options) {
  const attempts = Math.max(1, Number(options.pollAttempts ?? DEFAULT_IMPORT_POLL_ATTEMPTS));
  const delayMs = Math.max(0, Number(options.pollDelayMs ?? DEFAULT_IMPORT_POLL_DELAY_MS));
  let lastData = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && delayMs > 0) await sleep(delayMs);
    lastData = await callOzonSellerApi(ozon, '/v1/product/import/info', { task_id: Number(taskId) || taskId });
    const analyzed = analyzeImportInfo(lastData);
    if (analyzed.status !== 'pending') return { ...analyzed, data: lastData, attempts: attempt + 1 };
  }

  return { status: 'pending', errors: [], data: lastData, attempts };
}

function analyzeImportInfo(data) {
  const items = extractImportInfoItems(data);
  const errors = collectImportErrors(data, items);
  if (errors.length) return { status: 'failed', errors };
  if (!items.length) return { status: 'pending', errors: [] };

  const statuses = items.map((item) => String(item?.status || item?.state || '').toLowerCase()).filter(Boolean);
  const failed = statuses.some((status) => /fail|error|declin|reject/.test(status));
  if (failed) return { status: 'failed', errors: statuses };

  const pending = statuses.length === 0 || statuses.some((status) => /pending|process|progress|wait|new|importing|validation/.test(status));
  if (pending) return { status: 'pending', errors: [] };

  return { status: 'imported', errors: [] };
}

function extractImportInfoItems(data) {
  if (Array.isArray(data?.result?.items)) return data.result.items;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

function collectImportErrors(data, items = extractImportInfoItems(data)) {
  const errors = [];
  for (const item of items) {
    const status = String(item?.status || item?.state || '').toLowerCase();
    const rawErrors = Array.isArray(item?.errors) ? item.errors : [];
    if (/fail|error|declin|reject/.test(status) && rawErrors.length === 0) {
      errors.push(`${item?.offer_id || item?.offerId || '商品'}: ${item?.status || item?.state}`);
    }
    for (const raw of rawErrors) {
      if (typeof raw === 'string') errors.push(raw);
      else if (raw && typeof raw === 'object') errors.push(String(raw.message || raw.error || raw.code || JSON.stringify(raw)));
    }
  }
  const rootErrors = Array.isArray(data?.result?.errors) ? data.result.errors : Array.isArray(data?.errors) ? data.errors : [];
  for (const raw of rootErrors) {
    if (typeof raw === 'string') errors.push(raw);
    else if (raw && typeof raw === 'object') errors.push(String(raw.message || raw.error || raw.code || JSON.stringify(raw)));
  }
  return uniqueStrings(errors);
}

async function updateImportPrices(ozon, items) {
  const prices = items
    .map((item) => ({
      offer_id: String(item.offer_id || '').trim(),
      price: String(item.price || '').trim(),
      old_price: String(item.old_price ?? '0').trim() || '0',
      currency_code: String(item.currency_code || ozon.currencyCode || 'CNY').trim(),
      vat: String(item.vat ?? '0').trim() || '0',
    }))
    .filter((item) => item.offer_id && Number(item.price) > 0);
  if (!prices.length) throw new Error('价格更新失败：草稿中没有有效的 offer_id 和 price。');
  const data = await callOzonSellerApi(ozon, '/v1/product/import/prices', { prices });
  const errors = collectImportErrors(data);
  if (errors.length) throw new Error(`价格更新失败：${errors.join('；')}`);
  return data;
}

function buildStockPayload(settings, draft, items) {
  const warehouseId = cleanText(settings?.ozon?.defaultWarehouseId);
  const rows = Array.isArray(draft?.sourceRows) ? draft.sourceRows : [];
  const stocks = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const offerId = cleanText(item.offer_id);
    const stock = stockOf(rows[i], item);
    if (!offerId || stock <= 0) continue;
    stocks.push({
      offer_id: offerId,
      stock,
      warehouse_id: Number(warehouseId) || warehouseId,
    });
  }

  return { warehouseId, stocks };
}

async function updateStocks(ozon, stocks) {
  const data = await callOzonSellerApi(ozon, '/v2/products/stocks', { stocks });
  const errors = collectImportErrors(data);
  if (errors.length) throw new Error(`库存更新失败：${errors.join('；')}`);
  return data;
}

function stockOf(row, item) {
  const source = row && typeof row === 'object' ? row : {};
  const values = [
    item?.stock,
    item?.quantity,
    source.sku_stock,
    source.stock,
    source.quantity,
    source.available_stock,
    source.can_book_count,
  ];
  for (const value of values) {
    const number = positiveNumber(value);
    if (number > 0) return Math.max(0, Math.floor(number));
  }
  return 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Category resolution (keyword → Chinese tree) ──

function resolveCategoryForDraft(settings, sourceRows) {
  const keyword = extractSearchKeyword(sourceRows);
  const categoryIndex = loadChineseCategoryIndex(settings);

  const exactCategory = findExactCategoryByKeyword(categoryIndex, keyword);
  if (exactCategory) {
    return { keyword, exactCategory, candidates: [] };
  }

  const candidates = buildCategoryCandidatesByKeyword(categoryIndex, keyword, sourceRows);
  return { keyword, exactCategory: null, candidates };
}

function extractSearchKeyword(sourceRows) {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  const keys = ['search_keyword', 'searchKeyword', 'keyword', 'query', 'search_query', 'searchQuery', 'task_keyword', 'taskKeyword', '_keyword'];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of keys) {
      const value = cleanText(row[key]);
      if (value) return value;
    }
  }
  const first = rows[0] || {};
  return cleanText(first.search_word || first.product_title || first.title || first.sku_name);
}

function loadChineseCategoryIndex(settings) {
  const userDataPath = cleanText(settings?.userDataPath || settings?.paths?.userDataPath || settings?.appDataPath);
  const files = [];
  if (userDataPath) files.push(path.join(userDataPath, 'ozon_category_tree.zh_hans.json'));
  if (process.env.APPDATA) files.push(path.join(process.env.APPDATA, '1688 to Ozon Studio', 'ozon_category_tree.zh_hans.json'));
  for (const file of files) {
    const tree = readJsonFileSafe(file);
    if (!tree) continue;
    const entries = flattenChineseCategoryTree(tree);
    if (entries.length) return entries;
  }
  return [];
}

function flattenChineseCategoryTree(tree) {
  const roots = categoryTreeRoots(tree);
  const result = [];
  for (const root of roots) {
    walkCategoryIndex(root, [], 0, result);
  }
  return result;
}

function walkCategoryIndex(node, parents, inheritedDescriptionCategoryId, result) {
  if (!node || typeof node !== 'object' || node.disabled === true) return;
  const label = cleanText(node.category_name || node.type_name);
  const descriptionCategoryId = toInt(node.description_category_id) || inheritedDescriptionCategoryId || 0;
  const typeId = toInt(node.type_id) || 0;
  const pathParts = label ? [...parents, label] : parents;
  const depth = pathParts.length;
  const pathText = pathParts.join(' / ');
  if (depth === 3 && descriptionCategoryId && typeId && label && !containsCyrillic(pathText)) {
    result.push({
      candidate_index: result.length,
      keyword: label,
      path: pathText,
      description_category_id: descriptionCategoryId,
      type_id: typeId,
      searchText: normalizeCategoryText(`${label} ${pathText} ${descriptionCategoryId} ${typeId}`),
    });
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walkCategoryIndex(child, pathParts, descriptionCategoryId, result);
  }
}

function normalizeCategoryText(value) {
  return String(value || '').trim().toLowerCase().replace(/[｜|／/\\>\-—–_]+/g, ' ').replace(/\s+/g, '');
}

function findExactCategoryByKeyword(categoryIndex, keyword) {
  const normalizedKeyword = normalizeCategoryText(keyword);
  if (!normalizedKeyword) return null;
  const exact = categoryIndex.filter((entry) => normalizeCategoryText(entry.keyword) === normalizedKeyword);
  if (exact.length === 1) return categoryForDraft(exact[0], 'keyword_exact');
  return null;
}

function categoryForDraft(entry, matchSource) {
  return {
    candidate_index: entry.candidate_index,
    description_category_id: entry.description_category_id,
    type_id: entry.type_id,
    path: entry.path,
    path_language: 'ZH_HANS',
    match_source: matchSource || 'ai_candidate',
  };
}

function buildCategoryCandidatesByKeyword(categoryIndex, keyword, sourceRows) {
  const normalizedKeyword = normalizeCategoryText(keyword);
  const titleText = normalizeCategoryText(
    (Array.isArray(sourceRows) ? sourceRows : []).slice(0, 3)
      .map((row) => `${row.product_title || ''} ${row.title || ''} ${row.sku_name || ''}`)
      .join(' ')
  );
  const scored = [];
  for (const entry of categoryIndex) {
    let score = 0;
    const entryName = normalizeCategoryText(entry.keyword);
    const entrySearch = entry.searchText;
    if (normalizedKeyword && entryName.includes(normalizedKeyword)) score += 100;
    if (normalizedKeyword && normalizedKeyword.includes(entryName)) score += 70;
    if (normalizedKeyword && entrySearch.includes(normalizedKeyword)) score += 50;
    for (const ch of new Set(normalizedKeyword.split(''))) {
      if (ch && entrySearch.includes(ch)) score += 1;
    }
    if (titleText && entrySearch.includes(titleText)) score += 10;
    if (score > 0) scored.push({ score, entry });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50).map((item, index) => ({
    candidate_index: index,
    description_category_id: item.entry.description_category_id,
    type_id: item.entry.type_id,
    path: item.entry.path,
    keyword: item.entry.keyword,
  }));
}

// ── AI messages ──

function buildMessages(rows, candidates) {
  const payload = {
    task: 'generate_ozon_listing_from_1688_desktop',
    required_schema: {
      title_ru: 'string, 45-90 chars',
      model_name: 'string',
      description_ru: 'string, Russian, 4 paragraphs',
      tags: ['20 Russian search phrases'],
      matched_category: {
        candidate_index: 'integer or null, must be one of category_candidates[].candidate_index',
      },
      estimated_dimensions: {
        length_cm: 'number',
        width_cm: 'number',
        height_cm: 'number',
        weight_g: 'number',
      },
    },
    rules: candidates.length ? [
      'Return JSON only. No Markdown.',
      'Write natural Russian Ozon listing content from the provided 1688 facts.',
      'Do not keep Chinese text in title_ru, description_ru, or tags.',
      'Do not invent brand, certification, warranty, or exact materials if not present.',
      'If source dimensions are missing, estimate reasonable packed dimensions.',
      'Category selection rule: choose exactly one category_candidates item by candidate_index.',
      'Do not invent description_category_id, type_id, or category path.',
      'Only title_ru, model_name, description_ru, tags, and estimated_dimensions should be generated freely.',
    ] : [
      'Return JSON only. No Markdown.',
      'Write natural Russian Ozon listing content from the provided 1688 facts.',
      'Do not keep Chinese text in title_ru, description_ru, or tags.',
      'Do not invent brand, certification, warranty, or exact materials if not present.',
      'If source dimensions are missing, estimate reasonable packed dimensions.',
      'Return matched_category.candidate_index as null.',
      'Do not invent description_category_id, type_id, or category path.',
      'Only title_ru, model_name, description_ru, tags, and estimated_dimensions should be generated freely.',
    ],
    source_rows: rows.slice(0, 8),
    category_candidates: candidates,
  };
  return [
    { role: 'system', content: 'You are a Russian Ozon marketplace product card editor. Generate compliant JSON only.' },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

async function callAi(ai, messages) {
  const endpoint = chatEndpoint(ai.baseUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ai.model || 'deepseek-chat',
      messages,
      temperature: 0.35,
      response_format: { type: 'json_object' },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI 生成失败：HTTP ${response.status} ${JSON.stringify(data)}`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 响应为空。');
  return parseJsonObject(content);
}

function chatEndpoint(baseUrl) {
  const url = String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/v1')) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 未返回 JSON 对象。');
  return JSON.parse(match[0]);
}

function normalizeGenerated(data, candidates) {
  const matched = data?.matched_category && typeof data.matched_category === 'object'
    ? data.matched_category
    : {};
  const candidateIndex = toCandidateIndex(matched.candidate_index);
  const candidate = candidateIndex === null
    ? null
    : candidates.find((item) => Number(item.candidate_index) === candidateIndex) || candidates[candidateIndex] || null;
  const tags = Array.isArray(data?.tags) ? data.tags.map((item) => String(item).trim()).filter(Boolean) : [];
  return {
    title_ru: String(data?.title_ru || '').trim().slice(0, 500),
    model_name: String(data?.model_name || '').trim().slice(0, 200),
    description_ru: String(data?.description_ru || '').trim().slice(0, 4000),
    tags: tags.slice(0, 20),
    matched_category: candidate
      ? categoryForDraft(candidate, 'ai_candidate')
      : {
          description_category_id: 0,
          type_id: 0,
          path: '',
          path_language: 'UNKNOWN',
          match_source: 'none',
        },
    estimated_dimensions: {
      length_cm: positiveNumber(data?.estimated_dimensions?.length_cm),
      width_cm: positiveNumber(data?.estimated_dimensions?.width_cm),
      height_cm: positiveNumber(data?.estimated_dimensions?.height_cm),
      weight_g: positiveNumber(data?.estimated_dimensions?.weight_g),
    },
  };
}

const CONTROLLED_ATTR_IDS = new Set([85, 9048, 4191, 23171, 4497, 11254]);

function isMediaLikeAttribute(attr) {
  const name = `${attr.name || ''} ${attr.description || ''} ${attr.groupName || ''}`.toLowerCase();
  return /video|rich|pdf|json|image|picture|видео|медиа|изображ|фото|富内容|视频|图片|封面|pdf/i.test(name);
}

function visibleDraftCategoryAttributes(attrs) {
  return attrs
    .filter((attr) => Number(attr.id) > 0)
    .filter((attr) => !CONTROLLED_ATTR_IDS.has(Number(attr.id)))
    .filter((attr) => !isMediaLikeAttribute(attr))
    .slice(0, 80);
}

function addGeneratedCategoryAttributes(attrs, generated) {
  const values = Array.isArray(generated?.attribute_values) ? generated.attribute_values : [];
  const seen = new Set(attrs.map((attr) => Number(attr.id)).filter(Boolean));

  for (const item of values) {
    const attrId = Number(item.attribute_id || item.id || 0);
    if (!attrId || seen.has(attrId)) continue;

    const valueText = cleanText(item.value_text || item.value || '');
    const dictionaryValueId = Number(item.dictionary_value_id || item.dictionaryValueId || 0);
    if (!valueText && !dictionaryValueId) continue;

    const valueEntry = {};
    if (dictionaryValueId > 0) valueEntry.dictionary_value_id = dictionaryValueId;
    if (valueText) valueEntry.value = valueText;

    attrs.push({
      id: attrId,
      complex_id: 0,
      values: [valueEntry],
    });
    seen.add(attrId);
  }
}

function buildOzonItem(row, generated, settings, index) {
  const images = imageUrls(row);
  const category = generated.matched_category || {};
  const dims = generated.estimated_dimensions || {};
  const depth = positiveNumber(row.length_cm) || positiveNumber(dims.length_cm) || 0;
  const width = positiveNumber(row.width_cm) || positiveNumber(dims.width_cm) || 0;
  const height = positiveNumber(row.height_cm) || positiveNumber(dims.height_cm) || 0;
  const weight = positiveNumber(row.weight_g) || positiveNumber(dims.weight_g) || 0;
  const attrs = [];
  addAttribute(attrs, ATTR_MODEL_NAME, generated.model_name || generated.title_ru);
  addAttribute(attrs, ATTR_DESCRIPTION, generated.description_ru);
  addAttribute(attrs, ATTR_TAGS, generated.tags.join('\n'));
  // Merge backend-generated category attributes into item.attributes
  addGeneratedCategoryAttributes(attrs, generated);
  return {
    name: generated.title_ru || String(row.product_title || row.sku_name || '').slice(0, 500),
    offer_id: stableOfferId(row, index),
    price: String(Math.max(positiveNumber(row.sku_price) || 0, 1)),
    old_price: '0',
    vat: '0',
    currency_code: settings.ozon.currencyCode || 'CNY',
    description_category_id: Number(category.description_category_id || 0),
    type_id: Number(category.type_id || 0),
    barcode: '',
    images,
    primary_image: images[0] || '',
    dimension_unit: 'cm',
    depth: numberForOzon(depth),
    width: numberForOzon(width),
    height: numberForOzon(height),
    weight_unit: 'g',
    weight: numberForOzon(weight),
    attributes: attrs,
    complex_attributes: [],
    _source: 'desktop_ai_draft',
    _category_path: cleanText(category.path),
  };
}

function buildVariantDraft(sourceRows, items, generated) {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  if (rows.length <= 1) return null;

  const parsedRows = rows.map((row) => parseSkuSpecs(row));
  const sourceKeys = uniqueStrings(parsedRows.flatMap((specs) => Object.keys(specs)));
  const dimensions = sourceKeys.map((key) => {
    const values = uniqueStrings(parsedRows.map((specs) => specs[key]));
    return {
      source_name: key,
      values,
      distinguishes_variants: values.length > 1,
      ozon_attribute_id: null,
      ozon_attribute_name: '',
      dictionary_id: null,
      mapping_status: 'needs_ozon_attribute',
    };
  });
  const distinguishing = dimensions.filter((dimension) => dimension.distinguishes_variants);
  const warnings = [];
  if (!dimensions.length) warnings.push('未能从 1688 SKU 文本解析出规格键值。');
  if (dimensions.length && !distinguishing.length) warnings.push('多个 SKU 未发现不同的规格值。');

  const groupKey = stableVariantGroupKey(rows, generated);
  const groupValue = cleanText(generated.model_name || generated.title_ru);
  const variants = items.map((item, index) => {
    const row = rows[index] || {};
    return {
      item_index: index,
      offer_id: cleanText(item?.offer_id),
      source_offer_id: sourceOfferId(row),
      source_sku_id: cleanText(row.sku_id || row.skuId),
      source_sku_name: cleanText(row.sku_name || row.skuName || row.sku_specs_text || row.specs),
      values: parsedRows[index] || {},
      price: cleanText(item?.price),
      stock: stockOf(row, item),
      image: cleanText(item?.primary_image),
    };
  });

  return {
    type: 'ozon_model_variants',
    status: dimensions.length && distinguishing.length ? 'needs_attribute_mapping' : 'unparsed',
    confirmed: false,
    group_key: groupKey,
    group_attribute_id: ATTR_MODEL_NAME,
    group_attribute_name: 'model_name',
    group_value: groupValue,
    dimensions,
    variants,
    warnings,
  };
}

function applyVariantMetadata(items, variant) {
  if (!Array.isArray(items) || !variant) return;
  const variants = Array.isArray(variant.variants) ? variant.variants : [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item || typeof item !== 'object') continue;
    const entry = variants[index] || {};
    item._variant = {
      group_key: variant.group_key,
      group_attribute_id: variant.group_attribute_id,
      group_value: variant.group_value,
      item_index: index,
      source_offer_id: entry.source_offer_id || '',
      source_sku_id: entry.source_sku_id || '',
      source_sku_name: entry.source_sku_name || '',
      values: entry.values || {},
      mapping_status: variant.status,
    };
  }
}

// ── Fill category attributes during draft generation ──

async function fillCategoryAttributes(settings, sourceRows, normalized) {
  const log = (msg) => process.stderr.write(`[ozon-draft:attr] ${msg}\n`);
  try {
    const category = normalized.matched_category;
    if (!category || typeof category !== 'object') { log('SKIP: no matched_category'); return; }

    const descId = Number(category.description_category_id || 0);
    const typeId = Number(category.type_id || 0);
    log(`category descId=${descId} typeId=${typeId} path=${category.path || ''}`);
    if (!descId || !typeId) { log('SKIP: descId or typeId is 0'); return; }

    const userDataPath = cleanText(settings?.userDataPath || settings?.paths?.userDataPath || '');
    log(`userDataPath=${userDataPath || '(empty)'}`);

    // 1. Fetch category attributes from Ozon
    log('step 1: getCategoryAttributes...');
    const catAttrs = await getCategoryAttributes(userDataPath, {
      descriptionCategoryId: descId,
      typeId,
      language: 'ZH_HANS',
    });
    const attrs = visibleDraftCategoryAttributes(catAttrs.attributes || []);
    log(`step 1 done: ${attrs.length} attrs (non-aspect)`);
    if (!attrs.length) { log('SKIP: no attributes'); return; }

    // 2. AI suggests attribute values
    log('step 2: callAi for suggestions...');
    const messages = buildAttributeSuggestionMessages(sourceRows, attrs, {}, { descriptionCategoryId: descId, typeId, path: category.path || '' });
    const suggestionData = await callAi(settings.ai, messages);
    const suggestions = normalizeAttributeSuggestions(suggestionData, attrs);
    const attrList = suggestions.attributes || [];
    log(`step 2 done: ${attrList.length} suggestions`);

    // 3. Resolve dictionary values to Chinese
    const resolved = [];
    for (const s of attrList) {
      const attr = attrs.find((a) => Number(a.id) === Number(s.attribute_id));
      if (!attr) continue;

      if (attr.dictionaryId) {
        const query = cleanText(s.dictionary_query || s.value_text || '');
        if (query) {
          try {
            const searchResp = await getCategoryAttributeValues(userDataPath, {
              descriptionCategoryId: descId,
              typeId,
              attributeId: attr.id,
              limit: 20,
              query,
            });
            const searchOptions = searchResp.values || [];
            const zhResp = await getCategoryAttributeValues(userDataPath, {
              descriptionCategoryId: descId,
              typeId,
              attributeId: attr.id,
              language: 'ZH_HANS',
              limit: 2000,
            });
            const zhOptions = zhResp.values || [];
            const matched = searchOptions[0];
            if (matched) {
              const zhMatch = zhOptions.find((v) => v.id === matched.id);
              resolved.push({
                attribute_id: attr.id,
                value_text: zhMatch ? cleanText(zhMatch.value) : cleanText(matched.value),
                dictionary_value_id: matched.id,
                confidence: s.confidence || 0,
              });
            }
          } catch (e) {
            log(`dict resolve failed for attr ${attr.id}: ${e?.message || e}`);
          }
        }
      } else {
        const txt = cleanText(s.value_text);
        if (txt) {
          resolved.push({ attribute_id: attr.id, value_text: txt, confidence: s.confidence || 0 });
        }
      }
    }

    log(`step 3 done: ${resolved.length} resolved values`);
    normalized.attribute_values = resolved;
  } catch (err) {
    log(`FAILED: ${err?.message || err}\n${err?.stack || ''}`);
  }
}

function collectDraftMissing(items, draft) {
  const missing = new Set();
  for (const item of items) {
    if (!item.name) missing.add('俄语标题');
    if (!item.primary_image) missing.add('主图');
    if (!item.description_category_id || !item.type_id) missing.add('Ozon 类目');
    if (!Number(item.price)) missing.add('价格');
    for (const [key, label] of [['depth', '长'], ['width', '宽'], ['height', '高'], ['weight', '重量']]) {
      if (!Number(item[key])) missing.add(label);
    }
  }
  if (hasUnconfirmedVariantMapping(draft)) missing.add('规格属性映射');
  return Array.from(missing);
}

function hasUnconfirmedVariantMapping(draft) {
  const sourceRows = Array.isArray(draft?.sourceRows) ? draft.sourceRows : [];
  const generated = draft?.generated && typeof draft.generated === 'object' ? draft.generated : {};
  if (sourceRows.length <= 1) return false;
  const variant = variantMappingOf(draft, generated);
  if (variant.confirmed === true || variant.status === 'confirmed') return false;
  return generated.variant_mapping_confirmed !== true && generated.variantMappingConfirmed !== true;
}

function variantMappingOf(draft, generated) {
  const root = draft?.variant && typeof draft.variant === 'object' ? draft.variant : null;
  const fromGenerated = generated?.variant_mapping && typeof generated.variant_mapping === 'object'
    ? generated.variant_mapping
    : null;
  return root || fromGenerated || {};
}

function parseSkuSpecs(row) {
  const source = row && typeof row === 'object' ? row : {};
  const structured = objectSpecValues(
    source.sku_specs_structured ||
    source.variant_specs ||
    source.specs_structured ||
    source.specValues
  );
  if (Object.keys(structured).length) return structured;

  const raw = cleanText(
    source.sku_specs_text ||
    source.sku_name ||
    source.skuName ||
    source.specs ||
    source.variant_name ||
    source.variantName
  );
  const text = decodeSpecText(raw);
  if (!text) return {};

  const specs = {};
  const chunks = text.split(/\s*(?:;|；|\||>|\/)\s*/).map((item) => item.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const match = chunk.match(/^([^:=：]+)\s*[:：=]\s*(.+)$/);
    if (!match) continue;
    const key = cleanSpecPart(match[1]);
    const value = cleanSpecPart(match[2]);
    if (key && value) specs[key] = value;
  }

  if (!Object.keys(specs).length) specs['规格'] = text;
  return specs;
}

function objectSpecValues(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = cleanSpecPart(rawKey);
    const text = cleanSpecPart(rawValue);
    if (key && text) result[key] = text;
  }
  return result;
}

function decodeSpecText(value) {
  return cleanText(value)
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSpecPart(value) {
  return cleanText(value).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

function stableVariantGroupKey(rows, generated) {
  const first = rows[0] || {};
  const raw = [
    sourceOfferId(first),
    first.detail_url,
    first.product_title,
    generated?.model_name,
    generated?.title_ru,
  ].map((item) => cleanText(item)).join('|');
  return `1688-model-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function sourceOfferId(row) {
  const source = row && typeof row === 'object' ? row : {};
  const raw1688 = source.raw_1688 && typeof source.raw_1688 === 'object' ? source.raw_1688 : {};
  return cleanText(source.source_offer_id || source.offer_id || source.offerId || raw1688.offerId || raw1688.offer_id);
}

function imageUrls(row) {
  const out = [];
  for (const key of ['sku_image_url', 'main_image_url', 'default_main_image_url']) pushImage(out, row[key]);
  for (const key of ['gallery_non_video_image_urls', 'gallery_image_urls', 'additional_image_urls', 'sku_image_candidates']) {
    if (Array.isArray(row[key])) row[key].forEach((item) => pushImage(out, item));
  }
  return out.slice(0, 15);
}

function pushImage(out, value) {
  let url = String(value || '').trim();
  if (!url) return;
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^https?:\/\//.test(url) && !out.includes(url)) out.push(url);
}

function addAttribute(attrs, id, value) {
  const text = String(value || '').trim();
  if (!text) return;
  attrs.push({
    id,
    complex_id: 0,
    values: text.split(/\n+/).map((line) => ({ value: line.trim() })).filter((item) => item.value),
  });
}

function stableOfferId(row, index) {
  const raw = [row.detail_url, row.product_title, row.sku_name, index].map((item) => String(item || '')).join('|');
  return `1688-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`;
}

function positiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function numberForOzon(value) {
  const number = positiveNumber(value);
  return number ? Math.max(1, Math.round(number)) : 0;
}

function toCandidateIndex(value) {
  const number = Number(String(value ?? '').trim());
  if (!Number.isFinite(number)) return null;
  const integer = Math.round(number);
  return integer >= 0 ? integer : null;
}

function toInt(value) {
  const number = Number(String(value ?? '').trim());
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean)));
}

function stringifyForError(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function containsCyrillic(value) {
  return /[Ѐ-ӿ]/.test(String(value || ''));
}

function readJsonFileSafe(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function categoryTreeRoots(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree.result)) return tree.result;
  if (Array.isArray(tree.items)) return tree.items;
  if (Array.isArray(tree.categories)) return tree.categories;
  if (tree.data && typeof tree.data === 'object') return categoryTreeRoots(tree.data);
  return [];
}


// ── AI Attribute Suggestions ──

async function generateOzonAttributeSuggestions(settings, params = {}) {
  const sourceRows = Array.isArray(params.sourceRows) ? params.sourceRows : [];
  const categoryAttributes = Array.isArray(params.categoryAttributes) ? params.categoryAttributes : [];
  const currentForm = params.form && typeof params.form === 'object' ? params.form : {};
  const category = params.category && typeof params.category === 'object' ? params.category : {};

  if (!settings.ai.apiKey) throw new Error('DeepSeek API Key 未配置。');
  if (!sourceRows.length) throw new Error('缺少 1688 商品数据，无法生成类目特征建议。');
  if (!categoryAttributes.length) throw new Error('缺少 Ozon 类目特征列表。');

  const messages = buildAttributeSuggestionMessages(sourceRows, categoryAttributes, currentForm, category);
  const generated = await callAi(settings.ai, messages);
  return normalizeAttributeSuggestions(generated, categoryAttributes);
}

function buildAttributeSuggestionMessages(sourceRows, categoryAttributes, currentForm, category) {
  const payload = {
    task: 'suggest_ozon_category_attribute_values_from_1688_product',
    category,
    current_form: currentForm,
    source_rows: sourceRows.slice(0, 5),
    attributes: categoryAttributes.map((attr) => ({
      id: attr.id,
      name: attr.name,
      description: attr.description || '',
      is_required: attr.isRequired,
      is_dictionary: Boolean(attr.dictionaryId),
      dictionary_id: attr.dictionaryId || 0,
      is_aspect: Boolean(attr.isAspect),
      max_value_count: attr.maxValueCount || 1,
    })),
    required_schema: {
      attributes: [{
        attribute_id: 'number',
        value_text: 'string, suggested visible value, empty if unknown',
        dictionary_query: 'string, for dictionary search, empty if not dictionary',
        confidence: 'number 0-1',
        reason: 'short Chinese reason',
      }],
    },
    rules: [
      'Return JSON only. No Markdown.',
      'Use only evidence from source_rows and category attribute names.',
      'Do not invent dictionary_value_id.',
      'For dictionary attributes, return value_text and dictionary_query only.',
      'If attribute is 原产国 / country of origin / страна-изготовитель, use 中国 as value_text and 中国 as dictionary_query.',
      'If evidence is insufficient, return empty value_text.',
    ],
  };

  return [
    { role: 'system', content: 'You are an Ozon product attribute assistant. Suggest category attribute values from 1688 product data. Return compliant JSON only.' },
    { role: 'user', content: JSON.stringify(payload) },
  ];
}

function normalizeAttributeSuggestions(data, categoryAttributes) {
  const attrIds = new Set(categoryAttributes.map((attr) => Number(attr.id)).filter(Boolean));
  const raw = Array.isArray(data?.attributes) ? data.attributes : [];
  return {
    ok: true,
    attributes: raw
      .map((item) => ({
        attribute_id: Number(item.attribute_id || item.id || 0),
        value_text: cleanText(item.value_text || item.value || ''),
        dictionary_query: cleanText(item.dictionary_query || item.query || item.value_text || ''),
        confidence: Number(item.confidence || 0),
        reason: cleanText(item.reason || ''),
      }))
      .filter((item) => attrIds.has(item.attribute_id))
      .slice(0, 80),
  };
}

module.exports = { generateOzonDraft, submitOzonDraft, collectDraftMissing, generateOzonAttributeSuggestions };
