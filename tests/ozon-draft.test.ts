import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  collectDraftMissing,
  generateOzonDraft,
  submitOzonDraft,
  sanitizeGeneratedAttributeValues,
  resolveMergeCardKeys,
} = require('../apps/desktop/ozon-draft.cjs') as {
  collectDraftMissing: (items: Array<Record<string, unknown>>, draft?: Record<string, unknown>) => string[];
  generateOzonDraft: (
    settings: Record<string, any>,
    rows?: Array<Record<string, unknown>>,
  ) => Promise<Record<string, any>>;
  submitOzonDraft: (
    settings: Record<string, any>,
    draft: Record<string, any>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  sanitizeGeneratedAttributeValues: (
    attributeValues: Array<Record<string, unknown>>,
    categoryAttributes: Array<Record<string, unknown>>,
  ) => Array<Record<string, unknown>>;
  resolveMergeCardKeys: (
    normalized: Record<string, any>,
    attrs: Array<Record<string, unknown>>,
    items: Array<Record<string, any>>,
  ) => Array<Record<string, unknown>>;
};

const settings = {
  ozon: {
    clientId: 'client',
    apiKey: 'key',
    currencyCode: 'CNY',
    defaultWarehouseId: '12345',
  },
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function categoryAttributeMeta() {
  return ok({
    result: [{ id: 9048, name: '型号', is_required: false }],
  }) as Response;
}

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Russian product title',
    offer_id: 'offer-1',
    price: '100',
    old_price: '0',
    vat: '0',
    currency_code: 'CNY',
    description_category_id: 1700,
    type_id: 9300,
    primary_image: 'https://example.com/1.jpg',
    images: ['https://example.com/1.jpg'],
    depth: 10,
    width: 8,
    height: 6,
    weight: 200,
    attributes: [{ id: 9048, values: [{ value: 'model' }] }],
    ...overrides,
  };
}

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    sourceRows: [{ sku_stock: 7 }],
    generated: {},
    items: [baseItem()],
    ...overrides,
  };
}

