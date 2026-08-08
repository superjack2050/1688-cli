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

// ── Built-in 1688→Ozon attribute keyword mapping ──
// Maps Chinese 1688 attribute names to Ozon attribute name keywords (CN / EN / RU).
// Used to pre-match before calling AI, improving reliability for common attributes.
const BUILTIN_ATTR_MAP = [
  { cn: '材质', keys: ['材质', '成分', 'material', 'материал', '面料', '原料'] },
  { cn: '颜色', keys: ['颜色', '色彩', 'color', 'цвет', '花色', '配色'] },
  { cn: '尺码', keys: ['尺码', '尺寸', 'size', 'размер', '码数', '规格'] },
  { cn: '重量', keys: ['重量', '净重', 'weight', 'вес', '毛重'] },
  { cn: '产地', keys: ['产地', '原产地', 'country', 'страна', '制造国', '原产国', '生产地'] },
  { cn: '风格', keys: ['风格', 'style', 'стиль', '款式'] },
  { cn: '季节', keys: ['季节', 'season', 'сезон', '适用季节', '穿着季节'] },
  { cn: '性别', keys: ['性别', '适用性别', 'gender', 'пол', '男女'] },
  { cn: '袖长', keys: ['袖长', 'sleeve', 'рукав'] },
  { cn: '衣长', keys: ['衣长', '长度', 'length', 'длина', '裤长', '裙长'] },
  { cn: '领型', keys: ['领型', '领子', 'collar', 'ворот', '领口'] },
  { cn: '版型', keys: ['版型', 'fit', ' silhouette', '款型', '修身', '宽松'] },
  { cn: '厚度', keys: ['厚度', '厚薄', 'thickness', '薄款', '加厚'] },
  { cn: '弹性', keys: ['弹性', 'elastic', '弹力'] },
  { cn: '品牌', keys: ['品牌', 'brand', 'бренд', '商标'] },
];

function matchOzonAttrByBuiltinMap(ozonAttrName, source1688Attrs) {
  const name = (ozonAttrName || '').toLowerCase();
  const srcKeys = Object.keys(source1688Attrs || {}).map((k) => k.toLowerCase());
  if (!name || !srcKeys.length) return null;

  for (const entry of BUILTIN_ATTR_MAP) {
    const ozonHit = entry.keys.some((k) => name.includes(k.toLowerCase()));
    if (!ozonHit) continue;
    const srcHit = entry.keys.some((k) => srcKeys.includes(k.toLowerCase()));
    if (!srcHit) continue;
    // Find the 1688 value for the first matching source key
    for (const srcKey of Object.keys(source1688Attrs || {})) {
      if (entry.keys.some((k) => srcKey.toLowerCase().includes(k.toLowerCase()))) {
        return String(source1688Attrs[srcKey] || '').trim();
      }
    }
  }
  return null;
}

// ── Search keyword → Ozon category hint mapping ──
// Boosts correct categories for common 1688 search terms. Each entry maps
// a Chinese search keyword to category path hints used to re-rank candidates.
const CATEGORY_HINTS = {
  '西装': ['西服', '西装', '男士外套', '正装', '商务', '夹克', 'blazer', 'suit'],
  '西服': ['西服', '西装', '男士外套', '正装', '商务'],
  '连衣裙': ['连衣裙', '裙子', '女装', 'dress', 'платье'],
  'T恤': ['T恤', 'T-shirt', '短袖', '上衣', '男装', '女装'],
  '衬衫': ['衬衫', '衬衣', '上衣', '男装', '女装', 'shirt'],
  '手机壳': ['手机壳', '手机保护', '手机配件', 'phone case'],
  '牛仔裤': ['牛仔裤', '牛仔', '裤子', 'jeans', 'джинсы'],
  '运动鞋': ['运动鞋', '鞋', 'sneakers', 'кроссовки', 'footwear'],
  '背包': ['背包', '双肩包', '书包', 'backpack', 'рюкзак'],
  '手表': ['手表', '表', 'watch', 'часы'],
  '耳机': ['耳机', '耳塞', 'headphones', 'наушники'],
  '充电宝': ['充电宝', '移动电源', 'power bank', '电池'],
  '帽子': ['帽子', '帽', 'cap', 'hat', 'шапка', '头饰'],
  '袜子': ['袜子', '袜', 'socks', 'носки'],
  '围巾': ['围巾', '围脖', 'scarf', 'шарф'],
  '手套': ['手套', 'gloves', 'перчатки'],
  '拖鞋': ['拖鞋', '凉鞋', 'slippers', 'sandals'],
  '睡衣': ['睡衣', '家居服', 'pajamas', 'sleepwear', '睡裙'],
  '睡裙': ['睡裙', '睡衣', '家居服', 'nightgown', 'sleepwear'],
  '内衣': ['内衣', '内裤', 'underwear', 'bra', '文胸'],
  '泳衣': ['泳衣', '泳装', 'swimwear', '比基尼'],
  '瑜伽服': ['瑜伽', '运动服', '健身', 'yoga', 'sportswear'],
  '羽绒服': ['羽绒', '棉服', '棉衣', 'jacket', 'пуховик', '冬装'],
  '毛衣': ['毛衣', '针织', 'sweater', 'свитер'],
  '外套': ['外套', '夹克', 'jacket', 'coat', 'куртка', '风衣'],
  '背心': ['背心', '吊带', 'vest', 'tank', 'camisole', '内搭'],
  '吊带': ['吊带', '背心', 'camisole', '内搭'],
  '开衫': ['开衫', '外套', 'cardigan', '针织', '毛衣'],
  '防晒衣': ['防晒', '外套', '夹克', 'jacket', '风衣'],
  '冲锋衣': ['冲锋衣', '外套', '夹克', 'jacket', '户外'],
  '家居服': ['家居服', '睡衣', '居家', 'homewear', 'loungewear', '浴袍'],
  '职业装': ['职业装', '正装', '西装', 'business', 'office', '套装'],
  '工作服': ['工作服', '制服', '工装', 'workwear', 'uniform'],
  'Polo衫': ['Polo', 'polo衫', 'T恤', '上衣', '衬衫'],
  '短袖': ['短袖', 'T恤', 'T-shirt', '上衣'],
  '长袖': ['长袖', 'T恤', '上衣', '打底衫'],
  '打底衫': ['打底衫', '长袖', '上衣', '内搭'],
  '休闲裤': ['休闲裤', '裤子', '长裤', 'pants', 'trousers'],
  '阔腿裤': ['阔腿裤', '裤子', '长裤', 'pants', '女装'],
  '短裤': ['短裤', '裤子', 'shorts', '热裤'],
  '半身裙': ['半身裙', '裙子', 'skirt', '女装'],
  '套装': ['套装', '两件套', 'set', 'suit', '职业装'],
  '卫衣': ['卫衣', 'hoodie', ' sweatshirt', '运动服', '上衣'],
  '风衣': ['风衣', '外套', 'trench', 'coat', 'jacket'],
  '棉服': ['棉服', '棉衣', '羽绒', '冬装', 'jacket', '保暖'],
};

// Marketing noise words — stripped from search keywords before matching.
// These are seasonal/promotional/descriptive terms that add zero signal.
const NOISE_WORDS = new Set([
  '夏季新款', '春季新款', '秋季新款', '冬季新款',
  '夏季', '春季', '秋季', '冬季', '春夏', '秋冬', '春秋',
  '新款', '爆款', '热卖', '热销', '促销', '特价',
  '时尚', '洋气', '韩版', '日系', '欧美', '英伦', '法式',
  '简约', '百搭', '宽松', '修身', '显瘦', '高级感', '气质',
  '定制', '厂家', '批发', '代发', '直销', '跨境', '外贸',
  '2025', '2026', '2024', '2023', '2027',
  '品牌', '正品', '大码', '小个子', '大码女',
  '一件代发', '网红', '同款', '明星',
  '新款女', '新款男', '潮', '超好看', '温柔风', '松弛感',
  '纯欲风', '甜心', '暗黑', '清冷', '法式度假', '松弛',
  '新中式', '复古', '街头', '朋克', '哥特',
  '轻薄', '加厚', '加绒', '薄款', '厚款',
]);

