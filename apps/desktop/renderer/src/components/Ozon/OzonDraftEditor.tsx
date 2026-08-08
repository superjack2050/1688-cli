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
import { formatMissingFields } from '../Results/ozonListing/precheck';
import {
  ATTR_BRAND,
  ATTR_DESCRIPTION,
  ATTR_MODEL,
  ATTR_RICH_CONTENT,
  ATTR_TAGS,
  ATTR_WEIGHT,
  buildDraft,
  buildVariantTableView,
  buildEditorValidationIssues,
  collectChineseTextViolations,
  collectDraftBlockers,
  collectHiddenRequiredAttributes,
  collectUnsupportedRequiredMediaAttributes,
  containsChineseText,
  CONTROLLED_ATTR_IDS,
  createDraftForm,
  createImageManagerSession,
  filterCategoryAttributesForMoreAttrs,
  filterMissingRequiredAttributes,
  filterRequiredOnlyAttributes,
  firstItemOf,
  intForPayload,
  normalizeImageUrl,
  normalizeRichContentJson,
  objectOf,
  parseCustomAttributesDetailed,
  pruneDynamicValuesForCategory,
  resolvePrefillableAttributeValues,
  sanitizeDictionarySelections,
  text,
  validationSectionLabel,
  validDictionarySelectedLabels,
  type AttributeLoadState,
  type CategoryTreeViewNode,
  type DictionaryValueIds,
  type DraftBuildResult,
  type DraftForm,
  type EditorValidationIssue,
  type ImageManagerSession,
  type VariantRowView,
} from './ozonEditorUtils';
import OzonEditorNav, { type EditorSectionId } from './OzonEditorNav';
import OzonEditorBottomBar, { type ValidationState } from './OzonEditorBottomBar';
import OzonCategoryDrawer from './OzonCategoryDrawer';
import OzonImageManager from './OzonImageManager';

function categoryDescriptionId(entry: OzonCategoryEntry): number {
  return Number(entry.descriptionCategoryId || entry.description_category_id || 0);
}

function categoryTypeId(entry: OzonCategoryEntry): number {
  return Number(entry.typeId || entry.type_id || 0);
}

function validationTargetClass(base: string, targetKey: string, flashingTargetKey: string | null): string {
  return `${base}${flashingTargetKey === targetKey ? ' ozon-validation-flash' : ''}`;
}

function FieldError({ show, text: value }: { show: boolean; text: string }) {
  if (!show) return null;
  return <small className="ozon-attr-error-text">{value}</small>;
}