function endpointOf(call: unknown[]) {
  return String(call[0]).replace('https://api-seller.ozon.ru', '');
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function aiDraftResponse(overrides: Record<string, unknown> = {}) {
  return okJson({
    choices: [{
      message: {
        content: JSON.stringify({
          title_ru: 'Russian product title',
          model_name: 'Model Group',
          description_ru: 'Описание товара для карточки Ozon.',
          tags: ['tag one', 'tag two'],
          matched_category: { candidate_index: null },
          estimated_dimensions: { length_cm: 10, width_cm: 8, height_cm: 6, weight_g: 200 },
          ...overrides,
        }),
      },
    }],
  }) as Response;
}

function categoryMeta(attrs: Array<Record<string, unknown>>) {
  return ok({ result: attrs }) as Response;
}

function aiSuggestionsResponse(attributes: Array<Record<string, unknown>>) {
  return okJson({
    choices: [{ message: { content: JSON.stringify({ attributes }) } }],
  }) as Response;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ozon draft submit helper', () => {
  it('adds an explicit variant plan to multi-sku drafts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(aiDraftResponse());

    const draft = await generateOzonDraft(
      {
        ai: { apiKey: 'ai-key', baseUrl: 'https://api.example.test', model: 'model' },
        ozon: { currencyCode: 'CNY' },
      },
      [
        {
          offer_id: '1688-offer',
          sku_id: 'sku-red',
          detail_url: 'https://detail.1688.com/offer/1688-offer.html',
          product_title: 'Sample product',
          sku_name: '颜色:红色; 尺码:M',
          sku_price: '12.5',
          main_image_url: 'https://example.com/red.jpg',
          length_cm: '10',
          width_cm: '8',
          height_cm: '6',
          weight_g: '200',
          sku_stock: 5,
        },
        {
          offer_id: '1688-offer',
          sku_id: 'sku-blue',
          detail_url: 'https://detail.1688.com/offer/1688-offer.html',
          product_title: 'Sample product',
          sku_name: '颜色:蓝色; 尺码:M',
          sku_price: '13',
          main_image_url: 'https://example.com/blue.jpg',
          length_cm: '10',
          width_cm: '8',
          height_cm: '6',
          weight_g: '200',
          sku_stock: 3,
        },
      ],
    );

    expect(draft.variant).toMatchObject({
      type: 'ozon_model_variants',
      status: 'needs_attribute_id_confirmation',
      confirmed: false,
      group_attribute_id: 9048,
      group_value: 'Model Group',
    });
    expect(draft.generated.variant_mapping).toBe(draft.variant);
    expect(draft.variant.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_name: '颜色', values: ['红色', '蓝色'], distinguishes_variants: true }),
      expect.objectContaining({ source_name: '尺码', values: ['M'], distinguishes_variants: false }),
    ]));
    expect(draft.variant.variants).toHaveLength(2);
    expect(draft.items[0]._variant).toMatchObject({
      source_sku_id: 'sku-red',
      values: { '颜色': '红色', '尺码': 'M' },
      mapping_status: 'needs_attribute_id_confirmation',
    });
    expect(draft.missing).toContain('规格属性映射');
  });

  it('simulates a collected 1688 product through category resolution and Ozon import', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-flow-'));
    try {
      await fs.mkdir(path.join(tempDir, 'categories'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'categories', 'ozon_category_tree.zh_hans.json'), JSON.stringify({
        result: [{
          description_category_id: 1700,
          category_name: '手机配件',
          children: [{
            description_category_id: 1700,
            category_name: '保护配件',
            children: [{
              description_category_id: 1700,
              type_id: 9300,
              type_name: '手机壳',
              children: [],
            }],
          }],
        }],
      }), 'utf8');
      await fs.writeFile(path.join(tempDir, 'ozon_settings.json'), JSON.stringify({
        ai: { provider: 'deepseek', baseUrl: 'https://api.example.test', model: 'model', apiKey: 'ai-key' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
      }), 'utf8');

      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(aiDraftResponse())
        .mockResolvedValueOnce(categoryAttributeMeta())
        .mockResolvedValueOnce(categoryAttributeMeta())
        .mockResolvedValueOnce(categoryAttributeMeta())
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: '1688-offer', status: 'imported' }] } }) as Response);

      const flowSettings = {
        ai: { apiKey: 'ai-key', baseUrl: 'https://api.example.test', model: 'model' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
        userDataPath: tempDir,
      };
      const draft = await generateOzonDraft(flowSettings, [{
        offer_id: '1688-offer',
        sku_id: 'sku-1',
        search_keyword: '手机壳',
        product_title: '透明手机保护壳',
        sku_name: '颜色:透明',
        sku_price: '13',
        main_image_url: 'https://example.com/case.jpg',
        length_cm: '18',
        width_cm: '9',
        height_cm: '2',
        weight_g: '120',
        sku_stock: 10,
      }]);

      expect(draft.status).toBe('ready');
      expect(draft.items[0]).toMatchObject({
        description_category_id: 1700,
        type_id: 9300,
      });
      expect(draft.items[0].offer_id).toMatch(/^1688-/);

      const result = await submitOzonDraft(flowSettings, draft, { pollDelayMs: 0 });
      expect(result.importStatus).toBe('imported');
      expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
        'https://api.example.test/chat/completions',
        '/v1/description-category/attribute',
        '/v1/description-category/attribute',
        '/v1/description-category/attribute',
        '/v3/product/import',
        '/v1/product/import/info',
      ]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('imports product, polls task_id, and strips desktop-only fields', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(categoryAttributeMeta())
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

    const result = await submitOzonDraft(settings, baseDraft({
      items: [baseItem({
        _source: 'desktop_ai_draft',
        _category_path: 'Category / Type',
        _variant: { group_key: 'variant-group' },
      })],
    }), { pollDelayMs: 0 });

    expect(result.importStatus).toBe('imported');
    expect(result.taskId).toBe('8844');
    expect(result.priceResult).toBeNull();
    expect(result.stockResult).toBeNull();
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
    ]);
    const importCall = fetchMock.mock.calls.find((call) => endpointOf(call) === '/v3/product/import');
    const importBody = JSON.parse(String((importCall?.[1] as RequestInit).body || '{}'));
    expect(importBody.items[0]).not.toHaveProperty('_source');
    expect(importBody.items[0]).not.toHaveProperty('_category_path');
    expect(importBody.items[0]).not.toHaveProperty('_variant');
  });

  it('returns pending when import info does not finish in time', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(categoryAttributeMeta())
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValue(ok({ result: { items: [{ offer_id: 'offer-1', status: 'processing' }] } }) as Response);

    const result = await submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0, pollAttempts: 2 });

    expect(result.importStatus).toBe('pending');
    expect(result.warnings).toContain('Ozon 导入结果仍在处理中。');
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/import/info',
    ]);
  });

  it('rejects failed import info instead of reporting success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(categoryAttributeMeta())
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'failed', errors: [{ message: 'bad category' }] }] } }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/Ozon 导入失败.*bad category/);
  });

  it('does not call separate price or stock endpoints after import', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(categoryAttributeMeta())
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

    const result = await submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 });
    const endpoints = fetchMock.mock.calls.map(endpointOf);

    expect(result.importStatus).toBe('imported');
    expect(endpoints).not.toContain('/v1/product/import/prices');
    expect(endpoints).not.toContain('/v2/products/stocks');
  });

  it('blocks submit when category attribute metadata is empty', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(ok({ result: [] }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/没有返回属性元数据/);
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual(['/v1/description-category/attribute']);
  });

  it('blocks submit when required category attributes are absent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({
      result: [{ id: 85, name: '品牌', is_required: true }],
    }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/草稿缺少类目必填属性：品牌/);
  });

  it('marks multi-sku drafts as manual when variant mapping is not confirmed', () => {
    const missing = collectDraftMissing([baseItem(), baseItem({ offer_id: 'offer-2' })], {
      sourceRows: [{}, {}],
      generated: {},
    });

    expect(missing).toContain('规格属性映射');
  });

  describe('required-only autofill (TEST-01..03)', () => {
    async function categoryTreeDir(): Promise<string> {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-autofill-'));
      await fs.mkdir(path.join(tempDir, 'categories'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'categories', 'ozon_category_tree.zh_hans.json'), JSON.stringify({
        result: [{
          description_category_id: 1700,
          category_name: '手机配件',
          children: [{
            description_category_id: 1700,
            category_name: '保护配件',
            children: [{
              description_category_id: 1700,
              type_id: 9300,
              type_name: '手机壳',
              children: [],
            }],
          }],
        }],
      }), 'utf8');
      await fs.writeFile(path.join(tempDir, 'ozon_settings.json'), JSON.stringify({
        ai: { provider: 'deepseek', baseUrl: 'https://api.example.test', model: 'model', apiKey: 'ai-key' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
      }), 'utf8');
      return tempDir;
    }

    function autofillSettings(userDataPath: string) {
      return {
        ai: { apiKey: 'ai-key', baseUrl: 'https://api.example.test', model: 'model' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
        userDataPath,
      };
    }

    function autofillSourceRow(attrs: Record<string, string>) {
      return {
        offer_id: '1688-offer',
        sku_id: 'sku-1',
        search_keyword: '手机壳',
        product_title: '透明手机保护壳',
        sku_name: '颜色:透明',
        sku_price: '13',
        main_image_url: 'https://example.com/case.jpg',
        length_cm: '18',
        width_cm: '9',
        height_cm: '2',
        weight_g: '120',
        sku_stock: 10,
        ...(Object.keys(attrs).length ? { product_attributes_structured: attrs } : {}),
      };
    }

    it('autofills only required attrs via builtin mapping and keeps full metadata (TEST-01)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '材质', is_required: true },
          { id: 200, name: '颜色', is_required: false },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(meta);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '棉', 颜色: '红色' })]);

        const ids = (draft.generated.attribute_values || []).map((v) => Number(v.attribute_id));
        expect(ids).toContain(100);
        expect(ids).not.toContain(200);
        const metaIds = (draft.generated._category_attributes || []).map((a) => Number(a.id));
        expect(metaIds).toEqual(expect.arrayContaining([100, 200]));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('does not generate optional values even with a perfect builtin match (TEST-02)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([{ id: 200, name: '颜色', is_required: false }]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(meta);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 颜色: '红色' })]);

        expect(draft.generated.attribute_values || []).toHaveLength(0);
        const metaIds = (draft.generated._category_attributes || []).map((a) => Number(a.id));
        expect(metaIds).toEqual([200]);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('sends only required attrs to AI and drops optional IDs from responses (TEST-03)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '材质', is_required: true },
          { id: 200, name: '颜色', is_required: false },
          { id: 300, name: '尺码', is_required: true },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(aiSuggestionsResponse([
            { attribute_id: 100, value_text: '棉' },
            { attribute_id: 300, value_text: 'M' },
            { attribute_id: 200, value_text: '偷渡' },
          ]))
          .mockResolvedValueOnce(meta);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 款式: '圆领', 颜色: '红色' })]);

        const promptCall = fetchMock.mock.calls.find((call) =>
          String((call[1] as RequestInit).body || '').includes('suggest_ozon_category_attribute_values_from_1688_product'),
        );
        expect(promptCall).toBeTruthy();
        const promptBody = JSON.parse(String((promptCall![1] as RequestInit).body || '{}'));
        const userPayload = JSON.parse(promptBody.messages[1].content);
        const promptIds = userPayload.attributes.map((a: { id: number }) => Number(a.id));
        expect(promptIds).toEqual([100, 300]);
        expect(promptIds).not.toContain(200);

        const ids = (draft.generated.attribute_values || []).map((v) => Number(v.attribute_id));
        expect(ids).toEqual(expect.arrayContaining([100, 300]));
        expect(ids).not.toContain(200);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('dictionary integrity (TEST-01..05)', () => {
    async function categoryTreeDir(): Promise<string> {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-dict-'));
      await fs.mkdir(path.join(tempDir, 'categories'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'categories', 'ozon_category_tree.zh_hans.json'), JSON.stringify({
        result: [{
          description_category_id: 1700,
          category_name: '手机配件',
          children: [{
            description_category_id: 1700,
            category_name: '保护配件',
            children: [{
              description_category_id: 1700,
              type_id: 9300,
              type_name: '手机壳',
              children: [],
            }],
          }],
        }],
      }), 'utf8');
      await fs.writeFile(path.join(tempDir, 'ozon_settings.json'), JSON.stringify({
        ai: { provider: 'deepseek', baseUrl: 'https://api.example.test', model: 'model', apiKey: 'ai-key' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
      }), 'utf8');
      return tempDir;
    }

    function autofillSettings(userDataPath: string) {
      return {
        ai: { apiKey: 'ai-key', baseUrl: 'https://api.example.test', model: 'model' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
        userDataPath,
      };
    }

    function autofillSourceRow(attrs: Record<string, string>) {
      return {
        offer_id: '1688-offer',
        sku_id: 'sku-1',
        search_keyword: '手机壳',
        product_title: '透明手机保护壳',
        sku_name: '颜色:透明',
        sku_price: '13',
        main_image_url: 'https://example.com/case.jpg',
        length_cm: '18',
        width_cm: '9',
        height_cm: '2',
        weight_g: '120',
        sku_stock: 10,
        ...(Object.keys(attrs).length ? { product_attributes_structured: attrs } : {}),
      };
    }

    const emptyValues = () => okJson({ result: [] }) as Response;
    const dictHit = () => okJson({ result: [{ id: 123456, value: '双面德绒打底衫' }] }) as Response;

    it('builtin dictionary resolve failure leaves the attribute empty (TEST-01)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '材质', is_required: true, dictionary_id: 9000 },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(meta);
        fetchMock.mockResolvedValue(emptyValues());

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '长袖打底衫' })]);

        const ids = (draft.generated.attribute_values || []).map((v) => Number(v.attribute_id));
        expect(ids).not.toContain(100);
        const itemIds = (draft.items[0].attributes || []).map((a) => Number(a.id));
        expect(itemIds).not.toContain(100);
        const sources = (draft.generated.attribute_values || []).map((v) => v._source);
        expect(sources).not.toContain('builtin-nodict');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('AI dictionary resolve failure leaves the attribute empty (TEST-02)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '类型', is_required: true, dictionary_id: 9000 },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(aiSuggestionsResponse([
            { attribute_id: 100, value_text: '长袖打底衫', dictionary_query: '长袖打底衫' },
          ]))
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(meta);
        fetchMock.mockResolvedValue(emptyValues());

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '棉' })]);

        const ids = (draft.generated.attribute_values || []).map((v) => Number(v.attribute_id));
        expect(ids).not.toContain(100);
        const itemIds = (draft.items[0].attributes || []).map((a) => Number(a.id));
        expect(itemIds).not.toContain(100);
        const sources = (draft.generated.attribute_values || []).map((v) => v._source);
        expect(sources).not.toContain('ai-nodict');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('sanitizes historical generated values: dictionary without real id is dropped (TEST-03)', () => {
      const meta = [
        { id: 100, name: '类型', dictionaryId: 9000 },
        { id: 200, name: '风格', dictionaryId: 0 },
      ];
      const values = [
        { attribute_id: 100, value_text: '长袖打底衫', dictionary_value_id: null },
        { attribute_id: 100, value_text: '双面德绒打底衫', dictionary_value_id: 123456 },
        { attribute_id: 200, value_text: '休闲', dictionary_value_id: null },
      ];
      const sanitized = sanitizeGeneratedAttributeValues(values, meta);
      expect(sanitized).toEqual([
        { attribute_id: 100, value_text: '双面德绒打底衫', dictionary_value_id: 123456 },
        { attribute_id: 200, value_text: '休闲', dictionary_value_id: null },
      ]);
    });

    it('text-only dictionary value keeps the required attribute missing (TEST-04)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '材质', is_required: true, dictionary_id: 9000 },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(emptyValues())
          .mockResolvedValueOnce(meta);
        fetchMock.mockResolvedValue(emptyValues());

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '长袖打底衫' })]);

        expect(draft.missing).toContain('材质');
        expect(draft.status).toBe('needs_review');
        expect(draft.items[0].attributes.some((a) => Number(a.id) === 100)).toBe(false);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('a real dictionary_value_id marks the required attribute as filled (TEST-05)', async () => {
      const tempDir = await categoryTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = categoryMeta([
          { id: 100, name: '材质', is_required: true, dictionary_id: 9000 },
        ]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(dictHit())
          .mockResolvedValueOnce(dictHit())
          .mockResolvedValueOnce(meta);
        fetchMock.mockResolvedValue(emptyValues());

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '长袖打底衫' })]);

        const generated = draft.generated.attribute_values.find((v) => Number(v.attribute_id) === 100);
        expect(generated).toBeTruthy();
        expect(generated.dictionary_value_id).toBe(123456);
        expect(generated.value_text).toBe('双面德绒打底衫');
        const itemAttr = draft.items[0].attributes.find((a) => Number(a.id) === 100);
        expect(itemAttr.values).toEqual([{ dictionary_value_id: 123456, value: '双面德绒打底衫' }]);
        expect(draft.missing).not.toContain('材质');
        expect(draft.status).toBe('ready');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('hashtag integrity (TEST-01..10)', () => {
    function hashtagDraftItem(tags: Array<Record<string, unknown>> | string[]) {
      return baseItem({
        attributes: [
          { id: 9048, values: [{ value: 'model' }] },
          { id: 23171, values: tags.map((raw) => ({ value: typeof raw === 'string' ? raw : raw.value })) },
        ],
      });
    }

    function importBodyOf(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>) {
      const importCall = fetchMock.mock.calls.find((call) => endpointOf(call) === '/v3/product/import');
      return JSON.parse(String((importCall?.[1] as RequestInit).body || '{}')) as {
        items: Array<{ offer_id: string; attributes: Array<{ id: number; values: Array<{ value?: string }> }> }>;
      };
    }

    it('submits internal 23171 tags to the real metadata id 23171 (TEST-01)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const result = await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(['фигурка халкбастера', 'мстители фигурка'])],
      }), { pollDelayMs: 0 });

      expect(result.importStatus).toBe('imported');
      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      expect(tagAttr).toBeTruthy();
      expect(tagAttr!.values).toHaveLength(1);
      const value = String(tagAttr!.values[0].value);
      expect(value).toContain('#фигурка_халкбастера');
      expect(value).toContain('#мстители_фигурка');
    });

    it('remaps internal 23171 tags to metadata id 22508 (TEST-02)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 22508, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const result = await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(['фигурка халкбастера'])],
      }), { pollDelayMs: 0 });

      expect(result.importStatus).toBe('imported');
      const body = importBodyOf(fetchMock);
      const attrIds = body.items[0].attributes.map((a) => Number(a.id));
      expect(attrIds).toContain(22508);
      expect(attrIds).not.toContain(23171);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 22508);
      expect(String(tagAttr!.values[0].value)).toBe('#фигурка_халкбастера');
    });

    it('drops tags silently when the category has no hashtag attribute (TEST-03)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const result = await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(['фигурка халкбастера'])],
      }), { pollDelayMs: 0 });

      expect(result.importStatus).toBe('imported');
      const body = importBodyOf(fetchMock);
      const attrIds = body.items[0].attributes.map((a) => Number(a.id));
      expect(attrIds).not.toContain(23171);
      expect(attrIds).not.toContain(22508);
      expect(attrIds).toContain(9048);
    });

    it('keeps all tags in one value even with max_value_count=1 (TEST-04)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false, max_value_count: 1 },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const tags = ['марвел', 'фигурка', 'мстители', 'халкбастер', 'коллекционная фигурка'];
      await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(tags)],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      const value = String(tagAttr!.values[0].value);
      for (const expected of ['#марвел', '#фигурка', '#мстители', '#халкбастер', '#коллекционная_фигурка']) {
        expect(value).toContain(expected);
      }
      expect(value.split(/\s+/)).toHaveLength(5);
    });

    it('caps the tag count at 20 (TEST-05)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const tags = Array.from({ length: 25 }, (_, i) => `тег${String(i + 1).padStart(2, '0')}`);
      await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(tags)],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      const tokens = String(tagAttr!.values[0].value).split(/\s+/).filter(Boolean);
      expect(tokens).toHaveLength(20);
    });

    it('keeps every single tag within 30 chars (TEST-06)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      const longTag = 'супердлинноесловоназваниедляпроверкилимитадлины';
      await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem([longTag])],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      const tokens = String(tagAttr!.values[0].value).split(/\s+/).filter(Boolean);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].length).toBeLessThanOrEqual(30);
    });

    it('normalizes spaces and illegal punctuation into valid hashtags (TEST-07)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(['Marvel figure!', 'мстители фигурка', '#Hulk-Buster'])],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      const tokens = String(tagAttr!.values[0].value).split(/\s+/).filter(Boolean);
      expect(tokens).toEqual(['#Marvel_figure', '#мстители_фигурка', '#Hulk_Buster']);
      for (const token of tokens) {
        expect(token).toMatch(/^#[\p{L}\p{N}_]+$/u);
      }
    });

    it('deduplicates repeated tags (TEST-08)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      await submitOzonDraft(settings, baseDraft({
        items: [hashtagDraftItem(['#марвел', 'марвел', '#марвел'])],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 23171);
      expect(String(tagAttr!.values[0].value)).toBe('#марвел');
    });

    it('leaves non-hashtag attributes untouched (TEST-09)', async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(categoryMeta([
          { id: 9048, name: '型号', is_required: false },
          { id: 85, name: 'Бренд', is_required: false },
          { id: 4191, name: 'Описание', is_required: false },
          { id: 23171, name: '#主题标签', is_required: false },
        ]))
        .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
        .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

      await submitOzonDraft(settings, baseDraft({
        items: [baseItem({
          attributes: [
            { id: 9048, values: [{ value: 'model' }] },
            { id: 85, values: [{ value: 'NO NAME' }] },
            { id: 4191, values: [{ value: 'Описание для карточки.' }] },
            { id: 23171, values: [{ value: 'фигурка халкбастера' }] },
          ],
        })],
      }), { pollDelayMs: 0 });

      const body = importBodyOf(fetchMock);
      const attrs = body.items[0].attributes;
      const modelAttr = attrs.find((a) => Number(a.id) === 9048);
      const brandAttr = attrs.find((a) => Number(a.id) === 85);
      const descAttr = attrs.find((a) => Number(a.id) === 4191);
      expect(modelAttr!.values).toEqual([{ value: 'model' }]);
      expect(brandAttr!.values).toEqual([{ value: 'NO NAME' }]);
      expect(descAttr!.values).toEqual([{ value: 'Описание для карточки.' }]);
      const tagAttr = attrs.find((a) => Number(a.id) === 23171);
      expect(String(tagAttr!.values[0].value)).toBe('#фигурка_халкбастера');
    });

    it('captures the real /v3/product/import body with remapped hashtags (TEST-10)', async () => {
      const fetchMock = vi.mocked(fetch);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        fetchMock
          .mockResolvedValueOnce(categoryMeta([
            { id: 9048, name: '型号', is_required: false },
            { id: 22508, name: '#主题标签', is_required: false },
          ]))
          .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
          .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

        const tags = ['марвел', 'фигурка', 'мстители', 'халкбастер', 'коллекционная фигурка'];
        const result = await submitOzonDraft(settings, baseDraft({
          items: [hashtagDraftItem(tags)],
        }), { pollDelayMs: 0 });

        expect(result.importStatus).toBe('imported');
        const body = importBodyOf(fetchMock);
        const attrIds = body.items[0].attributes.map((a) => Number(a.id));
        expect(attrIds).toContain(22508);
        expect(attrIds).not.toContain(23171);
        expect(attrIds).toContain(9048);

        const tagAttr = body.items[0].attributes.find((a) => Number(a.id) === 22508);
        expect(tagAttr!.values).toHaveLength(1);
        const value = String(tagAttr!.values[0].value);
        const tokens = value.split(/\s+/).filter(Boolean);
        expect(tokens).toHaveLength(5);
        expect(value).toBe('#марвел #фигурка #мстители #халкбастер #коллекционная_фигурка');

        const hashtagLog = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(hashtagLog).toContain('[ozon-submit:hashtag] offer_id=offer-1 source_attr_id=23171 target_attr_id=22508 tag_count=5');
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  describe('merge card (TEST-01..13)', () => {
    const {
      formatMergeCardKey,
      applyMergeCardKeyToItems,
    } = require('../apps/desktop/ozon-attribute-specials.cjs') as {
      formatMergeCardKey: (date?: Date) => string;
      applyMergeCardKeyToItems: (items: Array<Record<string, any>>, attrMeta: Record<string, unknown>, mergeCardKey: string) => void;
    };

    const MERGE_CARD_ATTR_ID = 300;
    const MODEL_ATTR_ID = 200;

    async function mergeCardTreeDir(): Promise<string> {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-mergecard-'));
      await fs.mkdir(path.join(tempDir, 'categories'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'categories', 'ozon_category_tree.zh_hans.json'), JSON.stringify({
        result: [{
          description_category_id: 1700,
          category_name: '手机配件',
          children: [{
            description_category_id: 1700,
            category_name: '保护配件',
            children: [{
              description_category_id: 1700,
              type_id: 9300,
              type_name: '手机壳',
              children: [],
            }],
          }],
        }],
      }), 'utf8');
      await fs.writeFile(path.join(tempDir, 'ozon_settings.json'), JSON.stringify({
        ai: { provider: 'deepseek', baseUrl: 'https://api.example.test', model: 'model', apiKey: 'ai-key' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
      }), 'utf8');
      return tempDir;
    }

    function autofillSettings(userDataPath: string) {
      return {
        ai: { apiKey: 'ai-key', baseUrl: 'https://api.example.test', model: 'model' },
        ozon: { clientId: 'client', apiKey: 'key', currencyCode: 'CNY' },
        userDataPath,
      };
    }

    function autofillSourceRow(attrs: Record<string, string>, skuName = '颜色:透明') {
      return {
        offer_id: '1688-offer',
        sku_id: 'sku-1',
        search_keyword: '手机壳',
        product_title: '透明手机保护壳',
        sku_name: skuName,
        sku_price: '13',
        main_image_url: 'https://example.com/case.jpg',
        length_cm: '18',
        width_cm: '9',
        height_cm: '2',
        weight_g: '120',
        sku_stock: 10,
        ...(Object.keys(attrs).length ? { product_attributes_structured: attrs } : {}),
      };
    }

    function mergeCardMeta(extraAttrs: Array<Record<string, unknown>> = []) {
      return categoryMeta([
        { id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片', is_required: true },
        ...extraAttrs,
      ]);
    }

    function mergeCardSourceQueue(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>) {
      fetchMock
        .mockResolvedValueOnce(aiDraftResponse())
        .mockResolvedValueOnce(mergeCardMeta([{ id: MODEL_ATTR_ID, name: '型号', is_required: true }]))
        .mockResolvedValueOnce(aiSuggestionsResponse([{ attribute_id: MODEL_ATTR_ID, value_text: 'XL' }]))
        .mockResolvedValueOnce(mergeCardMeta([{ id: MODEL_ATTR_ID, name: '型号', is_required: true }]));
      fetchMock.mockResolvedValue(emptyValues());
    }

    function emptyValues() {
      return okJson({ result: [] }) as Response;
    }

    function mergeCardValueOf(item: Record<string, any>): string {
      const attrs = Array.isArray(item.attributes) ? item.attributes : [];
      const attr = attrs.find((a) => Number(a.id) === MERGE_CARD_ATTR_ID);
      return String(attr?.values?.[0]?.value || '');
    }

    function dictHit() {
      return okJson({ result: [{ id: 123456, value: '双面德绒打底衫' }] }) as Response;
    }

    function importBodyOf(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>) {
      const importCall = fetchMock.mock.calls.find((call) => endpointOf(call) === '/v3/product/import');
      return JSON.parse(String((importCall?.[1] as RequestInit).body || '{}')) as {
        items: Array<{ offer_id: string; attributes: Array<{ id: number; values: Array<{ value?: string }> }> }>;
      };
    }

    it('formats yyyyMMddHHmmss in LOCAL time (TEST-01)', () => {
      expect(formatMergeCardKey(new Date(2026, 7, 8, 19, 8, 37))).toBe('20260808190837');
      expect(formatMergeCardKey(new Date(2026, 0, 5, 0, 0, 0))).toBe('20260105000000');
      expect(formatMergeCardKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('20261231235959');
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 7, 8, 19, 8, 37));
        expect(formatMergeCardKey()).toBe('20260808190837');
      } finally {
        vi.useRealTimers();
      }
    });

    it('generates one 14-digit key for a single SKU (TEST-02)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);

        const key = String(draft.generated.merge_card_key || '');
        expect(key).toMatch(/^\d{14}$/);
        expect(mergeCardValueOf(draft.items[0])).toBe(key);
        expect(draft.status).toBe('ready');

        const mergeCardLog = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(mergeCardLog).toContain('[ozon-merge-card]');
        expect(mergeCardLog).toContain('unique_values=1');
        stderrSpy.mockRestore();
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('gives EVERY SKU the same key (5 SKUs) (TEST-03)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);
        const rows = ['透明', '黑色', '蓝色', '红色', '白色'].map((color, index) => ({
          ...autofillSourceRow({}, `颜色:${color}`),
          sku_id: `sku-${index}`,
        }));

        const draft = await generateOzonDraft(autofillSettings(tempDir), rows);

        const key = String(draft.generated.merge_card_key || '');
        expect(key).toMatch(/^\d{14}$/);
        expect(draft.items).toHaveLength(5);
        expect(new Set(draft.items.map((item: Record<string, any>) => mergeCardValueOf(item)))).toEqual(new Set([key]));
        expect(draft.items.every((item: Record<string, any>) => mergeCardValueOf(item) === key)).toBe(true);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('gives EVERY SKU the same key (20 SKUs) (TEST-04)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);
        const rows = Array.from({ length: 20 }, (_, index) => ({
          ...autofillSourceRow({}, `颜色:${index}`),
          sku_id: `sku-${index}`,
        }));

        const draft = await generateOzonDraft(autofillSettings(tempDir), rows);

        const key = String(draft.generated.merge_card_key || '');
        expect(key).toMatch(/^\d{14}$/);
        expect(draft.items).toHaveLength(20);
        expect(new Set(draft.items.map((item: Record<string, any>) => mergeCardValueOf(item)))).toEqual(new Set([key]));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('excludes the merge card attribute from the AI prompt (TEST-05)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);

        const aiCalls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('https://api.example.test'));
        expect(aiCalls.length).toBeGreaterThanOrEqual(2);
        const suggestionCall = aiCalls[aiCalls.length - 1];
        const body = JSON.parse(String((suggestionCall?.[1] as RequestInit).body || '{}'));
        const prompt = JSON.stringify(body);
        expect(prompt).not.toContain('合并至一张卡片');
        expect(prompt).not.toContain('объедин');

        const attrIds = (draft.generated.attribute_values || []).map((v: Record<string, unknown>) => Number(v.attribute_id));
        expect(attrIds).not.toContain(MERGE_CARD_ATTR_ID);
        expect(mergeCardValueOf(draft.items[0])).toBe(String(draft.generated.merge_card_key));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('never calls the dictionary values endpoint (TEST-06)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);

        const valuesCalls = fetchMock.mock.calls.filter((call) =>
          endpointOf(call).startsWith('/v1/description-category/attribute/values'),
        );
        expect(valuesCalls).toHaveLength(0);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('keeps the key across save (JSON round-trip) and re-resolution (TEST-07)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);
        const key = String(draft.generated.merge_card_key || '');

        const saved = JSON.parse(JSON.stringify(draft));
        expect(String(saved.generated.merge_card_key)).toBe(key);
        expect(mergeCardValueOf(saved.items[0])).toBe(key);

        resolveMergeCardKeys(saved.generated, [{ id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片' }], saved.items);
        expect(String(saved.generated.merge_card_key)).toBe(key);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('submits the persisted key unchanged after reopen (TEST-08)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);
        const key = String(draft.generated.merge_card_key || '');
        const saved = JSON.parse(JSON.stringify(draft));

        fetchMock.mockReset();
        fetchMock
          .mockResolvedValueOnce(categoryMeta([
            { id: 9048, name: '型号', is_required: true },
            { id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片', is_required: true },
          ]))
          .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
          .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response);

        const result = await submitOzonDraft(autofillSettings(tempDir), saved, { pollDelayMs: 0 });

        expect(result.importStatus).toBe('imported');
        const body = importBodyOf(fetchMock);
        expect(mergeCardValueOf(body.items[0])).toBe(key);
        const attrIds = body.items[0].attributes.map((a) => Number(a.id));
        expect(attrIds).toContain(MERGE_CARD_ATTR_ID);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('replaces historical Chinese values with one fresh key (TEST-09)', () => {
      const generated = { title_ru: 'T' };
      const items = [
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '8801款' }] }] },
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '8801款' }] }] },
      ];
      const specialAttrs = [{ id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片' }];

      const found = resolveMergeCardKeys(generated, specialAttrs, items);
      expect(found).toHaveLength(1);
      expect(String(generated.merge_card_key)).toMatch(/^\d{14}$/);
      expect(String(generated.merge_card_key)).not.toBe('8801款');
      expect(String(generated.merge_card_key)).not.toContain('8801');

      applyMergeCardKeyToItems(items, specialAttrs[0], String(generated.merge_card_key));
      expect(new Set(items.map((item) => mergeCardValueOf(item)))).toEqual(new Set([String(generated.merge_card_key)]));
    });

    it('replaces inconsistent historical values with one fresh key (TEST-10)', () => {
      const generated = { title_ru: 'T' };
      const items = [
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '20260101120000' }] }] },
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '20260101120001' }] }] },
      ];
      const specialAttrs = [{ id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片' }];

      const found = resolveMergeCardKeys(generated, specialAttrs, items);
      expect(found).toHaveLength(1);
      const key = String(generated.merge_card_key);
      expect(key).toMatch(/^\d{14}$/);
      expect(key).not.toBe('20260101120000');
      expect(key).not.toBe('20260101120001');

      applyMergeCardKeyToItems(items, specialAttrs[0], key);
      expect(new Set(items.map((item) => mergeCardValueOf(item)))).toEqual(new Set([key]));
    });

    it('adopts a valid consistent 14-digit historical value as the key (TEST-11)', () => {
      const generated = { title_ru: 'T' };
      const items = [
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '20260101120000' }] }] },
        { attributes: [{ id: MERGE_CARD_ATTR_ID, values: [{ value: '20260101120000' }] }] },
      ];
      const specialAttrs = [{ id: MERGE_CARD_ATTR_ID, name: '合并至一张卡片' }];

      const found = resolveMergeCardKeys(generated, specialAttrs, items);
      expect(found).toHaveLength(1);
      expect(String(generated.merge_card_key)).toBe('20260101120000');

      applyMergeCardKeyToItems(items, specialAttrs[0], String(generated.merge_card_key));
      expect(new Set(items.map((item) => mergeCardValueOf(item)))).toEqual(new Set(['20260101120000']));
    });

    it('other required attributes are still AI-filled normally (TEST-12)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        mergeCardSourceQueue(fetchMock);

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({})]);

        const generated = (draft.generated.attribute_values || []) as Array<Record<string, unknown>>;
        expect(generated.some((v) => Number(v.attribute_id) === MODEL_ATTR_ID && v.value_text === 'XL')).toBe(true);
        const modelAttr = draft.items[0].attributes.find((a: Record<string, any>) => Number(a.id) === MODEL_ATTR_ID);
        expect(modelAttr?.values?.[0]?.value).toBe('XL');
        expect(mergeCardValueOf(draft.items[0])).toBe(String(draft.generated.merge_card_key));
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('dictionary resolution for other required attributes is untouched (TEST-13)', async () => {
      const tempDir = await mergeCardTreeDir();
      try {
        const fetchMock = vi.mocked(fetch);
        const meta = mergeCardMeta([{ id: 100, name: '材质', is_required: true, dictionary_id: 9000 }]);
        fetchMock
          .mockResolvedValueOnce(aiDraftResponse())
          .mockResolvedValueOnce(meta)
          .mockResolvedValueOnce(dictHit())
          .mockResolvedValueOnce(dictHit())
          .mockResolvedValueOnce(meta);
        fetchMock.mockResolvedValue(emptyValues());

        const draft = await generateOzonDraft(autofillSettings(tempDir), [autofillSourceRow({ 材质: '长袖打底衫' })]);

        const generated = (draft.generated.attribute_values || []) as Array<Record<string, unknown>>;
        const material = generated.find((v) => Number(v.attribute_id) === 100);
        expect(material).toBeTruthy();
        expect(Number(material.dictionary_value_id)).toBe(123456);
        expect(String(material.value_text)).toBe('双面德绒打底衫');
        const materialAttr = draft.items[0].attributes.find((a: Record<string, any>) => Number(a.id) === 100);
        expect(materialAttr?.values?.[0]).toEqual({ dictionary_value_id: 123456, value: '双面德绒打底衫' });
        expect(mergeCardValueOf(draft.items[0])).toBe(String(draft.generated.merge_card_key));
        expect(draft.status).toBe('ready');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
