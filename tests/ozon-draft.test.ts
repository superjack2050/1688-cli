import { createRequire } from 'node:module';
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
      status: 'needs_attribute_mapping',
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
      mapping_status: 'needs_attribute_mapping',
    });
    expect(draft.missing).toContain('规格属性映射');
  });

  it('imports product, polls task_id, then updates price and stock', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response);

    const result = await submitOzonDraft(settings, baseDraft({
      items: [baseItem({
        _source: 'desktop_ai_draft',
        _category_path: 'Category / Type',
        _variant: { group_key: 'variant-group' },
      })],
    }), { pollDelayMs: 0 });

    expect(result.importStatus).toBe('listing_ready');
    expect(result.taskId).toBe('8844');
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/import/prices',
      '/v2/products/stocks',
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
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValue(ok({ result: { items: [{ offer_id: 'offer-1', status: 'processing' }] } }) as Response);

    const result = await submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0, pollAttempts: 2 });

    expect(result.importStatus).toBe('pending');
    expect(result.warnings).toContain('Ozon 导入结果仍在处理中，尚未执行价格和库存更新。');
    expect(fetchMock.mock.calls.map(endpointOf)).toEqual([
      '/v1/description-category/attribute',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/import/info',
    ]);
  });

  it('rejects failed import info instead of reporting success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'failed', errors: [{ message: 'bad category' }] }] } }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/Ozon 导入失败.*bad category/);
  });

  it('rejects price update errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: { errors: [{ message: 'bad price' }] } }) as Response);

    await expect(submitOzonDraft(settings, baseDraft(), { pollDelayMs: 0 }))
      .rejects.toThrow(/价格更新失败.*bad price/);
  });

  it('skips stock update and warns when stock exists but warehouse is missing', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(ok({ result: [] }) as Response)
      .mockResolvedValueOnce(ok({ result: { task_id: 8844 } }) as Response)
      .mockResolvedValueOnce(ok({ result: { items: [{ offer_id: 'offer-1', status: 'imported' }] } }) as Response)
      .mockResolvedValueOnce(ok({ result: [] }) as Response);

    const result = await submitOzonDraft(
      { ozon: { ...settings.ozon, defaultWarehouseId: '' } },
      baseDraft(),
      { pollDelayMs: 0 },
    );

    expect(result.importStatus).toBe('imported');
    expect(result.warnings).toContain('库存待配置：未设置 Ozon 仓库 ID，已跳过库存更新。');
    expect(fetchMock.mock.calls.map(endpointOf)).not.toContain('/v2/products/stocks');
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
});
