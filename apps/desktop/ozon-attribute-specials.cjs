// Lightweight foundation for the future unified Attribute Resolution
// Engine. Round A scope is ONLY the "合并至一张卡片" (merge into a single
// card) system-controlled special attribute:
//
//   classifier  : classifyOzonAttribute -> 'special' | 'dictionary' | 'free_text'
//   matcher     : isMergeCardAttribute (exact metadata name match)
//   formatter   : formatMergeCardKey (LOCAL time, yyyyMMddHHmmss, never UTC)
//   draft state : merge_card_key lives on draft.generated, created ONCE per
//                 product draft and shared by EVERY SKU
//   migration   : historical Chinese/dirty/inconsistent values are replaced
//                 by one new key; an existing valid 14-digit key is adopted
//
// Dictionary resolution engines are intentionally NOT part of this module.

const MERGE_CARD_KEY_REGEX = /^\d{14}$/;

// Exact official metadata names / explicit aliases. Exact-match ONLY —
// wide substring matching (e.g. name.includes('合并')) is forbidden here.
const MERGE_CARD_ATTR_NAMES = new Set([
  '合并至一张卡片',
  'объединить в одну карточку',
  'объединять в одну карточку',
  'объединять на одной карточке',
  'объединение в одну карточку',
]);

function normalizeAttributeName(name) {
  return String(name || '').trim().toLowerCase();
}

function isMergeCardAttribute(attr) {
  if (!attr || typeof attr !== 'object') return false;
  if (attr.kind === 'special') return true;
  return MERGE_CARD_ATTR_NAMES.has(normalizeAttributeName(attr.name));
}

function classifyOzonAttribute(attr) {
  if (isMergeCardAttribute(attr)) return 'special';
  if (Number(attr?.dictionaryId || 0) > 0) return 'dictionary';
  return 'free_text';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Local wall-clock time — toISOString (UTC) is deliberately NOT used.
function formatMergeCardKey(date = new Date()) {
  return (
    String(date.getFullYear()) +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds())
  );
}

function resolveSpecialAttribute({ attr, mergeCardKey }) {
  return {
    attribute_id: Number(attr.id),
    value_text: String(mergeCardKey || ''),
    dictionary_value_id: null,
    source: 'system:merge-card',
  };
}

// Draft-level single source of truth + historical migration:
// 1. draft.generated.merge_card_key (valid 14 digits) wins.
// 2. ALL items carrying the SAME valid 14-digit value -> adopt it (no
//    regrouping of an already-working draft).
// 3. Chinese/dirty/inconsistent values -> generate ONE new key and let the
//    caller overwrite every SKU with it.
function resolveDraftMergeCardKey(generated, items, specialAttrs) {
  const existing = String(generated?.merge_card_key || '').trim();
  if (MERGE_CARD_KEY_REGEX.test(existing)) return existing;

  const ids = new Set((specialAttrs || []).map((attr) => Number(attr.id)).filter(Boolean));
  const values = [];
  for (const item of Array.isArray(items) ? items : []) {
    const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
    for (const raw of attrs) {
      const attr = raw && typeof raw === 'object' ? raw : {};
      if (!ids.has(Number(attr.id))) continue;
      for (const v of Array.isArray(attr.values) ? attr.values : []) {
        const entry = v && typeof v === 'object' ? v : {};
        const text = String(entry.value || entry.value_text || '').trim();
        if (text) values.push(text);
      }
    }
  }
  const uniq = Array.from(new Set(values));
  if (uniq.length === 1 && MERGE_CARD_KEY_REGEX.test(uniq[0])) return uniq[0];
  return formatMergeCardKey();
}

// System value wins: every existing value for the attr is removed on ALL
// items, then the single draft-level key is pushed. User edits and stale
// AI values can never break SKU grouping.
function applyMergeCardKeyToItems(items, attrMeta, mergeCardKey) {
  const attrId = Number(attrMeta?.id || 0);
  if (!attrId || !MERGE_CARD_KEY_REGEX.test(String(mergeCardKey || ''))) return;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    let attrs = Array.isArray(item.attributes) ? item.attributes : [];
    attrs = attrs.filter((raw) => Number(raw?.id || raw?.attribute_id || 0) !== attrId);
    attrs.push({ id: attrId, complex_id: 0, values: [{ value: String(mergeCardKey) }] });
    item.attributes = attrs;
  }
}

// Collect the special merge-card attribute metas declared by any category
// metadata map (category key -> {attrId -> attrMeta}).
function collectSpecialMergeCardAttrs(metaByCategory) {
  const seen = new Map();
  for (const meta of Object.values(metaByCategory || {})) {
    for (const attr of Object.values(meta || {})) {
      const attrObj = attr && typeof attr === 'object' ? attr : {};
      if (classifyOzonAttribute(attrObj) !== 'special') continue;
      seen.set(Number(attrObj.id), attrObj);
    }
  }
  return Array.from(seen.values());
}

function countUniqueMergeCardValues(items, specialAttrs) {
  const ids = new Set((specialAttrs || []).map((attr) => Number(attr.id)).filter(Boolean));
  const values = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const attrs = Array.isArray(item?.attributes) ? item.attributes : [];
    for (const raw of attrs) {
      const attr = raw && typeof raw === 'object' ? raw : {};
      if (!ids.has(Number(attr.id))) continue;
      for (const v of Array.isArray(attr.values) ? attr.values : []) {
        values.add(String(v?.value || '').trim());
      }
    }
  }
  return values.size;
}

module.exports = {
  MERGE_CARD_KEY_REGEX,
  MERGE_CARD_ATTR_NAMES,
  classifyOzonAttribute,
  isMergeCardAttribute,
  formatMergeCardKey,
  resolveSpecialAttribute,
  resolveDraftMergeCardKey,
  applyMergeCardKeyToItems,
  collectSpecialMergeCardAttrs,
  countUniqueMergeCardValues,
};