function stripNoiseWords(text) {
  let result = text;
  // Remove standalone noise tokens (sorted by length descending to match longer phrases first)
  const sorted = [...NOISE_WORDS].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    result = result.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

function boostCandidatesByHints(candidates, keyword, sourceRows) {
  if (!keyword || !candidates.length) return candidates;
  let hints = CATEGORY_HINTS[normalizeCategoryText(keyword)];
  // If stripped keyword doesn't match, try the raw title words as fallback hints
  if (!hints) {
    const titleText = normalizeCategoryText(
      (Array.isArray(sourceRows) ? sourceRows : []).slice(0, 1)
        .map((row) => `${row.product_title || ''} ${row.title || ''}`)
        .join(' ')
    );
    // Try each title token against hints table
    for (const token of titleText.split(/\s+/).filter(Boolean)) {
      const h = CATEGORY_HINTS[token];
      if (h) { hints = h; break; }
    }
  }
  if (!hints) return candidates;
  // Also extract hint words from 1688 product title
  const titleText = normalizeCategoryText(
    (Array.isArray(sourceRows) ? sourceRows : []).slice(0, 1)
      .map((row) => `${row.product_title || ''} ${row.title || ''}`)
      .join(' ')
  );
  const extraHints = hints.filter((h) => titleText.includes(normalizeCategoryText(h)));
  const allHints = [...new Set([...hints, ...extraHints])];

  return candidates.map((c) => {
    const path = normalizeCategoryText(c.path || '');
    const name = normalizeCategoryText(c.keyword || '');
    let boost = 0;
    for (const hint of allHints) {
      const n = normalizeCategoryText(hint);
      if (!n) continue;
      if (name === n) boost += 200;        // exact category name match
      else if (name.includes(n)) boost += 80;
      else if (path.includes(n)) boost += 40;
    }
    return { ...c, _score: (c._score || 0) + boost };
  }).sort((a, b) => (b._score || 0) - (a._score || 0));
}

// ── Title quality validation ──

function hasSuspiciousTitleStructure(title) {
  const text = cleanText(title);
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return true;
  if (text.length > 180) return true;
  const commaCount = (text.match(/[,，]/g) || []).length;
  if (commaCount >= 4) return true;
  const normalizedWords = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
  const uniqueWords = new Set(normalizedWords.filter(Boolean));
  if (normalizedWords.length >= 8 && uniqueWords.size / normalizedWords.length < 0.55) return true;
  const connectorCount = words.filter((w) => /^(для|из|с|со|в|на|под|и|или)$/i.test(w)).length;
  if (words.length >= 10 && connectorCount === 0) return true;
  return false;
}

async function repairOzonTitleIfNeeded(settings, sourceRows, generated) {
  const currentTitle = cleanText(generated?.title_ru);
  if (!hasSuspiciousTitleStructure(currentTitle)) return generated;

  try {
    const payload = {
      task: 'repair_ozon_title_ru',
      problem: 'The current Russian title may be unnatural, grammatically unclear, or keyword-stuffed.',
      rules: [
        'Return JSON only.',
        'Create one natural Russian product title.',
        'Do not write a keyword list.',
        'Do not translate Chinese source text word-by-word.',
        'Remove meaningless or grammatically unclear fragments.',
        'Keep the title factual and understandable.',
        'Do not add advertising slogans or promotional words.',
        'Do not invent brand, certification, exact material, or exact functions if not supported by source data.',
        'The title must clearly tell a buyer what the product is.',
        'Keep the title concise, preferably 45-120 characters.',
      ],
      current_title_ru: currentTitle,
      category_path: generated?.matched_category?.path || '',
      source_rows: sourceRowsForAi(sourceRows),
    };
    const messages = [
      { role: 'system', content: 'You are a Russian Ozon marketplace title editor. Repair unclear or keyword-stuffed product titles. Return compliant JSON only.' },
      { role: 'user', content: JSON.stringify(payload) },
    ];
    const result = await callAi(settings.ai, messages);
    const fixedTitle = cleanText(result?.title_ru || result?.fixed_title_ru || '');
    if (fixedTitle && !hasSuspiciousTitleStructure(fixedTitle)) {
      generated.title_ru = fixedTitle.slice(0, 500);
    }
  } catch { /* best-effort — keep original title if repair fails */ }
  return generated;
}

async function generateOzonDraft(settings, rows = []) {
  const sourceRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : [];
  if (!sourceRows.length) throw new Error('没有可生成 Ozon 草稿的 1688 SKU 数据。');

  const categoryContext = resolveCategoryForDraft(settings, sourceRows);

  const generated = await callAi(settings.ai, buildMessages(sourceRows, categoryContext.candidates));
  const normalized = normalizeGenerated(generated, categoryContext.candidates);

  if (categoryContext.exactCategory) {
    normalized.matched_category = categoryContext.exactCategory;
  }

  // Repair unnatural/keyword-stuffed titles before building items
  await repairOzonTitleIfNeeded(settings, sourceRows, normalized);

  // Fill category attributes immediately — part of draft generation
  await fillCategoryAttributes(settings, sourceRows, normalized);

  const items = sourceRows.map((row, index) => buildOzonItem(row, normalized, settings, index));

  // Complete draft: fill required category attributes, defaults, retry missing
  const completion = await completeOzonDraftItems(settings, sourceRows, normalized, items);

  const variant = buildVariantDraft(sourceRows, items, normalized);
  if (variant) {
    // Map variant dimensions to Ozon category attributes using builtin table + name matching
    mapVariantDimensionsToOzonAttrs(variant, normalized);
    normalized.variant_mapping = variant;
    normalized.variant_mapping_confirmed = variant.confirmed === true;
    applyVariantMetadata(items, variant);
  }
  const baseMissing = collectDraftMissing(items, { sourceRows, generated: normalized, variant });
  const finalMissing = uniqueStrings([...baseMissing, ...(completion.missing || [])]);

  const firstItemAttrs = Array.isArray(items[0]?.attributes) ? items[0].attributes : [];
  process.stderr.write(`[ozon-draft] final: attrValues=${normalized.attribute_values?.length || 0} itemAttrs=${firstItemAttrs.length} missing=${finalMissing.length} requiredMissing=${completion.missing?.length || 0} status=${finalMissing.length ? 'needs_review' : 'ready'}\n`);

  return {
    draftId: `ozon-draft-${Date.now()}`,
    status: finalMissing.length ? 'needs_review' : 'ready',
    sourceRows,
    generated: normalized,
    variant,
    items,
    missing: finalMissing,
    createdAt: new Date().toISOString(),
  };
}

// ── Ozon Import Attribute Normalization ──

async function prepareOzonImportItems(settings, items) {
  const metaByCategory = await loadAttributeMetaByCategory(settings, items);

  const importItems = items.map((item) => {
    const importItem = toOzonImportItem(item);
    const key = `${Number(importItem.description_category_id || 0)}:${Number(importItem.type_id || 0)}`;
    const metaById = metaByCategory[key] || {};

    importItem.attributes = normalizeAttributesForOzonImport(importItem.attributes, metaById);

    importItem.name = cleanText(importItem.name).slice(0, 500);
    if (hasSuspiciousTitleStructure(importItem.name)) {
      throw new Error(`提交前校验失败：商品名称可能存在无意义文本或语法问题，请重新生成或手动修改。offer_id=${importItem.offer_id}`);
    }
    importItem.offer_id = cleanText(importItem.offer_id);
    importItem.price = String(Math.max(positiveNumber(importItem.price), 1));
    importItem.old_price = String(importItem.old_price || '0');
    importItem.vat = String(importItem.vat || '0');
    importItem.images = uniqueStrings(Array.isArray(importItem.images) ? importItem.images : []);
    importItem.primary_image = cleanText(importItem.primary_image || importItem.images[0] || '');

    const submitWeight = positiveNumber(importItem.weight);
    if (!submitWeight || submitWeight < MIN_VALID_WEIGHT_G) {
      throw new Error('提交前校验失败：含包装重量无效（为 0 或 1g 占位值），请重新生成草稿。');
    }
    importItem.weight = Math.round(submitWeight);

    return importItem;
  });

  return { importItems, metaByCategory };
}

async function loadAttributeMetaByCategory(settings, items) {
  const result = {};
  const keys = uniqueStrings(items.map((item) => {
    const desc = Number(item.description_category_id || 0);
    const type = Number(item.type_id || 0);
    return desc && type ? `${desc}:${type}` : '';
  }));

  for (const key of keys) {
    const [descriptionCategoryId, typeId] = key.split(':').map(Number);
    const data = await callOzonSellerApi(settings.ozon, '/v1/description-category/attribute', {
      description_category_id: descriptionCategoryId,
      type_id: typeId,
      language: 'ZH_HANS',
    });
    const attrs = normalizeCategoryAttributesForImport(data);
    if (!attrs.length) {
      throw new Error(`提交前校验失败：Ozon 类目 ${descriptionCategoryId}/${typeId} 没有返回属性元数据，不能安全提交。`);
    }
    result[key] = Object.fromEntries(attrs.map((attr) => [Number(attr.id), attr]));
  }

  return result;
}

function normalizeCategoryAttributesForImport(data) {
  const raw = Array.isArray(data?.result) ? data.result
    : Array.isArray(data?.attributes) ? data.attributes
      : Array.isArray(data?.result?.attributes) ? data.result.attributes
        : [];
  return raw.map((attr) => ({
    id: Number(attr?.id || attr?.attribute_id || 0),
    name: cleanText(attr?.name || attr?.attribute_name || ''),
    dictionaryId: Number(attr?.dictionary_id || 0) || 0,
    isRequired: attr?.is_required === true || attr?.required === true,
    isCollection: attr?.is_collection === true,
    maxValueCount: Number(attr?.max_value_count || 1) || 1,
    attributeComplexId: Number(attr?.attribute_complex_id || 0) || 0,
    type: cleanText(attr?.type || attr?.value_type || attr?.data_type || attr?.attribute_type || ''),
    maxValue: Number(attr?.max_value || attr?.max || 0) || null,
    minValue: Number(attr?.min_value || attr?.min || 0) || null,
    unit: cleanText(attr?.unit || attr?.measure_unit || ''),
  })).filter((attr) => attr.id > 0);
}

function normalizeAttributesForOzonImport(attributes, metaById) {
  const grouped = new Map();

  for (const raw of Array.isArray(attributes) ? attributes : []) {
    const attr = raw && typeof raw === 'object' ? raw : {};
    const id = Number(attr.id || attr.attribute_id || 0);
    if (!id) continue;

    // Hashtag attributes (23171/22508) cause repeated Ozon audit warnings
    // about "advertising/promotional" content. Drop them from the import payload.
    if (KNOWN_HASHTAG_ATTR_IDS.has(id)) continue;

    const meta = metaById[id] || {};
    const complexId = Number(attr.complex_id || attr.complexId || meta.attributeComplexId || 0) || 0;
    const key = `${id}:${complexId}`;

    const values = normalizeAttributeValuesForOzonImport(attr.values, meta, id);
    if (!values.length) continue;

    if (!grouped.has(key)) {
      grouped.set(key, { id, complex_id: complexId, values: [] });
    }
    grouped.get(key).values.push(...values);
  }

  const result = [];
  for (const attr of grouped.values()) {
    const meta = metaById[attr.id] || {};
    const values = dedupeAttributeValues(attr.values);
    const maxCount = maxValueCountForImport(meta);
    const finalValues = allowsMultipleValues(meta)
      ? values.slice(0, maxCount)
      : values.slice(0, 1);
    if (!finalValues.length) continue;
    result.push({ id: attr.id, complex_id: attr.complex_id || 0, values: finalValues });
  }
  return result;
}

function normalizeAttributeValuesForOzonImport(values, meta, attrId) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const valueObj = raw && typeof raw === 'object' ? raw : { value: raw };

    if (Number(meta.dictionaryId || 0) > 0) {
      const dictionaryValueId = Number(valueObj.dictionary_value_id || valueObj.dictionaryValueId || 0);
      if (dictionaryValueId <= 0) continue; // dict attrs MUST have a real dict id
      const entry = { dictionary_value_id: dictionaryValueId };
      const v = cleanText(valueObj.value);
      if (v) entry.value = v;
      out.push(entry);
      continue;
    }

    const v = normalizeNonDictionaryValueForOzonImport(valueObj.value, meta, attrId);
    if (v === null || v === undefined || v === '') continue;
    // Final guard: hashtag must be valid, unsafe numeric optional attrs dropped
    if (isHashtagAttribute(attrId, meta) && !isValidOzonHashtagValue(v)) continue;
    out.push({ value: v });
  }
  return out;
}

