import { describe, expect, it } from 'vitest';
import {
  ATTR_BRAND,
  ATTR_DESCRIPTION,
  ATTR_MODEL,
  ATTR_PRODUCT_NAME,
  ATTR_RICH_CONTENT,
  ATTR_TAGS,
  ATTR_WEIGHT,
  buildAttributes,
  buildDraft,
  buildVariantTableView,
  collectHiddenRequiredAttributes,
  collectRequiredExpandedIds,
  collectVariantViewMissing,
  filterCategoryAttributesForMoreAttrs,
  filterTreeNodes,
  isMediaAttributeName,
  lineList,
  normalizeImageUrl,
  parseCustomAttributes,
  positiveInteger,
  pruneDynamicValuesForCategory,
  resolveVariantItemIndex,
} from '../apps/desktop/renderer/src/components/Ozon/ozonEditorUtils';
import type { OzonListingTask } from '../apps/desktop/renderer/src/components/Results/ozonListing/types';
import type { OzonDraft } from '../apps/desktop/renderer/src/services/api';

function makeTask(items: Array<Record<string, unknown>>, variant?: Record<string, unknown>): OzonListingTask {
  const draft: OzonDraft = {
    draftId: 'draft-1',
    status: 'draft_ready',
    sourceRows: items.map((item, index) => ({ ...item, item_index: item.item_index ?? index })),
    generated: {
      title_ru: 'Russian title',
      tags: ['tag1', 'tag2'],
      matched_category: { description_category_id: 1700, type_id: 9300, path: 'Электроника' },
    },
    variant: variant ?? null,
    items,
    missing: [],
    createdAt: '2026-01-01T00:00:00Z',
  };
  return {
    key: 'task-1',
    status: 'draft_ready',
    title: 'Tシャツ',
    createdAt: '2026-01-01T00:00:00Z',
    draft,
  };
}

function form(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Русское название',
    offerId: 'offer-1',
    barcode: '4600000000000',
    price: '100',
    oldPrice: '0',
    currencyCode: 'CNY',
    descriptionCategoryId: '1700',
    typeId: '9300',
    categoryPath: 'Электроника',
    brand: 'NO NAME',
    model: 'M-100',
    description: 'Описание',
    tags: '#tag1\n#tag2',
    images: 'https://example.com/1.jpg\nhttps://example.com/2.jpg',
    dimensionUnit: 'mm',
    depth: '100',
    width: '60',
    height: '40',
    weightUnit: 'g',
    weight: '350',
    customAttributes: '',
    richContent: '{"blocks":[]}',
    ...overrides,
  } as Record<string, string>;
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Русское название',
    offer_id: 'offer-1',
    price: '100',
    old_price: '0',
    currency_code: 'CNY',
    description_category_id: 1700,
    type_id: 9300,
    primary_image: 'https://example.com/1.jpg',
    images: ['https://example.com/1.jpg'],
    depth: 100,
    width: 60,
    height: 40,
    weight: 350,
    ...overrides,
  };
}

function attr(id: number, value: string, dictionaryValueId?: number) {
  return { id, complex_id: 0, values: dictionaryValueId ? [{ dictionary_value_id: dictionaryValueId, value }] : [{ value }] };
}

