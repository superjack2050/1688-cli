import { EventEmitter } from 'node:events';
import type { Page, Response as PWResponse } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_SEARCH_RESULT_METHODS,
  IMAGE_SEARCH_UPLOAD_URL,
  imageSearchResultUrl,
} from '../src/commands/image-search.js';
import { startSearchOfferCapture } from '../src/session/search-capture.js';
import { SEARCH_APP_ID, SEARCH_MTOP_API } from '../src/session/search-mtop.js';

describe('image-search URLs', () => {
  it('uploads through the 1688 image-search entry point', () => {
    expect(IMAGE_SEARCH_UPLOAD_URL).toBe('https://s.1688.com/youyuan/index.htm');
  });

  it('opens the pc-image-search app for results, not the legacy offer_search page', () => {
    // Regression: s.1688.com/selloffer/offer_search.htm?imageId=... no longer
    // performs an image search — 1688 ignores imageId there and renders the
    // generic keyword-search page, whose getOfferList call returns a
    // personalised "猜你喜欢" feed. Every image then yielded the same 60 offers.
    const url = imageSearchResultUrl('1022008822148672367');

    expect(url).toBe(
      'https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=1022008822148672367&imageIdList=1022008822148672367',
    );
    expect(url).not.toContain('offer_search.htm');
  });

  it('URL-encodes the imageId', () => {
    expect(imageSearchResultUrl('a b')).toContain('imageId=a%20b&imageIdList=a%20b');
  });
});

// --- capture scoping -------------------------------------------------------

class MockPage extends EventEmitter {
  emitResponse(response: PWResponse): void {
    this.emit('response', response);
  }
}

function page(): Page & MockPage {
  return new MockPage() as unknown as Page & MockPage;
}

function response(url: string, body: string): PWResponse {
  return { url: () => url, text: async () => body } as unknown as PWResponse;
}

function recommendUrl(
  params: Record<string, unknown>,
  appId: string | number = SEARCH_APP_ID,
): string {
  return `https://h5api.m.1688.com/h5/${SEARCH_MTOP_API}/2.0/?data=${encodeURIComponent(
    JSON.stringify({ appId, params: JSON.stringify(params) }),
  )}`;
}

function body(...offerIds: string[]): string {
  return `mtopjsonpreqTppId_32517_getOfferList2(${JSON.stringify({
    data: {
      data: {
        OFFER: {
          items: offerIds.map((offerId) => ({ data: { offerId, title: `Offer ${offerId}` } })),
        },
      },
    },
  })})`;
}

// What getImageSearchPreResult returns while the server is still computing.
const PLACEHOLDER_BODY =
  'mtopjsonpreqTppId_32517_getOfferList1({"api":"mtop.relationrecommend.wirelessrecommend.recommend","data":{"result":[],"mock":["mock"],"version":1.0},"ret":["SUCCESS::调用成功"],"v":"2.0"})';

const IMAGE_ID = '1022008822148672367';

describe('image-search result capture', () => {
  it('names the mtop methods the pc-image-search results page uses', () => {
    expect([...IMAGE_SEARCH_RESULT_METHODS]).toEqual([
      'getImageSearchPreResult',
      'imageOfferSearchService',
    ]);
  });

  it('fresh search: skips the pre-result placeholder and takes imageOfferSearchService', async () => {
    const mockPage = page();
    const capture = startSearchOfferCapture({
      page: mockPage,
      keep: 'largest',
      requireMethod: IMAGE_SEARCH_RESULT_METHODS,
    });

    const wait = capture.wait({ timeoutMs: 50, intervalMs: 1 });
    // Personalised feed — what the legacy page returned for every image.
    mockPage.emitResponse(
      response(recommendUrl({ method: 'getOfferList', beginPage: 1 }), body('feed-1', 'feed-2', 'feed-3')),
    );
    // Behaviour report on another appId.
    mockPage.emitResponse(
      response(recommendUrl({ modelName: 'imageSearchBehavior', action: 'REPORT' }, '53911'), body('report')),
    );
    // Pre-result not ready yet.
    mockPage.emitResponse(
      response(
        recommendUrl({ method: 'getImageSearchPreResult', beginPage: 1, imageId: IMAGE_ID }),
        PLACEHOLDER_BODY,
      ),
    );
    // The real image-search result.
    mockPage.emitResponse(
      response(
        recommendUrl({ method: 'imageOfferSearchService', beginPage: 1, imageId: IMAGE_ID }),
        body('match-1', 'match-2'),
      ),
    );

    const result = await wait;
    expect(result.status).toBe('captured');
    expect(result.offers.map((o) => o.offerId)).toEqual(['match-1', 'match-2']);
    expect(result.diagnostics.matchedCount).toBe(2);
    expect(result.diagnostics.parsedCount).toBe(1);
    capture.dispose();
  });

  it('cached search: takes the offers from getImageSearchPreResult directly', async () => {
    const mockPage = page();
    const capture = startSearchOfferCapture({
      page: mockPage,
      keep: 'largest',
      requireMethod: IMAGE_SEARCH_RESULT_METHODS,
    });

    const wait = capture.wait({ timeoutMs: 50, intervalMs: 1 });
    mockPage.emitResponse(
      response(
        recommendUrl({ method: 'getImageSearchPreResult', beginPage: 1, imageId: IMAGE_ID }),
        body('cached-1', 'cached-2', 'cached-3'),
      ),
    );

    const result = await wait;
    expect(result.status).toBe('captured');
    expect(result.offers.map((o) => o.offerId)).toEqual(['cached-1', 'cached-2', 'cached-3']);
    capture.dispose();
  });
});

describe('startSearchOfferCapture requireMethod', () => {
  it('still accepts a single method string', async () => {
    const mockPage = page();
    const capture = startSearchOfferCapture({ page: mockPage, requireMethod: 'getOfferList' });

    const wait = capture.wait({ timeoutMs: 50, intervalMs: 1 });
    mockPage.emitResponse(
      response(recommendUrl({ method: 'imageOfferSearchService', beginPage: 1 }), body('no')),
    );
    mockPage.emitResponse(response(recommendUrl({ method: 'getOfferList', beginPage: 1 }), body('yes')));

    const result = await wait;
    expect(result.offers.map((o) => o.offerId)).toEqual(['yes']);
    capture.dispose();
  });
});