function isBooleanAttribute(meta) {
  const raw = `${meta.type || ''} ${meta.name || ''}`.toLowerCase();
  return /bool|boolean|true\/false|да\/нет|логичес|是否/.test(raw);
}

function normalizeBooleanValue(value) {
  const raw = cleanText(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'да', '是', '有', '支持'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'нет', '否', '无', '不', '不支持'].includes(raw)) return false;
  return null;
}

// ── Hashtag normalization ──

const MAX_OZON_HASHTAG_LENGTH = 30;
const MAX_OZON_HASHTAG_COUNT = 20;

const KNOWN_HASHTAG_ATTR_IDS = new Set([23171, 22508]);

function isHashtagAttribute(attrId, meta) {
  const id = Number(attrId);
  if (KNOWN_HASHTAG_ATTR_IDS.has(id)) return true;
  const name = `${meta.name || ''}`.toLowerCase();
  return /hashtag|хештег|хэштег|тег|标签|主题标签/.test(name);
}

function sanitizeHashtagCore(value) {
  return String(value || '')
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, '_')
    // Ozon only allows letters, digits and underscore. Hyphens not allowed.
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeSingleHashtag(value) {
  let core = sanitizeHashtagCore(value);
  if (!core) return '';
  if (core.length + 1 > MAX_OZON_HASHTAG_LENGTH) {
    core = core.slice(0, MAX_OZON_HASHTAG_LENGTH - 1).replace(/[_-]+$/g, '');
  }
  return core ? `#${core}` : '';
}

