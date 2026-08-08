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
});
