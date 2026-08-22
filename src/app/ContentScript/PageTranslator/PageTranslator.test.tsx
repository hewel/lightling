import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import { PageTranslator } from './PageTranslator';

const translateCalls: PageTranslationBatchRequest[] = [];

vi.mock('@/requests/backend/translatePageBatch', () => ({
  translatePageBatch: vi.fn(async (request: PageTranslationBatchRequest) => {
    translateCalls.push(request);
    return {
      translations: request.targets.map((target) => ({
        id: target.id,
        target: `tr:${target.sourceText}`,
        cacheKey: target.semanticKey,
        cacheHit: false,
      })),
    };
  }),
}));

const abortCalls: { context: string }[] = [];

vi.mock('@/requests/backend/abortTranslation', () => ({
  abortTranslation: vi.fn(async (payload: { context: string }) => {
    abortCalls.push(payload);
  }),
}));

vi.mock('./requests/pageTranslatorStatsUpdated', () => ({
  pageTranslatorStatsUpdated: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  getContentScriptStyles: () => [],
}));

describe('PageTranslator lifecycle and cancellation context', () => {
  beforeEach(() => {
    translateCalls.length = 0;
    abortCalls.length = 0;
    document.body.innerHTML = '<main><p>Hello world</p><p>Testing text</p></main>';
  });

  test('uses a stable session context, restores source, and replaces the context on rerun', async () => {
    const pageTranslator = new PageTranslator({});

    pageTranslator.run('en', 'de');
    expect(pageTranslator.getTranslateDirection()).toEqual({ from: 'en', to: 'de' });
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));

    const firstContext = translateCalls[0].sessionId;
    expect(firstContext).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(translateCalls.every((call) => call.sessionId === firstContext)).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelector('p')?.textContent).toBe('tr:Hello world'),
    );

    pageTranslator.stop();
    expect(pageTranslator.getTranslateDirection()).toBeNull();
    expect(document.querySelector('p')?.textContent).toBe('Hello world');
    expect(abortCalls).toEqual([{ context: firstContext }]);

    translateCalls.length = 0;
    pageTranslator.run('en', 'fr');
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));

    const secondContext = translateCalls[0].sessionId;
    expect(secondContext).not.toBe(firstContext);
    expect(translateCalls.every((call) => call.sessionId === secondContext)).toBe(true);

    pageTranslator.stop();
    expect(abortCalls.at(-1)).toEqual({ context: secondContext });
  });
});