function splitLongUnderscoreHashtag(value) {
  const words = String(value || '').replace(/^#+/, '').split(/_+/g).map((s) => s.trim()).filter(Boolean);
  return buildShortHashtagPhrases(words);
}

function splitLongPhraseToHashtags(value) {
  const words = String(value || '').replace(/^#+/, '').split(/\s+/g).map((s) => s.trim()).filter(Boolean);
  return buildShortHashtagPhrases(words);
}

function buildShortHashtagPhrases(words) {
  const out = []; let cur = '';
  for (const word of words) {
    const cw = sanitizeHashtagCore(word);
    if (!cw) continue;
    const next = cur ? `${cur}_${cw}` : cw;
    if (next.length + 1 <= MAX_OZON_HASHTAG_LENGTH) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = cw.length + 1 <= MAX_OZON_HASHTAG_LENGTH ? cw : cw.slice(0, MAX_OZON_HASHTAG_LENGTH - 1).replace(/[_-]+$/g, '');
  }
  if (cur) out.push(cur);
  return out;
}

function splitHashtagSource(value) {
  const raw = cleanText(value);
  if (!raw) return [];
  if (raw.includes('#')) {
    return raw.split(/(?=#)/g).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
  }
  const basic = raw.split(/[\n,，;；|]+/g).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const part of basic) {
    if (part.includes('_') && part.length > MAX_OZON_HASHTAG_LENGTH) { out.push(...splitLongUnderscoreHashtag(part)); continue; }
    if (part.length > MAX_OZON_HASHTAG_LENGTH && /\s/.test(part)) { out.push(...splitLongPhraseToHashtags(part)); continue; }
    out.push(part);
  }
  return out;
}

function normalizeHashtagList(tags) {
  const list = Array.isArray(tags) ? tags : [tags];
  const out = [];
  for (const raw of list) {
    for (const part of splitHashtagSource(raw)) {
      const tag = normalizeSingleHashtag(part);
      if (tag) out.push(tag);
    }
  }
  return uniqueStrings(out).slice(0, MAX_OZON_HASHTAG_COUNT).join(' ');
}

function normalizeHashtagString(value) {
  return normalizeHashtagList([value]);
}

function isValidOzonHashtagValue(value) {
  const text = cleanText(value);
  if (!text) return false;
  const tags = text.split(/\s+/).filter(Boolean);
  if (!tags.length) return false;
  return tags.every((t) => (
    t.startsWith('#') && t.length <= MAX_OZON_HASHTAG_LENGTH && /^#[\p{L}\p{N}_]+$/u.test(t)
  ));
}

// ── Dangerous optional numeric attribute filter ──

const DANGEROUS_AI_NUMERIC_OPTIONAL_ATTR_IDS = new Set([8383]);

function shouldDropUnsafeOptionalNumericAttribute(attrId, meta, value) {
  const id = Number(attrId);
  if (meta.isRequired === true) return false;
  const raw = cleanText(value);
  if (!raw) return false;
  const number = Number(raw.replace(',', '.'));
  if (!Number.isFinite(number)) return false;
  if (DANGEROUS_AI_NUMERIC_OPTIONAL_ATTR_IDS.has(id)) return true;
  if (number > 100000) return true;
  if (meta.maxValue && number > meta.maxValue) return true;
  return false;
}

function normalizeNonDictionaryValueForOzonImport(value, meta, attrId) {
  if (isHashtagAttribute(attrId, meta)) return normalizeHashtagString(value);
  if (isBooleanAttribute(meta)) return normalizeBooleanValue(value);
  if (shouldDropUnsafeOptionalNumericAttribute(attrId, meta, value)) return '';
  const text = cleanText(value);
  return text || '';
}

function allowsMultipleValues(meta) {
  if (meta.isCollection === true) return true;
  if (Number(meta.maxValueCount || 1) > 1) return true;
  return false;
}

function maxValueCountForImport(meta) {
  const v = Number(meta.maxValueCount || 1);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 50) : 1;
}

function dedupeAttributeValues(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = v.dictionary_value_id ? `dict:${v.dictionary_value_id}` : `value:${JSON.stringify(v.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

async function submitOzonDraft(settings, draft, options = {}) {
  if (!settings?.ozon?.clientId || !settings?.ozon?.apiKey) {
    throw new Error('Ozon Client-Id 或 API-Key 未配置。');
  }
  const items = Array.isArray(draft?.items) ? draft.items : [];
  if (!items.length) throw new Error('草稿中没有可提交的 Ozon 商品。');
  const missing = collectDraftMissing(items, draft);
  if (missing.length) throw new Error(`草稿缺少必填项：${missing.join('、')}`);

  // Prepare & normalize attributes for Ozon API rules
  const { importItems, metaByCategory } = await prepareOzonImportItems(settings, items);

  // Validate item names are in Russian before submitting
  for (const item of importItems) {
    const name = cleanText(item.name);
    if (name && /[一-鿿]/.test(name) && !/[а-яё]/i.test(name)) {
      throw new Error(`商品名称包含中文且无俄语：${name.slice(0, 60)}。请重新生成草稿获取俄语标题。`);
    }
  }

  validateRequiredCategoryAttributes(importItems, metaByCategory);

  const attrStats = importItems.map((item) => ({
    offer_id: item.offer_id,
    attrCount: Array.isArray(item.attributes) ? item.attributes.length : 0,
    attrIds: Array.isArray(item.attributes) ? item.attributes.map((a) => a.id) : [],
  }));
  process.stderr.write(`[ozon-submit] prepared import items ${JSON.stringify(attrStats)}\n`);

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
      priceResult: null,
      stockResult: null,
      warnings: ['Ozon 导入结果仍在处理中。'],
      submittedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  process.stderr.write(`[ozon-submit] import completed taskId=${taskId}; price/stock sync disabled\n`);

  return {
    ok: true,
    transport: 'ozon_seller_api',
    operationId: 'ProductAPI_ImportProductsV3',
    taskId,
    importStatus: 'imported',
    importResult: importResult.data,
    priceResult: null,
    stockResult: null,
    warnings: [],
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

function validateRequiredCategoryAttributes(items, metaByCategory) {
  const categoryKeys = uniqueStrings(items.map((item) => {
    const desc = Number(item.description_category_id);
    const type = Number(item.type_id);
    return desc && type ? `${desc}:${type}` : '';
  }));
  const missing = [];

  for (const key of categoryKeys) {
    const [descId, typeId] = key.split(':').map(Number);
    const requiredAttrs = Object.values(metaByCategory[key] || {})
      .filter((attr) => attr?.isRequired === true);
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
    const offerId = cleanText(item?.offer_id || item?.offerId || '');
    const status = String(item?.status || item?.state || '').toLowerCase();
    const rawErrors = Array.isArray(item?.errors) ? item.errors : [];
    if (/fail|error|declin|reject/.test(status) && rawErrors.length === 0) {
      errors.push([offerId, item?.status || item?.state].filter(Boolean).join(' | '));
    }
    for (const raw of rawErrors) {
      errors.push(formatImportError(raw, offerId));
    }
  }
  const rootErrors = Array.isArray(data?.result?.errors) ? data.result.errors : Array.isArray(data?.errors) ? data.errors : [];
  for (const raw of rootErrors) {
    errors.push(formatImportError(raw, ''));
  }
  return uniqueStrings(errors);
}

function formatImportError(raw, offerId) {
  if (typeof raw === 'string') return [offerId, raw].filter(Boolean).join(' | ');
  if (raw && typeof raw === 'object') {
    const parts = [offerId, raw.attribute_id || raw.attributeId || raw.field || raw.name || raw.code || '',
      raw.message || raw.error || JSON.stringify(raw)];
    return parts.filter(Boolean).join(' | ');
  }
  return String(raw);
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
    return { keyword, exactCategory, candidates: [], sourceRows };
  }

  const rawCandidates = buildCategoryCandidatesByKeyword(categoryIndex, keyword, sourceRows);
  const candidates = boostCandidatesByHints(rawCandidates, keyword, sourceRows);
  return { keyword, exactCategory: null, candidates, sourceRows };
}

function extractSearchKeyword(sourceRows) {
  const rows = Array.isArray(sourceRows) ? sourceRows : [];
  // First try explicit keyword fields from the search form
  const keys = ['search_keyword', 'searchKeyword', 'keyword', 'query', 'search_query', 'searchQuery', 'task_keyword', 'taskKeyword', '_keyword'];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of keys) {
      const value = cleanText(row[key]);
      if (value) return stripNoiseWords(value);
    }
  }
  // Fallback: extract from product title, stripping noise words first
  const first = rows[0] || {};
  const rawTitle = cleanText(first.search_word || first.product_title || first.title || first.sku_name);
  return stripNoiseWords(rawTitle);
}

function loadChineseCategoryIndex(settings) {
  const userDataPath = cleanText(settings?.userDataPath || settings?.paths?.userDataPath || settings?.appDataPath);
  const fileName = 'ozon_category_tree.zh_hans.json';
  const files = [];
  if (userDataPath) {
    files.push(path.join(userDataPath, 'categories', fileName));
    files.push(path.join(userDataPath, fileName));
    files.push(path.join(userDataPath, 'app', 'categories', fileName));
  }
  if (process.env.APPDATA) {
    files.push(path.join(process.env.APPDATA, '1688ToOzonStudio', 'app', 'categories', fileName));
    files.push(path.join(process.env.APPDATA, '1688 to Ozon Studio', fileName));
  }
  for (const file of Array.from(new Set(files))) {
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
  if (descriptionCategoryId && typeId && label && !containsCyrillic(pathText)) {
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

  // Build 2-grams from keyword and title for multi-char matching
  const kwBigrams = bigrams(normalizedKeyword);
  const titleBigrams = bigrams(titleText);

  const scored = [];
  for (const entry of categoryIndex) {
    let score = 0;
    const entryName = normalizeCategoryText(entry.keyword);
    const entryPath = normalizeCategoryText(entry.path || '');
    const entrySearch = entry.searchText;

    // Exact & substring matches (whole-word level, not single char)
    if (normalizedKeyword && entryName === normalizedKeyword) score += 100;
    if (normalizedKeyword && entryName.includes(normalizedKeyword)) score += 80;
    if (normalizedKeyword && normalizedKeyword.includes(entryName)) score += 60;
    if (normalizedKeyword && entryPath.includes(normalizedKeyword)) score += 40;
    if (normalizedKeyword && entrySearch.includes(normalizedKeyword)) score += 50;

    // Bigram overlap: keyword bigrams vs category name (requires consecutive 2-char match)
    if (kwBigrams.length > 0) {
      const nameBigrams = new Set(bigrams(entryName));
      const overlap = kwBigrams.filter((bg) => nameBigrams.has(bg)).length;
      score += overlap * 25;
    }

    // Title bigrams vs category name/path
    if (titleBigrams.length > 0) {
      const nameBigrams = new Set([...bigrams(entryName), ...bigrams(entryPath)]);
      const overlap = titleBigrams.filter((bg) => nameBigrams.has(bg)).length;
      score += overlap * 15;
    }

    if (score > 0) {
      scored.push({ score, entry });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 50).map((item, index) => ({
    candidate_index: index,
    description_category_id: item.entry.description_category_id,
    type_id: item.entry.type_id,
    path: item.entry.path,
    keyword: item.entry.keyword,
    _score: item.score,
  }));
}

// Extract consecutive 2-character substrings for n-gram matching.
// "西装" → ["西装"], "abc" → ["ab","bc"]
function bigrams(text) {
  const result = [];
  for (let i = 0; i < text.length - 1; i++) {
    result.push(text.slice(i, i + 2));
  }
  return result;
}

// ── AI messages ──

const MIN_VALID_WEIGHT_G = 2;

function validCollectedWeightG(value) {
  const w = positiveNumber(value);
  return w && w >= MIN_VALID_WEIGHT_G ? w : 0;
}

function validEstimatedWeightG(value) {
  const w = positiveNumber(value);
  return w && w >= MIN_VALID_WEIGHT_G ? w : 0;
}

function sourceRowsForAi(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 8).map((row) => {
    const collectedW = positiveNumber(row.weight_g);
    if (collectedW && collectedW < MIN_VALID_WEIGHT_G) {
      return {
        ...row,
        weight_g: null,
        weight_note: `Collected packed weight ${collectedW}g is invalid placeholder data and must be ignored. Estimate realistic packed weight in grams instead.`,
      };
    }
    return row;
  });
}

// Extract key product attributes to help AI understand what the product IS.
function extractProductAttributesForCategory(row) {
  if (!row || typeof row !== 'object') return {};
  const attrs = row.product_attributes_structured || row.attributes || row.product_attributes || {};
  if (typeof attrs !== 'object' || Array.isArray(attrs)) return {};
  // Pick the most category-relevant attribute keys
  const relevantKeys = ['材质', '面料', '成分', '风格', '款式', '版型', '适用性别', '性别', '季节', '适用季节', '品类', '类型', '用途', '功能', '领型', '袖长', '衣长', '裤长', '裙长'];
  const picked = {};
  for (const key of relevantKeys) {
    const val = attrs[key];
    if (val && typeof val === 'string' && val.trim()) picked[key] = val.trim();
  }
  return picked;
}

function buildMessages(rows, candidates) {
  const sourceRowsCleaned = sourceRowsForAi(rows);
  const firstRow = (Array.isArray(rows) ? rows[0] : null) || {};

  // Build product context to help AI pick the right category
  const productContext = {
    title: firstRow.product_title || firstRow.title || '',
    attributes: extractProductAttributesForCategory(firstRow),
    search_keyword: firstRow.search_keyword || firstRow.keyword || firstRow.searchKeyword || '',
    sku_count: Array.isArray(rows) ? rows.length : 1,
  };

  const categoryRule = candidates.length
    ? 'Category selection rule: Read product_context carefully. Choose the ONE candidate_index whose category path best matches the product. Look at product_context.title and product_context.attributes to understand what the product IS (e.g. a suit jacket, a phone case, a dress). Then find the category_candidates entry with the most relevant path. Prefer deeper (more specific) paths. Do NOT pick based on partial character overlap alone.'
    : 'Category selection rule: No candidates available. Return candidate_index as null.';

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
    source_rows: sourceRowsCleaned,
    product_context: productContext,
    category_selection_rule: categoryRule,
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
      weight_g: validEstimatedWeightG(data?.estimated_dimensions?.weight_g),
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
  const collectedW = validCollectedWeightG(row.weight_g);
  const aiWeight = validEstimatedWeightG(dims.weight_g);
  const weight = collectedW || aiWeight || 0;
  const attrs = [];
  addAttribute(attrs, ATTR_MODEL_NAME, generated.model_name || generated.title_ru);
  addAttribute(attrs, ATTR_DESCRIPTION, generated.description_ru);
  // hashtag attributes (23171/22508) are no longer submitted to Ozon —
  // they cause repeated "advertising/promotional" audit warnings.
  // Merge backend-generated category attributes into item.attributes
  addGeneratedCategoryAttributes(attrs, generated);
  return {
    name: (generated.title_ru && /[а-яё]/i.test(generated.title_ru)
      ? generated.title_ru
      : `Товар из 1688 ${String(cleanText(row.product_title) || cleanText(row.sku_name) || '').replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 80)}`).slice(0, 500),
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
    dimension_unit: 'mm',
    depth: numberForOzon(depth) * 10 || 0,
    width: numberForOzon(width) * 10 || 0,
    height: numberForOzon(height) * 10 || 0,
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

// Map variant dimension source_names to Ozon category attribute IDs.
// Uses built-in mapping table first, then name matching against category attrs.
function mapVariantDimensionsToOzonAttrs(variant, normalized) {
  if (!variant || !Array.isArray(variant.dimensions)) return;

  // Use full category attribute definitions (stored by fillCategoryAttributes)
  const catAttrs = Array.isArray(normalized._category_attributes)
    ? normalized._category_attributes
    : [];

  for (const dim of variant.dimensions) {
    if (!dim || dim.ozon_attribute_id) continue;
    const srcName = (dim.source_name || '').trim();
    if (!srcName) continue;

    // 1. Built-in mapping: find matching Ozon attribute by keyword
    const srcEntry = BUILTIN_ATTR_MAP.find((e) =>
      e.keys.some((k) => srcName.toLowerCase().includes(k.toLowerCase()))
    );
    if (srcEntry && catAttrs.length > 0) {
      // Search category attrs for one whose name contains the hint keywords
      const match = catAttrs.find((a) =>
        srcEntry.keys.some((k) => (a.name || '').toLowerCase().includes(k.toLowerCase()))
      );
      if (match) {
        dim.ozon_attribute_id = Number(match.id);
        dim.ozon_attribute_name = match.name || srcEntry.cn;
        dim.dictionary_id = match.dictionaryId || null;
        dim.mapping_status = 'builtin_mapped';
        continue;
      }
    }

    // 2. Fallback: fuzzy name match against category attribute names
    if (catAttrs.length > 0) {
      const fuzzy = catAttrs.find((a) =>
        (a.name || '').toLowerCase().includes(srcName.toLowerCase())
      );
      if (fuzzy) {
        dim.ozon_attribute_id = Number(fuzzy.id);
        dim.ozon_attribute_name = fuzzy.name || '';
        dim.dictionary_id = fuzzy.dictionaryId || null;
        dim.mapping_status = 'fuzzy_mapped';
        continue;
      }
    }

    // 3. Builtin hint but no Ozon attr match
    if (srcEntry) {
      dim.ozon_attribute_name = srcEntry.cn;
      dim.mapping_status = 'builtin_no_ozon_match';
    } else {
      dim.mapping_status = 'needs_ozon_attribute';
    }
  }

  // Update variant status
  const allMapped = variant.dimensions.every((d) => d.ozon_attribute_id > 0);
  if (allMapped && variant.dimensions.length > 0) {
    variant.status = 'mapped';
    variant.confirmed = true;
  }
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
    const visibleAttrs = visibleDraftCategoryAttributes(catAttrs.attributes || []);
    const requiredFillAttrs = visibleAttrs.filter((attr) => attr.isRequired === true);
    log(`step 1 done: ${visibleAttrs.length} visible attrs, ${requiredFillAttrs.length} required autofill targets`);
    if (!visibleAttrs.length) { log('SKIP: no attributes'); return; }
    if (!requiredFillAttrs.length) {
      // Metadata must never shrink to required-only: keep the full list even
      // when there is nothing to autofill.
      normalized.attribute_values = [];
      normalized._category_attributes = visibleAttrs;
      log('SKIP: no required attributes to autofill; full metadata kept');
      return;
    }

    // 2. Pre-match using built-in mapping table (source 1688 attrs → Ozon attrs)
    log('step 2a: builtin attr mapping...');
    const source1688Attrs = {};
    for (const row of sourceRows.slice(0, 3)) {
      if (row && typeof row === 'object') {
        const attrs = row.product_attributes_structured || row.attributes || row.product_attributes || {};
        Object.assign(source1688Attrs, attrs);
      }
    }
    const builtinHits = [];
    const builtinMatchedIds = new Set();
    for (const attr of requiredFillAttrs) {
      const val = matchOzonAttrByBuiltinMap(attr.name, source1688Attrs);
      if (val) {
        builtinHits.push({ attr, value: val });
        builtinMatchedIds.add(Number(attr.id));
      }
    }
    log(`step 2a done: ${builtinHits.length} builtin matches (required-only)`);

    // 3. AI suggests for remaining (unmatched) required attributes
    const remainingAttrs = requiredFillAttrs.filter((a) => !builtinMatchedIds.has(Number(a.id)));
    const optionalRemaining = remainingAttrs.filter((attr) => attr.isRequired !== true);
    if (optionalRemaining.length > 0) {
      log(`WARN: ${optionalRemaining.length} optional attrs leaked into AI target — must never happen`);
    }
    let aiSuggestions = [];
    if (remainingAttrs.length > 0) {
      log(`step 2b: callAi for ${remainingAttrs.length} remaining attrs...`);
      try {
        const messages = buildAttributeSuggestionMessages(sourceRows, remainingAttrs, {}, { descriptionCategoryId: descId, typeId, path: category.path || '' });
        const suggestionData = await callAi(settings.ai, messages);
        const suggestions = normalizeAttributeSuggestions(suggestionData, remainingAttrs);
        aiSuggestions = suggestions.attributes || [];
        log(`step 2b done: ${aiSuggestions.length} AI suggestions`);
      } catch (e) {
        log(`step 2b AI failed: ${e?.message || e}`);
      }
    }

    // 4. Resolve dictionary values with multi-round retry
    const resolved = [];
    const pushResolved = (attr, valueText, dictId, src) => {
      if (!cleanText(valueText)) return;
      const isDict = Number(attr.dictionaryId || 0) > 0;
      const numericId = Number(dictId || 0);
      // Dictionary attributes only count as filled with a REAL
      // dictionary_value_id. Text-only fallbacks are dropped here so they
      // can never reach the draft (second line of defense after the
      // resolve-failure branch above).
      if (isDict && numericId <= 0) {
        log(`[ozon-draft:dict] DROP unresolved dictionary attrId=${attr.id} attrName=${attr.name} source=${src} query=${cleanText(valueText)}`);
        return;
      }
      resolved.push({
        attribute_id: attr.id,
        value_text: cleanText(valueText),
        dictionary_value_id: isDict ? numericId : null,
        confidence: numericId ? 0.9 : 0.5,
        _source: src,
      });
    };

    // 4a. Resolve builtin hits
    for (const { attr, value } of builtinHits) {
      if (attr.dictionaryId) {
        const result = await resolveDictValueWithFallback(userDataPath, descId, typeId, attr, value, log);
        if (result) pushResolved(attr, result.label, result.id, 'builtin');
        // Resolve failure: the attribute stays EMPTY. Raw 1688 text is
        // never a valid Ozon dictionary value.
      } else {
        pushResolved(attr, value, null, 'builtin');
      }
    }

    // 4b. Resolve AI suggestions — defensive: only required autofill targets
    // may enter resolved, even if the AI response names an optional ID.
    for (const s of aiSuggestions) {
      const attr = requiredFillAttrs.find((a) => Number(a.id) === Number(s.attribute_id));
      if (!attr) continue;

      if (attr.dictionaryId) {
        const query = cleanText(s.dictionary_query || s.value_text || '');
        if (query) {
          const result = await resolveDictValueWithFallback(userDataPath, descId, typeId, attr, query, log);
          if (result) pushResolved(attr, result.label, result.id, 'ai');
          // Resolve failure: stay empty. AI text is a search hint, not a
          // dictionary value.
        }
      } else {
        pushResolved(attr, s.value_text, null, 'ai');
      }
    }

    log(`step 4 done: ${resolved.length} resolved values (builtin=${builtinHits.length}, ai=${aiSuggestions.length})`);
    normalized.attribute_values = resolved;
    // Store full attribute definitions for variant dimension mapping later.
    // Metadata is NOT the autofill result: keep required + optional together.
    normalized._category_attributes = visibleAttrs;
  } catch (err) {
    log(`FAILED: ${err?.message || err}\n${err?.stack || ''}`);
  }
}

// ── Complete draft: fill all required attributes ──

async function completeOzonDraftItems(settings, sourceRows, normalized, items) {
  const category = normalized.matched_category || {};
  const descId = Number(category.description_category_id || 0);
  const typeId = Number(category.type_id || 0);
  if (!descId || !typeId) return { ok: false, missing: ['Ozon 类目'] };

  const userDataPath = cleanText(settings?.userDataPath || settings?.paths?.userDataPath || '');

  let catAttrs;
  try {
    catAttrs = await getCategoryAttributes(userDataPath, { descriptionCategoryId: descId, typeId, language: 'ZH_HANS' });
  } catch { return { ok: false, missing: ['类目属性加载失败'] }; }

  const allAttrs = Array.isArray(catAttrs.attributes) ? catAttrs.attributes : [];
  const requiredAttrs = allAttrs.filter((a) => a.isRequired);
  const fillableAttrs = visibleDraftCategoryAttributes(allAttrs);
  // Dynamic defaults (origin country / gender) may only autofill REQUIRED
  // dynamic attributes. allAttrs stays the full metadata source.
  const requiredFillableAttrs = fillableAttrs.filter((attr) => attr.isRequired === true);

  // Step 1: apply generated attribute_values to all items
  applyGeneratedAttributeValuesToItems(items, normalized.attribute_values, allAttrs);

  // Step 2: apply backend defaults (origin country, brand, weight)
  await applyBackendDefaultsToItems(settings, userDataPath, descId, typeId, sourceRows, items, requiredFillableAttrs, allAttrs);

  // Step 3: check what's still missing
  let missingRequired = missingRequiredCategoryAttributes(items[0], requiredAttrs);
  let mergedValues = Array.isArray(normalized.attribute_values) ? [...normalized.attribute_values] : [];

  // Step 4: AI retry for missing required — up to 2 rounds
  for (let attempt = 1; attempt <= 2 && missingRequired.length > 0; attempt++) {
    process.stderr.write(`[ozon-draft] retry round ${attempt}: ${missingRequired.length} missing required attrs\n`);
    try {
      const suggestions = await generateMissingAttributeSuggestions(settings, sourceRows, normalized, missingRequired, fillableAttrs);

      const resolved = await resolveAttributeSuggestionsToOzonValues(
        settings, userDataPath, descId, typeId, suggestions, fillableAttrs,
      );

      applyGeneratedAttributeValuesToItems(items, resolved, allAttrs);
      mergedValues = mergeAttributeValues(mergedValues, resolved);
    } catch (err) {
      process.stderr.write(`[ozon-draft] retry round ${attempt} failed: ${err?.message || err}\n`);
      break;
    }
    missingRequired = missingRequiredCategoryAttributes(items[0], requiredAttrs);
  }

  normalized.attribute_values = mergedValues;
  return { ok: missingRequired.length === 0, missing: missingRequired.map((a) => a.name || String(a.id)) };
}

function applyGeneratedAttributeValuesToItems(items, attributeValues, categoryAttributes) {
  const values = sanitizeGeneratedAttributeValues(attributeValues, categoryAttributes);
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const attrs = Array.isArray(item.attributes) ? item.attributes : [];
    addGeneratedCategoryAttributes(attrs, { attribute_values: values });
    item.attributes = attrs;
  }
}

// Unified gate for every generated attribute value entering draft items.
// Dictionary attributes (attr.dictionaryId > 0) are only valid with a real
// dictionary_value_id; text-only values are dropped. Non-dictionary values
// must keep a non-empty text.
function sanitizeGeneratedAttributeValues(attributeValues, categoryAttributes) {
  const metaById = new Map(
    (Array.isArray(categoryAttributes) ? categoryAttributes : [])
      .filter((attr) => Number(attr?.id || 0) > 0)
      .map((attr) => [Number(attr.id), attr]),
  );
  return (Array.isArray(attributeValues) ? attributeValues : []).filter((raw) => {
    const value = raw && typeof raw === 'object' ? raw : {};
    const attrId = Number(value.attribute_id || value.id || 0);
    if (!attrId) return false;
    const meta = metaById.get(attrId) || {};
    const isDict = Number(meta.dictionaryId || 0) > 0;
    const textValue = cleanText(value.value_text || value.value || '');
    const dictId = Number(value.dictionary_value_id || value.dictionaryValueId || 0);
    if (isDict) return dictId > 0;
    return Boolean(textValue) || dictId > 0;
  });
}

function missingRequiredCategoryAttributes(item, requiredAttrs) {
  const attrs = Array.isArray(requiredAttrs) ? requiredAttrs : [];
  return attrs.filter((a) => {
    const id = Number(a.id || 0);
    return id > 0 && !CONTROLLED_ATTR_IDS.has(id) && !itemHasValidCategoryAttribute(item, a);
  });
}

// A category attribute is only "filled" when it carries a usable value:
// dictionary attributes need at least one real dictionary_value_id (> 0),
// free-text attributes need a non-empty text value.
function itemHasValidCategoryAttribute(item, attrMeta) {
  const attrId = Number(attrMeta?.id || 0);
  if (!attrId) return false;
  const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
  const raw = attrs.find((a) => Number(a.id) === attrId);
  if (!raw) return false;
  const values = Array.isArray(raw.values) ? raw.values : [];
  if (!values.length) return false;
  const isDict = Number(attrMeta?.dictionaryId || 0) > 0;
  return values.some((v) => {
    const value = v && typeof v === 'object' ? v : {};
    if (isDict) {
      return Number(value.dictionary_value_id || value.dictionaryValueId || 0) > 0;
    }
    return Boolean(cleanText(value.value || value.value_text || ''));
  });
}

async function applyBackendDefaultsToItems(settings, userDataPath, descId, typeId, sourceRows, items, fillableAttrs, allAttrs) {
  // Origin country → 中国
  for (const attr of fillableAttrs) {
    if (/原产国|制造国|country|страна/.test((attr.name || '').toLowerCase())) {
      const isDict = Number(attr.dictionaryId || 0) > 0;
      if (!isDict) {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const attrs = Array.isArray(item.attributes) ? item.attributes : [];
          attrs.push(buildSingleAttributeEntry(attr.id, '中国', 0));
          item.attributes = attrs;
        }
        break;
      }
      const resolved = await resolveSingleDictionaryValue(settings, userDataPath, descId, typeId, attr, '中国');
      if (resolved && resolved.dictionary_value_id > 0) {
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const attrs = Array.isArray(item.attributes) ? item.attributes : [];
          attrs.push(buildSingleAttributeEntry(attr.id, resolved.value_text, resolved.dictionary_value_id));
          item.attributes = attrs;
        }
      } else {
        process.stderr.write(`[ozon-draft:dict] DROP unresolved dictionary attrId=${attr.id} attrName=${attr.name} source=default query=中国\n`);
      }
      break;
    }
  }

  // Brand → Нет бренда for ALL brand-like attributes (id=85, id=31, etc.)
  // FORCE override — always use Нет бренда regardless of what AI or prefill set.
  const brandAttrs = allAttrs.filter((a) => {
    const name = (a.name || '').toLowerCase();
    return /品牌|бренд|brand/.test(name) || Number(a.id) === 85 || Number(a.id) === 31;
  });
  for (const brandAttr of brandAttrs) {
    const resolved = await resolveSingleDictionaryValue(settings, userDataPath, descId, typeId, brandAttr, 'Нет бренда');
    if (resolved && resolved.dictionary_value_id > 0) {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        let attrs = Array.isArray(item.attributes) ? item.attributes : [];
        // Remove any existing brand value (AI might have set "其他")
        attrs = attrs.filter((a) => Number(a.id) !== Number(brandAttr.id));
        attrs.push(buildSingleAttributeEntry(brandAttr.id, 'Нет бренда', resolved.dictionary_value_id));
        item.attributes = attrs;
      }
    }
  }

  // Gender → AI picks from dictionary based on 1688 source data
  for (const attr of fillableAttrs) {
    if (!/性别|пол|gender/.test((attr.name || '').toLowerCase())) continue;
    let hasGender = false;
    for (const item of items) {
      const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
      if (attrs.some((a) => Number(a.id) === Number(attr.id) && Array.isArray(a.values) && a.values.length > 0)) hasGender = true;
    }
    if (!hasGender) {
      const genderHint = inferGenderFromSource(sourceRows);
      if (genderHint) {
        const log = (msg) => process.stderr.write(`[ozon-draft:gender] ${msg}\n`);
        const resolved = await resolveDictValueWithFallback(userDataPath, descId, typeId, attr, genderHint, log);
        if (resolved && resolved.id > 0) {
          for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const a = Array.isArray(item.attributes) ? item.attributes : [];
            a.push(buildSingleAttributeEntry(attr.id, resolved.label, resolved.id));
            item.attributes = a;
          }
        }
      }
    }
  }
}

function inferGenderFromSource(sourceRows) {
  const text = (Array.isArray(sourceRows) ? sourceRows : [])
    .slice(0, 3)
    .map((r) => `${r.product_title || ''} ${r.title || ''} ${r.sku_name || ''}`)
    .join(' ')
    .toLowerCase();
  if (/女|жен|women|girl|female|lady|妈妈|姑娘|小姐|孕妇/.test(text)) return '女童';
  if (/男|муж|men|boy|male|爸爸|先生|男士/.test(text)) return '男童';
  if (/男女|通用|中性|унисекс|unisex/.test(text)) return '中性';
  // Check 1688 attributes
  for (const row of (Array.isArray(sourceRows) ? sourceRows : [])) {
    const attrs = row.product_attributes_structured || row.attributes || {};
    const gender = String(attrs['适用性别'] || attrs['性别'] || '');
    if (/女/.test(gender)) return '女童';
    if (/男/.test(gender)) return '男童';
  }
  return null;
}

function buildSingleAttributeEntry(attrId, valueText, dictionaryValueId) {
  const valueEntry = {};
  if (dictionaryValueId > 0) valueEntry.dictionary_value_id = dictionaryValueId;
  if (valueText) valueEntry.value = valueText;
  return { id: Number(attrId), complex_id: 0, values: [valueEntry] };
}

async function resolveSingleDictionaryValue(settings, userDataPath, descId, typeId, attr, query) {
  if (!attr.dictionaryId || !query) return null;
  try {
    const searchResp = await getCategoryAttributeValues(userDataPath, { descriptionCategoryId: descId, typeId, attributeId: attr.id, limit: 10, query });
    const searchOptions = searchResp.values || [];
    if (!searchOptions.length) return null;
    const zhResp = await getCategoryAttributeValues(userDataPath, { descriptionCategoryId: descId, typeId, attributeId: attr.id, language: 'ZH_HANS', limit: 2000 });
    const zhOptions = zhResp.values || [];
    const matched = searchOptions[0];
    const zhMatch = zhOptions.find((v) => v.id === matched.id);
    return {
      attribute_id: attr.id,
      value_text: zhMatch ? cleanText(zhMatch.value) : cleanText(matched.value),
      dictionary_value_id: matched.id,
    };
  } catch { return null; }
}

// Multi-round dictionary resolution with fallback strategies.
// Returns { label, id } on success, null if all rounds fail.
async function resolveDictValueWithFallback(userDataPath, descId, typeId, attr, query, log) {
  if (!attr.dictionaryId || !query) return null;

  // Round 1: exact query from AI/builtin mapping
  try {
    const r1 = await getCategoryAttributeValues(userDataPath, {
      descriptionCategoryId: descId, typeId, attributeId: attr.id, limit: 10, query,
    });
    if (r1.values && r1.values.length > 0) {
      const zhResp = await getCategoryAttributeValues(userDataPath, {
        descriptionCategoryId: descId, typeId, attributeId: attr.id, language: 'ZH_HANS', limit: 2000,
      });
      const zhOpts = zhResp.values || [];
      const m = r1.values[0];
      const zh = zhOpts.find((v) => v.id === m.id);
      return { label: zh ? cleanText(zh.value) : cleanText(m.value), id: m.id };
    }
  } catch (e) { log(`dict round1 failed: ${e?.message || e}`); }

  // Round 2: simplified query — first 2 words only
  const simplified = query.split(/[\s,;，；]+/).slice(0, 2).join(' ');
  if (simplified && simplified !== query) {
    try {
      const r2 = await getCategoryAttributeValues(userDataPath, {
        descriptionCategoryId: descId, typeId, attributeId: attr.id, limit: 20, query: simplified,
      });
      if (r2.values && r2.values.length > 0) {
        const zhResp = await getCategoryAttributeValues(userDataPath, {
          descriptionCategoryId: descId, typeId, attributeId: attr.id, language: 'ZH_HANS', limit: 2000,
        });
        const zhOpts = zhResp.values || [];
        const m = r2.values[0];
        const zh = zhOpts.find((v) => v.id === m.id);
        return { label: zh ? cleanText(zh.value) : cleanText(m.value), id: m.id };
      }
    } catch (e) { log(`dict round2 failed: ${e?.message || e}`); }
  }

  // Round 3: fetch full list and fuzzy-match by substring
  try {
    const r3 = await getCategoryAttributeValues(userDataPath, {
      descriptionCategoryId: descId, typeId, attributeId: attr.id, language: 'ZH_HANS', limit: 500,
    });
    const opts = r3.values || [];
    if (opts.length > 0) {
      const q = query.toLowerCase();
      // Score: exact match > startsWith > includes
      let best = null, bestScore = 0;
      for (const v of opts) {
        const label = (v.value || '').toLowerCase();
        let score = 0;
        if (label === q) score = 100;
        else if (label.startsWith(q)) score = 70;
        else if (label.includes(q)) score = 40;
        else if (q.includes(label)) score = 20;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      if (best && bestScore >= 20) {
        return { label: cleanText(best.value), id: best.id };
      }
    }
  } catch (e) { log(`dict round3 failed: ${e?.message || e}`); }

  return null;
}

async function generateMissingAttributeSuggestions(settings, sourceRows, normalized, missingAttrs, allAttrs) {
  const messages = buildAttributeSuggestionMessages(sourceRows, missingAttrs, {}, {
    descriptionCategoryId: Number(normalized.matched_category?.description_category_id || 0),
    typeId: Number(normalized.matched_category?.type_id || 0),
    path: normalized.matched_category?.path || '',
  });
  const data = await callAi(settings.ai, messages);
  const result = normalizeAttributeSuggestions(data, missingAttrs);
  return result.attributes || [];
}

async function resolveAttributeSuggestionsToOzonValues(settings, userDataPath, descId, typeId, suggestions, attrs) {
  const resolved = [];
  for (const s of suggestions) {
    const attr = attrs.find((a) => Number(a.id) === Number(s.attribute_id));
    if (!attr) continue;
    if (attr.dictionaryId) {
      const query = cleanText(s.dictionary_query || s.value_text || '');
      if (query) {
        const r = await resolveSingleDictionaryValue(settings, userDataPath, descId, typeId, attr, query);
        if (r) resolved.push(r);
      }
    } else {
      const txt = cleanText(s.value_text);
      if (txt) resolved.push({ attribute_id: attr.id, value_text: txt });
    }
  }
  return resolved;
}

function mergeAttributeValues(existing, incoming) {
  const map = new Map();
  for (const v of existing) map.set(Number(v.attribute_id), v);
  for (const v of incoming) map.set(Number(v.attribute_id), v);
  return Array.from(map.values());
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}

function collectDraftMissing(items, draft) {
  const missing = new Set();
  for (const item of items) {
    if (!item.name || hasSuspiciousTitleStructure(item.name)) missing.add('商品名称');
    if (!item.primary_image) missing.add('主图');
    if (!item.description_category_id || !item.type_id) missing.add('Ozon 类目');
    if (!Number(item.price)) missing.add('价格');
    for (const [key, label] of [['depth', '长'], ['width', '宽'], ['height', '高']]) {
      if (!Number(item[key])) missing.add(label);
    }
    const weightVal = positiveNumber(item.weight);
    if (!weightVal || weightVal < MIN_VALID_WEIGHT_G) missing.add('含包装重量');
  }
  if (hasUnconfirmedVariantMapping(draft)) missing.add('规格属性映射');
  return Array.from(missing);
}

function hasUnconfirmedVariantMapping(draft) {
  const sourceRows = Array.isArray(draft?.sourceRows) ? draft.sourceRows : [];
  const generated = draft?.generated && typeof draft.generated === 'object' ? draft.generated : {};
  if (sourceRows.length <= 1) return false;
  const variant = variantMappingOf(draft, generated);
  if (variant.confirmed === true || variant.status === 'confirmed' || variant.status === 'not_required') return false;
  return true;
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
    values: [{ value: text }],
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

module.exports = { generateOzonDraft, submitOzonDraft, collectDraftMissing, generateOzonAttributeSuggestions, sanitizeGeneratedAttributeValues };