describe('ozon editor utils', () => {
  describe('category tree search', () => {
    const tree = [
      {
        id: 'root-1', label: 'Электроника', path: 'Электроника', depth: 0,
        descriptionCategoryId: 1700, typeId: 9300, selectable: false,
        children: [
          {
            id: 'mid-1', label: 'Смартфоны', path: 'Электроника / Смартфоны', depth: 1,
            descriptionCategoryId: 1701, typeId: 9301, selectable: false,
            children: [
              {
                id: 'leaf-1', label: 'Смартфон Xiaomi', path: 'Электроника / Смартфоны / Смартфон Xiaomi', depth: 2,
                descriptionCategoryId: 1702, typeId: 9302, selectable: true,
                children: [],
              },
            ],
          },
          {
            id: 'leaf-2', label: 'Наушники', path: 'Электроника / Наушники', depth: 1,
            descriptionCategoryId: 1703, typeId: 9303, selectable: true,
            children: [],
          },
        ],
      },
    ];

    it('keeps ancestor nodes for deep matches', () => {
      const visible = filterTreeNodes(tree, 'xiaomi');
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('root-1');
      expect(visible[0].children[0].id).toBe('mid-1');
      expect(visible[0].children[0].children[0].id).toBe('leaf-1');
    });

    it('matches multi-token queries only when every token is contained', () => {
      const visible = filterTreeNodes(tree, 'смартфон xiaomi');
      expect(visible).toHaveLength(1);
      expect(visible[0].children[0].children[0].id).toBe('leaf-1');
      expect(filterTreeNodes(tree, 'смартфон наушники')).toHaveLength(0);
    });

    it('returns the full tree for an empty query', () => {
      expect(filterTreeNodes(tree, '')).toBe(tree);
      expect(filterTreeNodes(tree, '   ')).toBe(tree);
    });

    it('collects every visible non-leaf id for auto-expand', () => {
      const visible = filterTreeNodes(tree, 'наушники');
      const expanded = collectRequiredExpandedIds(visible);
      expect(expanded['root-1']).toBe(true);
      expect(expanded['leaf-2']).toBeUndefined();
    });
  });

  describe('variant rows', () => {
    it('falls back to the row index when item_index is absent or invalid', () => {
      expect(resolveVariantItemIndex({}, 2)).toBe(2);
      expect(resolveVariantItemIndex({ item_index: undefined }, 3)).toBe(3);
      expect(resolveVariantItemIndex({ item_index: '2' }, 9)).toBe(2);
    });

    it('renders a single-SKU row with the primary image first', () => {
      const task = makeTask([baseItem()]);
      const { rows } = buildVariantTableView(task, task.draft, task.draft!.items[0]);
      expect(rows).toHaveLength(1);
      expect(rows[0].itemIndex).toBe(0);
      expect(rows[0].images).toEqual(['https://example.com/1.jpg']);
    });

    it('maps multi-SKU rows to items via item_index and applies edited images', () => {
      const items = [
        baseItem({ item_index: 0 }),
        baseItem({ item_index: 1, name: 'SKU 2', primary_image: 'https://example.com/2.jpg' }),
      ];
      const variant = {
        confirmed: true,
        dimensions: [{ id: 1, name: 'Цвет', attribute_id: 1001, values: [] }],
        variants: [
          { offer_id: 'offer-1', item_index: 0, source_sku_name: 'SKU A', values: {} },
          { offer_id: 'offer-2', item_index: 1, source_sku_name: 'SKU B', values: {} },
        ],
      };
      const task = makeTask(items, variant);
      const { rows } = buildVariantTableView(task, task.draft, task.draft!.items[0], {
        '1': ['https://example.com/new-2.jpg'],
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].itemIndex).toBe(0);
      expect(rows[1].itemIndex).toBe(1);
      expect(rows[1].images).toEqual(['https://example.com/new-2.jpg']);
    });
  });

  describe('buildAttributes', () => {
    it('rebuilds controlled attributes and keeps preserved custom ones', () => {
      const base = baseItem({
        attributes: [
          attr(2001, 'некий атрибут'),
          attr(ATTR_BRAND, 'Старый бренд'),
          attr(ATTR_RICH_CONTENT, '{"old":true}'),
        ],
      });
      const attrs = buildAttributes(base, form(), {}, [], {});
      const ids = attrs.map((item) => Number(item.id));
      expect(ids).toContain(ATTR_BRAND);
      expect(ids).toContain(ATTR_MODEL);
      expect(ids).toContain(ATTR_DESCRIPTION);
      expect(ids).toContain(ATTR_TAGS);
      expect(ids).toContain(ATTR_WEIGHT);
      expect(ids).toContain(ATTR_RICH_CONTENT);
      expect(ids).toContain(2001);
      expect(ids).not.toContain(ATTR_PRODUCT_NAME);
      const brand = attrs.find((item) => Number(item.id) === ATTR_BRAND);
      expect(brand!.values).toEqual([{ value: 'NO NAME' }]);
      const rich = attrs.find((item) => Number(item.id) === ATTR_RICH_CONTENT);
      expect(rich!.values).toEqual([{ value: '{"blocks":[]}' }]);
    });

    it('injects attribute 4180 (product name) only when the category declares it', () => {
      const declared: Array<{ id: number }> = [{ id: ATTR_PRODUCT_NAME }, { id: 2001 }];
      const with4180 = buildAttributes(baseItem(), form(), {}, declared, []);
      expect(with4180.find((item) => Number(item.id) === ATTR_PRODUCT_NAME)!.values)
        .toEqual([{ value: 'Русское название' }]);

      const without = buildAttributes(baseItem(), form(), {}, [{ id: 2001 }], []);
      expect(without.find((item) => Number(item.id) === ATTR_PRODUCT_NAME)).toBeUndefined();
    });

    it('prunes preserved attributes when the category changed (A→B safety)', () => {
      const base = baseItem({
        attributes: [attr(2001, 'для категории A'), attr(2002, 'для категории B')],
      });
      const attrs = buildAttributes(base, form(), {}, [{ id: 2002 }], []);
      const ids = attrs.map((item) => Number(item.id));
      expect(ids).toContain(2002);
      expect(ids).not.toContain(2001);
    });

    it('deduplicates preserved vs dynamic/custom attributes', () => {
      const base = baseItem({ attributes: [attr(2001, 'old value')] });
      const attrs = buildAttributes(base, form(), { '2001': 'new value' }, [{ id: 2001 }], []);
      expect(attrs.filter((item) => Number(item.id) === 2001)).toHaveLength(1);
      expect(attrs.find((item) => Number(item.id) === 2001)!.values).toEqual([{ value: 'new value' }]);
    });
  });

  describe('pruneDynamicValuesForCategory', () => {
    it('drops values for attributes missing from the new category', () => {
      const pruned = pruneDynamicValuesForCategory(
        { '2001': 'a', '2002': 'b', [String(ATTR_BRAND)]: 'x' },
        [{ id: 2002 }],
      );
      expect(pruned).toEqual({ '2002': 'b', [String(ATTR_BRAND)]: 'x' });
    });
  });

  describe('missing collection', () => {
    it('filters media/controlled/variant-dimension attributes from the more-attrs list', () => {
      const full = (id: number, name: string) => ({
        id, name, description: '', groupId: null, groupName: '',
        dictionaryId: 0, isRequired: false, isAspect: false, isCollection: false,
        maxValueCount: 1, categoryDependent: false, attributeComplexId: 0, complexIsCollection: false,
      });
      const attrs = [
        full(3001, 'Видео'),
        full(3002, 'Обычное поле'),
        { ...full(ATTR_BRAND, 'Бренд') },
        full(3003, 'Размер'),
      ];
      const filtered = filterCategoryAttributesForMoreAttrs(attrs, new Set([3003]));
      expect(filtered.map((item) => item.id)).toEqual([3002]);
    });

    it('flags required attributes without a value', () => {
      const full = (id: number, name: string, isRequired: boolean) => ({
        id, name, description: '', groupId: null, groupName: '',
        dictionaryId: 0, isRequired, isAspect: false, isCollection: false,
        maxValueCount: 1, categoryDependent: false, attributeComplexId: 0, complexIsCollection: false,
      });
      const hidden = collectHiddenRequiredAttributes(
        [
          full(3001, 'Тип', true),
          full(3002, 'Опция', false),
          full(3003, 'Цвет', true),
        ],
        { '3001': 'значение' },
      );
      expect(hidden.map((item) => item.id)).toEqual([3003]);
    });

    it('reports per-SKU problems beyond the first item and unconfirmed mappings', () => {
      const items = [
        baseItem({ price: '100' }),
        baseItem({ item_index: 1, name: '', primary_image: '', price: '0' }),
      ];
      const missing = collectVariantViewMissing(items, makeTask(items, { confirmed: false }).draft);
      expect(missing).toContain('SKU 2 名称');
      expect(missing).toContain('SKU 2 主图');
      expect(missing).toContain('SKU 2 价格');
      expect(missing).toContain('规格属性映射');
    });
  });

  describe('media attribute detection', () => {
    it('detects media-like attributes and ignores plain ones', () => {
      const full = (name: string) => ({
        id: 5001, name, description: '', groupId: null, groupName: '',
        dictionaryId: 0, isRequired: false, isAspect: false, isCollection: false,
        maxValueCount: 1, categoryDependent: false, attributeComplexId: 0, complexIsCollection: false,
      });
      expect(isMediaAttributeName(full('Видео'))).toBe(true);
      expect(isMediaAttributeName(full('Rich content'))).toBe(true);
      expect(isMediaAttributeName(full('Цвет'))).toBe(false);
    });
  });

  describe('small helpers', () => {
    it('parses ID=value custom attribute lines and deduplicates', () => {
      const attrs = parseCustomAttributes('2001=красный\n2002=XL\n2001=синий\nnot-a-line');
      expect(attrs).toHaveLength(2);
      expect(Number(attrs[0].id)).toBe(2001);
      expect(Number(attrs[1].id)).toBe(2002);
    });

    it('normalizes image urls and splits text lines', () => {
      expect(normalizeImageUrl('//cdn.example.com/1.jpg')).toBe('https://cdn.example.com/1.jpg');
      expect(lineList('a\nb,b\n c ')).toEqual(['a', 'b', 'c']);
      expect(positiveInteger('12.5 кг')).toBe(13);
    });
  });

  describe('buildDraft', () => {
    it('applies variant image edits per item and computes missing', () => {
      const items = [baseItem(), baseItem({ item_index: 1, name: 'SKU 2', price: '90' })];
      const task = makeTask(items);
      const result = buildDraft(
        task,
        form(),
        {},
        [],
        {},
        [{ id: 3001, isRequired: true, name: 'Тип' }],
        { '1': ['https://example.com/edited.jpg'] },
      );
      expect(result).not.toBeNull();
      expect(result!.draft.items[1].images).toEqual(['https://example.com/edited.jpg']);
      expect(result!.draft.items[1].primary_image).toBe('https://example.com/edited.jpg');
      expect(result!.draft.items[0].primary_image).toBe('https://example.com/1.jpg');
      expect(result!.missing).toEqual(['Тип']);
    });
  });
});