function sourceSummary(task: OzonListingTask): string {
  const row = objectOf(task.draft?.sourceRows?.[0]);
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
  // Only selections with a real dictionary_value_id count as selected.
  // Text-only lines (stale history or unresolved AI hints) are never shown.
  const selected = validDictionarySelectedLabels(value, valueIds);
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
      <button
        type="button"
        className={`ozon-dictionary-trigger${selected.length ? '' : ' is-empty'}`}
        onClick={openDropdown}
      >
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

export default function OzonDraftEditor({ task, onTaskUpdate, onBackTo1688, onClose, onToast }: {
  task: OzonListingTask;
  onTaskUpdate?: (key: string, patch: OzonListingTaskPatch) => void;
  onBackTo1688: () => void;
  onClose: () => void;
  onToast?: (message: string) => void;
}) {
  const [form, setForm] = useState<DraftForm>(() => createDraftForm(task));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [shopLabel, setShopLabel] = useState('Ozon 店铺：未检查');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryAttributes, setCategoryAttributes] = useState<OzonCategoryAttribute[]>([]);
  const [attributeLoadState, setAttributeLoadState] = useState<AttributeLoadState>('idle');
  const [attributesMessage, setAttributesMessage] = useState('尚未加载类目特征');
  const [attributeReloadKey, setAttributeReloadKey] = useState(0);
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>(() => attributeValuesOf(task));
  const [attemptedProduct, setAttemptedProduct] = useState(false);
  const [attemptedAttributes, setAttemptedAttributes] = useState(false);
  const [categoryTreeNodes, setCategoryTreeNodes] = useState<CategoryTreeViewNode[]>([]);
  const [categoryTreeLoading, setCategoryTreeLoading] = useState(false);
  const [categoryTreeMessage, setCategoryTreeMessage] = useState('');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Record<string, boolean>>({});
  const [dictionaryValueIds, setDictionaryValueIds] = useState<DictionaryValueIds>(() => attributeDictionaryIdsOf(task));
  const [showMoreAttributes, setShowMoreAttributes] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeSection, setActiveSection] = useState<EditorSectionId>('main');
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<OzonCategoryEntry | null>(null);
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [variantImageEdits, setVariantImageEdits] = useState<Record<string, string[]>>({});
  const [imageManager, setImageManager] = useState<ImageManagerSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryKeyRef = useRef('');
  const [pendingLocateIssue, setPendingLocateIssue] = useState<EditorValidationIssue | null>(null);
  const [flashingTargetKey, setFlashingTargetKey] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  function locateValidationIssue(issue: EditorValidationIssue): void {
    if (issue.expand === 'moreAttributes') setShowMoreAttributes(true);
    if (issue.expand === 'advanced') setShowAdvanced(true);
    setPendingLocateIssue(issue);
  }

  // expand-then-locate: wait one frame after state render so hidden regions
  // are mounted before the DOM lookup
  useEffect(() => {
    if (!pendingLocateIssue) return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const root = scrollRef.current;
        setPendingLocateIssue(null);
        if (!root) return;
        const target = root.querySelector<HTMLElement>(`[data-validation-target="${pendingLocateIssue.targetKey}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        const focusable = target.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (pendingLocateIssue.focus !== false && focusable) {
          window.setTimeout(() => {
            focusable.focus({ preventScroll: true });
          }, 400);
        }
        if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
        setFlashingTargetKey(null);
        window.requestAnimationFrame(() => {
          setFlashingTargetKey(pendingLocateIssue.targetKey);
          flashTimerRef.current = window.setTimeout(() => setFlashingTargetKey(null), 1200);
        });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingLocateIssue]);

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

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

  function attributeValuesOf(currentTask: OzonListingTask): Record<string, string> {
    const item = objectOf(currentTask.draft?.items?.[0]);
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

  function attributeDictionaryIdsOf(currentTask: OzonListingTask): DictionaryValueIds {
    const item = objectOf(currentTask.draft?.items?.[0]);
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

  const variantOfDraft = useMemo(() => objectOf(currentDraft?.variant), [currentDraft]);
  const variantRowsOfDraft = useMemo(() => {
    return Array.isArray(variantOfDraft.variants) ? variantOfDraft.variants.map(objectOf).filter(Boolean) : [];
  }, [variantOfDraft]);
  const variantDimsOfDraft = useMemo(() => {
    return Array.isArray(variantOfDraft.dimensions) ? variantOfDraft.dimensions.map(objectOf).filter(Boolean) : [];
  }, [variantOfDraft]);

  const variantDimensionAttrIds = useMemo(() => {
    const ids = new Set<number>();
    for (const dim of variantDimsOfDraft) {
      const id = Number(dim.ozon_attribute_id || 0);
      if (id > 0) ids.add(id);
    }
    return ids;
  }, [variantDimsOfDraft]);

  const moreCategoryAttributes = useMemo(
    () => filterCategoryAttributesForMoreAttrs(categoryAttributes, variantDimensionAttrIds),
    [categoryAttributes, variantDimensionAttrIds],
  );

  // Autofill split: the UI keeps rendering the FULL moreCategoryAttributes;
  // AI 补全 may only target required dynamic attributes.
  const requiredAiAttributes = useMemo(
    () => filterRequiredOnlyAttributes(moreCategoryAttributes),
    [moreCategoryAttributes],
  );
  const missingRequiredAiAttributes = useMemo(
    () => filterMissingRequiredAttributes(requiredAiAttributes, dynamicValues),
    [requiredAiAttributes, dynamicValues],
  );

  const hiddenRequiredAttributes = useMemo(
    () => collectHiddenRequiredAttributes(moreCategoryAttributes, dynamicValues),
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
    attrs: OzonCategoryAttribute[],
  ) {
    const attrMap = new Map(attrs.map((attr) => [Number(attr.id), attr]));
    for (const v of values) {
      const attr = attrMap.get(Number(v.attribute_id));
      if (!attr) continue;
      const attrKey = String(v.attribute_id);
      if (text(dynamicValues[attrKey])) continue; // don't overwrite user edits
      const dictId = Number(v.dictionary_value_id || 0);
      // Dictionary attributes without a REAL dictionary_value_id are never
      // applied: the raw text is not a valid selection.
      if (attr.dictionaryId > 0 && dictId <= 0) continue;
      updateDynamicValue(v.attribute_id, v.value_text);
      if (dictId > 0) {
        updateDictionaryValueIds(v.attribute_id, { [v.value_text]: dictId });
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
    if (submitting || attributeAiFilling) return;
    if (attributeLoadState !== 'ready') {
      setMessage(attributeLoadState === 'error' ? 'Ozon 类目属性加载失败，无法执行 AI 补全。' : '类目属性尚未加载完成，无法执行 AI 补全。');
      return;
    }
    // AI target = required AND currently missing. Optional attributes never
    // participate; filled required values are never re-sent.
    const attrs = missingRequiredAiAttributes;
    if (!attrs.length) {
      setMessage('当前必填类目属性已填写完成。');
      return;
    }

    setAttributeAiFilledKey(attributeAutoFillKey);
    setAttributeAiFilling(true);

    // Pre-filled by the draft generation backend — apply immediately.
    // Historical drafts may contain optional values: filter to required IDs
    // only, and never overwrite what the user already filled.
    const prefillValues = task.draft?.generated &&
      typeof task.draft.generated === 'object' &&
      (task.draft.generated as Record<string, unknown>).attribute_values;
    const values = Array.isArray(prefillValues) ? prefillValues : [];
    const requiredAiAttributeIds = new Set(requiredAiAttributes.map((attr) => Number(attr.id)));
    const requiredPrefillValues = resolvePrefillableAttributeValues(values, requiredAiAttributeIds, dynamicValues);

    if (requiredPrefillValues.length && !forceFresh) {
      setMessage('草稿已附带特征值，正在应用...');
      try {
        await applyDefaultOriginCountry(attrs);
        applyPrefilledAttributeValues(requiredPrefillValues, requiredAiAttributes);
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
  // They come from draft.items[0].attributes via attributeValuesOf on mount.
  // No auto AI fill on open — user clicks "AI 补全属性" button to fill gaps.

  useEffect(() => {
    const nextForm = createDraftForm(task);
    setForm(nextForm);
    setDynamicValues(attributeValuesOf(task));
    setDictionaryValueIds(attributeDictionaryIdsOf(task));
    setDictionaryPayloadValues({});
    setCategoryAttributes([]);
    setAttributeLoadState('idle');
    setAttributesMessage('尚未加载类目特征');
    setMessage('');
    setShowMoreAttributes(false);
    setShowAdvanced(false);
    setCategoryDrawerOpen(false);
    setPendingCategory(null);
    setAttemptedProduct(false);
    setAttemptedAttributes(false);
    setAttributeAiFilledKey('');
    setAttributeAiFilling(false);
    setValidationState('idle');
    setVariantImageEdits({});
    setImageManager(null);
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

  // Category attributes load with a state machine (idle/loading/ready/error)
  // plus a stale-state clearing + response race guard: the category key is
  // captured per effect run and re-verified when the response arrives, so a
  // slow A→B response can never overwrite a newer C.
  useEffect(() => {
    const descriptionCategoryId = intForPayload(form.descriptionCategoryId);
    const typeId = intForPayload(form.typeId);
    const categoryKey = `${descriptionCategoryId}:${typeId}`;
    categoryKeyRef.current = categoryKey;

    if (!descriptionCategoryId || !typeId) {
      setCategoryAttributes([]);
      setAttributeLoadState('idle');
      setAttributesMessage('请选择 Ozon 类目和类型后加载特征。');
      return;
    }

    let alive = true;
    setAttributeLoadState('loading');
    setCategoryAttributes([]);
    setAttributesMessage('正在加载类目特征...');
    setShowMoreAttributes(false);
    setAttemptedAttributes(false);
    getApi().ozon.getCategoryAttributes({ descriptionCategoryId, typeId, language: 'ZH_HANS' })
      .then((response) => {
        if (!alive) return;
        if (categoryKeyRef.current !== categoryKey) return;
        const attrs = response.attributes || [];
        // Sanitize dictionary selections against the loaded metadata BEFORE
        // the UI re-renders: text-only dictionary values from historical
        // drafts must not surface as selected or reach the payload.
        const prunedIds = pruneDictionaryIdsForCategory(dictionaryValueIds, attrs);
        setCategoryAttributes(attrs);
        setDynamicValues((prev) => sanitizeDictionarySelections(pruneDynamicValuesForCategory(prev, attrs), prunedIds, attrs));
        setDictionaryValueIds(prunedIds);
        setDictionaryPayloadValues((prev) => prunePayloadValuesForCategory(prev, attrs));
        setAttributeLoadState('ready');
        setAttributesMessage(`已加载 ${attrs.length} 项类目特征，其中必填 ${response.requiredCount} 项`);
      })
      .catch((error) => {
        if (!alive) return;
        if (categoryKeyRef.current !== categoryKey) return;
        setCategoryAttributes([]);
        setAttributeLoadState('error');
        setAttributesMessage(error instanceof Error ? error.message : String(error));
      });

    return () => { alive = false; };
  }, [attributeReloadKey, form.descriptionCategoryId, form.typeId]);

  function pruneDictionaryIdsForCategory(
    values: DictionaryValueIds,
    attrs: OzonCategoryAttribute[],
  ): DictionaryValueIds {
    const categoryIds = new Set(attrs.map((attr) => attr.id));
    const next: DictionaryValueIds = {};
    for (const [rawId, ids] of Object.entries(values)) {
      const attrId = Number(rawId);
      if (!attrId || CONTROLLED_ATTR_IDS.has(attrId) || categoryIds.has(attrId)) {
        next[rawId] = ids;
      }
    }
    return next;
  }

  function prunePayloadValuesForCategory(
    values: Record<string, Record<string, string>>,
    attrs: OzonCategoryAttribute[],
  ): Record<string, Record<string, string>> {
    const categoryIds = new Set(attrs.map((attr) => attr.id));
    const next: Record<string, Record<string, string>> = {};
    for (const [rawId, map] of Object.entries(values)) {
      const attrId = Number(rawId);
      if (!attrId || CONTROLLED_ATTR_IDS.has(attrId) || categoryIds.has(attrId)) {
        next[rawId] = map;
      }
    }
    return next;
  }

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

  const buildResult = useMemo(
    () => buildDraft(
      task,
      form,
      dynamicValues,
      categoryAttributes,
      dictionaryValueIds,
      moreCategoryAttributes,
      variantImageEdits,
      { attributeMetadataReady: attributeLoadState === 'ready', attributeMetadataMessage: attributesMessage },
    ),
    [attributeLoadState, attributesMessage, categoryAttributes, dictionaryValueIds, dynamicValues, form, moreCategoryAttributes, task, variantImageEdits],
  );
  // single source of truth for what blocks save/validate/submit
  const validation = buildResult?.validation;
  const missing = validation?.all || buildResult?.missing || task.missingFields || task.draft?.missing || [];
  const firstItem = buildResult?.firstItem || firstItemOf(task);

  const missingCounts = {
    main: validation?.main.length || 0,
    attributes: validation?.attributes.length || 0,
    variants: validation?.variants.length || 0,
  };

  const validationIssues = useMemo(
    () => (validation ? buildEditorValidationIssues(validation, { categoryAttributes, moreCategoryAttributes }) : []),
    [categoryAttributes, moreCategoryAttributes, validation],
  );
  // keep the stale issue popover from surviving a revalidate that fixed everything
  useEffect(() => {
    if (validationState === 'valid' && validationIssues.length === 0) setPendingLocateIssue(null);
  }, [validationIssues.length, validationState]);

  const richContentInvalid = text(form.richContent).trim() !== '' && !normalizeRichContentJson(form.richContent).ok;
  // Realtime Chinese free-text violations, derived from the SAME collector
  // that feeds validateDraftForEditor — no second validation logic.
  const chineseViolations = collectChineseTextViolations(form, dynamicValues, categoryAttributes);
  const chineseMain = new Set(chineseViolations.main);
  const chineseAttributes = new Set(chineseViolations.attributes);
  // Full category attribute set, not the filtered more-attrs list: a custom
  // line matching ANY current-category attribute id (variant-dimension,
  // optional-media included) must surface as a conflict.
  const customParsed = parseCustomAttributesDetailed(form.customAttributes, categoryAttributes);
  const unsupportedRequiredMedia = collectUnsupportedRequiredMediaAttributes(moreCategoryAttributes);
  const unsupportedMediaIds = new Set(unsupportedRequiredMedia.map((attr) => attr.id));

  const variantTable = useMemo(
    () => buildVariantTableView(task, buildResult?.draft || task.draft, firstItem, variantImageEdits),
    [buildResult?.draft, firstItem, task, variantImageEdits],
  );
  const visibleVariantDims = variantTable.dims.filter((dim) => dim.distinguishes_variants === true);

  function markEdited() {
    if (submitting) return;
    setValidationState('idle');
  }

  function updateField<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    if (submitting) return;
    markEdited();
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDynamicValue(attrId: number, value: string) {
    if (submitting) return;
    markEdited();
    setDynamicValues((prev) => ({ ...prev, [String(attrId)]: value }));
  }

  function updateDictionaryValueIds(attrId: number, values: Record<string, number>) {
    if (submitting) return;
    markEdited();
    setDictionaryValueIds((prev) => ({ ...prev, [String(attrId)]: values }));
  }

  function applyCategory(entry: OzonCategoryEntry) {
    // Synchronous invalidation: the moment the user confirms a new category,
    // any previous validation result and the old category's metadata are
    // dead — never wait for the effect to run.
    setValidationState('idle');
    setAttributeLoadState('loading');
    setCategoryAttributes([]);
    setShowMoreAttributes(false);
    setAttemptedAttributes(false);
    setAttributesMessage('正在加载类目特征...');
    const nextDescriptionId = categoryDescriptionId(entry);
    const nextTypeId = categoryTypeId(entry);
    // Claim the category key BEFORE the form update so a still-in-flight
    // effect for the old category cannot overwrite the new key via cleanup.
    categoryKeyRef.current = `${nextDescriptionId}:${nextTypeId}`;
    setForm((prev) => ({
      ...prev,
      descriptionCategoryId: String(nextDescriptionId),
      typeId: String(nextTypeId),
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

  function buildCurrentDraft(): DraftBuildResult | null {
    if (attributeLoadState !== 'ready') {
      setValidationState('invalid');
      setMessage(attributeLoadState === 'error'
        ? 'Ozon 类目属性加载失败，请点击"重新加载特征"后再保存或提交。'
        : '类目属性尚未加载完成，请稍后再保存或提交。');
      return null;
    }
    // Pure build: no onTaskUpdate / lastSavedAt / toast side effects.
    const result = buildDraft(
      task,
      form,
      dynamicValues,
      categoryAttributes,
      dictionaryValueIds,
      moreCategoryAttributes,
      variantImageEdits,
      { attributeMetadataReady: true, attributeMetadataMessage: attributesMessage },
    );
    if (!result) {
      setMessage('当前任务还没有可编辑的 Ozon 草稿。');
      return null;
    }
    return result;
  }

  function persistDraft(result: DraftBuildResult, showToast = true): void {
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
  }

  function handleSave() {
    if (submitting) return;
    const result = buildCurrentDraft();
    if (!result) return;
    // Full category attribute set (not the filtered more-attrs list):
    // conflicts with variant-dimension/optional-media attrs must block save.
    const blockers = collectDraftBlockers(form, categoryAttributes);
    if (blockers.length) {
      setValidationState('invalid');
      const detail = blockers.join('；');
      setMessage(`无法保存：${detail}`);
      onToast?.(`无法保存：${detail}`);
      return;
    }
    persistDraft(result, true);
  }

  function reloadAttributes() {
    if (submitting) return;
    // Synchronous invalidation: a reload invalidates the old validation
    // result immediately — the user must re-validate against the new
    // metadata before the submit button can light up again.
    setValidationState('idle');
    setAttributeLoadState('loading');
    setCategoryAttributes([]);
    setShowMoreAttributes(false);
    setAttemptedAttributes(false);
    setAttributesMessage('正在重新加载类目特征...');
    setAttributeReloadKey((prev) => prev + 1);
  }

  function handleValidate() {
    setAttemptedProduct(true);
    setAttemptedAttributes(true);
    setValidationState('validating');
    // Validate must never persist: no onTaskUpdate, no lastSavedAt update.
    const result = buildCurrentDraft();
    if (!result) {
      setValidationState('invalid');
      return;
    }
    setValidationState(result.missing.length ? 'invalid' : 'valid');
    if (result.missing.length) {
      onToast?.(`校验未通过：${formatMissingFields(result.missing)}`);
    } else {
      onToast?.('校验通过，可以提交 Ozon');
    }
  }

  async function submitDraft() {
    if (submitting) return;
    setAttemptedProduct(true);
    setAttemptedAttributes(true);
    const result = buildCurrentDraft();
    if (!result) return;
    if (result.missing.length) {
      setValidationState('invalid');
      setMessage(`提交前还需要补充：${formatMissingFields(result.missing)}`);
      return;
    }
    if (!window.confirm('确认提交当前 Ozon 草稿？提交前请确认店铺设置已开启真实提交。')) {
      // Cancel: nothing was persisted, nothing was submitted.
      return;
    }

    setSubmitting(true);
    // Only after explicit confirmation does the freshly built draft become
    // the task's persisted state.
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

  function openImageManager(row: VariantRowView) {
    const single = variantRowsOfDraft.length === 0;
    // What the user sees in the table row is exactly what the manager edits:
    // row.images is the canonical source (edits → row image → item images).
    setImageManager(createImageManagerSession(row, single));
  }

  function imageManagerImages(): string[] {
    return imageManager?.images || [];
  }

  function saveImageManagerImages(nextImages: string[]) {
    if (!imageManager) return;
    const saved = nextImages.slice(0, 15);
    if (imageManager.single) {
      updateField('images', saved.join('\n'));
    } else {
      markEdited();
      setVariantImageEdits((prev) => ({ ...prev, [String(imageManager.itemIndex)]: saved }));
      setMessage(`SKU ${imageManager.itemIndex + 1} 图片已更新，保存草稿后生效。`);
    }
    setImageManager(null);
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

  const missingDims = (validation?.main || []).filter((item) => item.startsWith('包装'));

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
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </div>

      {message && <div className={`ozon-draft-notice ${missing.length ? 'warn' : 'ready'}`}>{message}</div>}

      <div className="ozon-ai-edit-scroll" ref={scrollRef}>
        <div className="ozon-ai-edit-layout">
          <main className="ozon-ai-edit-center">
            <section id="ozon-section-main" className="ozon-form-card" data-validation-target="section:main">
              <div className={validationTargetClass('ozon-form-card-header', 'section:main', flashingTargetKey)}>主要信息</div>
              <div className="ozon-attr-grid">
                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">上架店铺</label>
                  <div className="ozon-attr-control">
                    <input readOnly value={shopLabel} title="当前绑定的 Ozon 店铺" />
                  </div>
                </div>

                <div className="ozon-attr-item" data-validation-target="main:category">
                  <label className="ozon-attr-label">Ozon 类目 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <div className="ozon-category-current">
                      <span className={form.categoryPath ? '' : 'empty'}>{form.categoryPath || '未选择类目'}</span>
                      <button type="button" onClick={() => setCategoryDrawerOpen(true)}>更换类目</button>
                    </div>
                  </div>
                  <FieldError show={attemptedProduct && (validation?.main || []).includes('类目和类型')} text="请选择带 type_id 的 Ozon 末级类目" />
                </div>

                <div className="ozon-attr-item full" data-validation-target="main:name">
                  <label className="ozon-attr-label">商品标题 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.name}
                      onChange={(event) => updateField('name', event.target.value)}
                      placeholder="商品标题（俄语）"
                    />
                  </div>
                  <FieldError
                    show={attemptedProduct && missing.includes('俄语标题')}
                    text="俄语标题不能为空"
                  />
                  <FieldError
                    show={chineseMain.has('商品标题不能包含中文')}
                    text="商品标题不能包含中文，请使用俄语、英文、数字或符号。"
                  />
                </div>

                <div className="ozon-attr-item" data-validation-target="main:brand">
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
                  {!brandIsDictionary && (
                    <FieldError show={chineseAttributes.has('品牌不能包含中文')} text="品牌不能包含中文，请使用俄语、英文、数字或符号。" />
                  )}
                </div>

                <div className="ozon-attr-item" data-validation-target="main:weight">
                  <label className="ozon-attr-label">含包装重量（g）<span className="unit-warning">注意单位是克(g)</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.weight}
                      onChange={(event) => updateField('weight', event.target.value)}
                      inputMode="numeric"
                      placeholder="如: 800"
                    />
                  </div>
                  <FieldError show={attemptedProduct && (validation?.main || []).includes('含包装重量')} text="重量必须大于 0" />
                </div>

                <div className="ozon-attr-item full">
                  <label className="ozon-attr-label">包装尺寸（mm）<span className="unit-warning">注意单位是毫米(mm)</span></label>
                  <div className="ozon-dimension-row">
                    <div className={validationTargetClass('ozon-dimension-field', 'main:depth', flashingTargetKey)}>
                      <input value={form.depth} onChange={(event) => updateField('depth', event.target.value)} inputMode="numeric" placeholder="长" />
                      <span className="dimension-hint">长</span>
                    </div>
                    <span className="dimension-sep">×</span>
                    <div className={validationTargetClass('ozon-dimension-field', 'main:width', flashingTargetKey)}>
                      <input value={form.width} onChange={(event) => updateField('width', event.target.value)} inputMode="numeric" placeholder="宽" />
                      <span className="dimension-hint">宽</span>
                    </div>
                    <span className="dimension-sep">×</span>
                    <div className={validationTargetClass('ozon-dimension-field', 'main:height', flashingTargetKey)}>
                      <input value={form.height} onChange={(event) => updateField('height', event.target.value)} inputMode="numeric" placeholder="高" />
                      <span className="dimension-hint">高</span>
                    </div>
                  </div>
                  <FieldError show={attemptedProduct && missingDims.length > 0} text={`包装尺寸必须大于 0（${missingDims.join('、')}）`} />
                </div>

                <div className="ozon-attr-item" data-validation-target="main:price">
                  <label className="ozon-attr-label">价格（¥）<span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input
                      value={form.price}
                      onChange={(event) => updateField('price', event.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                  <FieldError show={attemptedProduct && (validation?.main || []).includes('价格')} text="价格必须大于 0" />
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

                <div className="ozon-attr-item full" data-validation-target="main:offerId">
                  <label className="ozon-attr-label">货号 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input value={form.offerId} onChange={(event) => updateField('offerId', event.target.value)} placeholder="Ozon 商品货号" />
                  </div>
                  <FieldError show={attemptedProduct && (validation?.main || []).includes('货号')} text="货号不能为空" />
                </div>
              </div>
            </section>

            <section id="ozon-section-attributes" className="ozon-form-card" data-validation-target="section:attributes">
              <div className={validationTargetClass('ozon-form-card-header', 'section:attributes', flashingTargetKey)}>
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
                <span>{attributeLoadState === 'loading' ? '正在加载类目特征...' : attributesMessage}</span>
                <button type="button" onClick={reloadAttributes}>重新加载</button>
              </div>

              {unsupportedRequiredMedia.length > 0 && (
                <div className="ozon-attr-warning-block">
                  该 Ozon 类目要求以下媒体属性，当前编辑器暂不支持直接填写，请勿提交：
                  {unsupportedRequiredMedia.map((attr) => attr.name).join('、')}
                </div>
              )}

              <div className="ozon-attr-grid">
                <div className="ozon-attr-item" data-validation-target="attributes:model">
                  <label className="ozon-attr-label">型号名称 <span className="req">*</span></label>
                  <div className="ozon-attr-control">
                    <input value={form.model} onChange={(event) => updateField('model', event.target.value)} placeholder="型号名称" />
                  </div>
                  <FieldError show={attemptedAttributes && (validation?.attributes || []).includes('型号名称')} text="型号名称不能为空" />
                  <FieldError
                    show={chineseAttributes.has('型号名称不能包含中文')}
                    text="型号名称不能包含中文，请使用俄语、英文、数字或符号。"
                  />
                </div>

                <div className="ozon-attr-item">
                  <label className="ozon-attr-label">条形码</label>
                  <div className="ozon-attr-control">
                    <input value={form.barcode} onChange={(event) => updateField('barcode', event.target.value)} placeholder="条形码（可选）" />
                  </div>
                </div>

                <div className="ozon-attr-item full" data-validation-target="attributes:tags">
                  <label className="ozon-attr-label">#主题标签</label>
                  <div className="ozon-attr-control">
                    <textarea
                      value={form.tags}
                      onChange={(event) => updateField('tags', event.target.value)}
                      rows={4}
                      placeholder="#keyword 每行一个"
                    />
                  </div>
                  <FieldError
                    show={chineseAttributes.has('主题标签不能包含中文')}
                    text="主题标签不能包含中文，请使用俄语、英文、数字或符号。"
                  />
                </div>

                <div className="ozon-attr-item full" data-validation-target="attributes:description">
                  <label className="ozon-attr-label">简介 / 描述</label>
                  <div className="ozon-attr-control">
                    <textarea
                      value={form.description}
                      onChange={(event) => updateField('description', event.target.value)}
                      rows={6}
                      placeholder="商品描述（俄语）"
                    />
                  </div>
                  <FieldError
                    show={chineseAttributes.has('商品描述不能包含中文')}
                    text="商品描述不能包含中文，请使用俄语、英文、数字或符号。"
                  />
                </div>
              </div>

              {showMoreAttributes && (
                <div className="ozon-other-attrs-block" data-validation-target="more-attrs">
                  <div className="ozon-other-attrs-divider">
                    <span>当前类目专有属性</span>
                    <small>{moreCategoryAttributes.length} 项</small>
                  </div>
                  <div className="ozon-other-attr-grid">
                    {moreCategoryAttributes.map((attr) => (
                      <div key={attr.id} className="ozon-other-attr-item" data-validation-target={`attr:${attr.id}`}>
                        <label className="ozon-attr-label ozon-other-attr-label">
                          {attr.name}{attr.isRequired ? <span className="req">*</span> : null}
                        </label>
                        {unsupportedMediaIds.has(attr.id) ? (
                          <>
                            <div className="ozon-attr-control ozon-other-attr-control">
                              <div
                                style={{
                                  border: '1px dashed #f59e0b',
                                  background: '#fffbeb',
                                  color: '#b45309',
                                  borderRadius: 8,
                                  padding: '8px 10px',
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  minHeight: 36,
                                }}
                              >
                                当前版本暂不支持填写
                              </div>
                            </div>
                            <small className="ozon-attr-error-text ozon-other-attr-error">该类目要求该媒体属性，当前编辑器暂不支持，请勿提交</small>
                          </>
                        ) : (
                        <>
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
                        {!attr.dictionaryId && containsChineseText(dynamicValues[String(attr.id)]) && (
                          <small className="ozon-attr-error-text ozon-other-attr-error">不能包含中文，请填写俄语/英文/数字。</small>
                        )}
                        {attemptedAttributes && attr.isRequired && !text(dynamicValues[String(attr.id)]) && (
                          <small className="ozon-attr-error-text ozon-other-attr-error">该类目必填属性不能为空</small>
                        )}
                        </>
                        )}
                      </div>
                    ))}
                    {moreCategoryAttributes.length === 0 && (
                      <div className="ozon-other-attr-empty">该类目没有更多专有属性</div>
                    )}
                  </div>
                </div>
              )}

              <div className="ozon-advanced-block">
                <button
                  type="button"
                  className="ozon-advanced-toggle"
                  onClick={() => setShowAdvanced((value) => !value)}
                >
                  <span className="ozon-more-attrs-arrow">{showAdvanced ? '↑' : '↓'}</span> 高级属性
                </button>
                {showAdvanced && (
                  <div className="ozon-other-attr-grid">
                    <div className="ozon-other-attr-item" data-validation-target="advanced:rich-content">
                      <label className="ozon-attr-label ozon-other-attr-label">
                        Rich Content（JSON）
                        <span className="unit-warning">可选；草稿原有 Rich Content 会随保存保留</span>
                      </label>
                      <div className="ozon-attr-control ozon-other-attr-control">
                        <textarea
                          value={form.richContent}
                          onChange={(event) => updateField('richContent', event.target.value)}
                          rows={6}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                          placeholder='可选，Rich Content JSON 数据，例如 [{"type":"image","data":{"url":"..."}}]'
                        />
                      </div>
                      {richContentInvalid && (
                        <small className="ozon-attr-error-text ozon-other-attr-error">Rich Content 不是合法 JSON，保存和提交将被阻止</small>
                      )}
                      {text(form.richContent).trim() !== '' && containsChineseText(form.richContent) && (
                        <small className="ozon-attr-error-text ozon-other-attr-error">Rich Content 不能包含中文</small>
                      )}
                    </div>
                    <div className="ozon-other-attr-item" data-validation-target="advanced:custom">
                      <label className="ozon-attr-label ozon-other-attr-label">
                        自定义属性（属性ID=值）
                        <span className="unit-warning">高级模式；每行一个，例如 12345=示例值</span>
                      </label>
                      <div className="ozon-attr-control ozon-other-attr-control">
                        <textarea
                          value={form.customAttributes}
                          onChange={(event) => updateField('customAttributes', event.target.value)}
                          rows={5}
                          style={{ fontFamily: 'monospace', fontSize: 12 }}
                          placeholder={'12345=示例值\n每行一个，属性ID=值；ID 必须是数字'}
                        />
                      </div>
                      {customParsed.errors.map((error) => (
                        <small key={error} className="ozon-attr-error-text ozon-other-attr-error">{error}</small>
                      ))}
                      {customParsed.conflicts.map((attrId) => (
                        <small key={`conflict-${attrId}`} className="ozon-attr-error-text ozon-other-attr-error">
                          属性 {attrId} 已有专用编辑字段或属于当前类目属性，请勿在自定义属性中重复填写
                        </small>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section id="ozon-section-variants" className="ozon-form-card" data-validation-target="section:variants">
              <div className={validationTargetClass('ozon-form-card-header', 'section:variants', flashingTargetKey)}>
                <span>变体设置</span>
                <div className="ozon-variant-header-meta">
                  <span>{variantTable.rows.length} 个 SKU</span>
                  <small>{variantRowsOfDraft.length > 0 ? '来自 1688 SKU 规格解析；点击图片可管理（删除/排序/主图）' : '商品级主图已带入首行；点击图片可管理'}</small>
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
                        <td className="col-sku-name" data-validation-target={`variant:${index}:name`}>{row.skuName}</td>
                        <td className="col-images">
                          <button type="button" className={validationTargetClass('variant-img-list clickable', `variant:${index}:image`, flashingTargetKey)} title="点击管理图片" onClick={() => openImageManager(row)}>
                            {row.images.length ? (
                              row.images.slice(0, 3).map((img, ii) => (
                                <span key={ii} className="variant-img-item">
                                  <img src={img} alt="" />
                                  {ii === 2 && row.images.length > 3 && (
                                    <span className="variant-img-overlay">+{row.images.length - 3}</span>
                                  )}
                                </span>
                              ))
                            ) : (
                              <span className="variant-img-placeholder">添加图片</span>
                            )}
                          </button>
                        </td>
                        <td className="col-offer-id">{row.offerId || '—'}</td>
                        <td className={validationTargetClass('col-price', `variant:${index}:price`, flashingTargetKey)}>{row.price || '—'}</td>
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
                <div className={validationTargetClass('ozon-variant-dims-hint', 'variant:mapping', flashingTargetKey)} data-validation-target="variant:mapping">
                  变体维度：{visibleVariantDims.map((dim) => text(dim.source_name)).join(' / ')}
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
        issues={validationIssues}
        validationState={validationState}
        lastSavedAt={lastSavedAt}
        aiFilling={attributeAiFilling}
        attributeLoadState={attributeLoadState}
        onSave={handleSave}
        onValidate={handleValidate}
        onSubmit={submitDraft}
        onBack={onClose}
        onLocateIssue={locateValidationIssue}
        onAiFillAttributes={() => fillCategoryAttributesByAi(false)}
        onRetryAttributes={reloadAttributes}
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

      {imageManager && (
        <OzonImageManager
          key={imageManager.session}
          open
          title={imageManager.single ? '管理商品图片（主图=第一张）' : `管理 SKU ${imageManager.itemIndex + 1} 图片（主图=第一张）`}
          images={imageManagerImages()}
          onCancel={() => setImageManager(null)}
          onSave={saveImageManagerImages}
        />
      )}
    </div>
  );
}
