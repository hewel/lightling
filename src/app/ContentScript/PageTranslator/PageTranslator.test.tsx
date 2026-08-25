import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { llmProviderPresets } from '@/lib/translators/llm/presets';
import { conservativeTokenCounter } from '@/lib/translators/llm/tokenizer';

import type { PageTranslationSessionDescriptor } from './pageTranslationSession';
import { PageTranslator } from './PageTranslator';

const prepareSession = vi.hoisted(() => vi.fn());

vi.mock('./pageTranslationSession', () => ({
  preparePageTranslationSession: prepareSession,
}));
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
        provenance: 'provider',
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
const createSession = (
  sessionId = 'session',
  modelProfile = createConservativeTranslationModelProfile('test-model'),
): PageTranslationSessionDescriptor => ({
  sessionId,
  sessionSignature: `${location.href}\u0000signature`,
  provider: 'test',
  model: 'test-model',
  modelProfile,
  tokenCounter: conservativeTokenCounter,
  sizeTier: 'small',
  persistedBudget: null,
  onBudgetSnapshot: vi.fn(),
  logEnabled: false,
  debug: false,
});

describe('PageTranslator lifecycle and cancellation context', () => {
  beforeEach(() => {
    prepareSession.mockReset();
    prepareSession.mockImplementation((input: { sessionId: string }) =>
      Promise.resolve(createSession(input.sessionId)),
    );
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

  test('rolls back a rejected preparation so a retry can start', async () => {
    prepareSession.mockRejectedValueOnce(new Error('prepare failed'));
    const pageTranslator = new PageTranslator({});

    await expect(pageTranslator.run('en', 'de')).rejects.toThrow('prepare failed');

    expect(pageTranslator.isRun()).toBe(false);
    expect(translateCalls).toHaveLength(0);

    await pageTranslator.run('en', 'de');
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));
    pageTranslator.stop();
  });

  test('stops a pending preparation without starting a pipeline', async () => {
    const deferred = Promise.withResolvers<PageTranslationSessionDescriptor>();
    prepareSession.mockReturnValueOnce(deferred.promise);
    const pageTranslator = new PageTranslator({});
    const run = pageTranslator.run('en', 'de');

    expect(pageTranslator.isRun()).toBe(true);
    pageTranslator.stop();
    deferred.resolve(createSession());
    await run;

    expect(pageTranslator.isRun()).toBe(false);
    expect(translateCalls).toHaveLength(0);
  });
  test('does not race two starts while preparation is pending', async () => {
    const deferred = Promise.withResolvers<PageTranslationSessionDescriptor>();
    prepareSession.mockReturnValueOnce(deferred.promise);
    const pageTranslator = new PageTranslator({});
    const firstRun = pageTranslator.run('en', 'de');

    await expect(pageTranslator.run('en', 'fr')).rejects.toThrow(
      'Page already translated',
    );
    deferred.resolve(createSession());
    await firstRun;
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));

    expect(prepareSession).toHaveBeenCalledTimes(1);
    pageTranslator.stop();
  });

  test('rejects pending preparation when navigation changes the URL and allows a new route', async () => {
    const originalUrl = location.href;
    const deferred = Promise.withResolvers<PageTranslationSessionDescriptor>();
    prepareSession.mockReturnValueOnce(deferred.promise);
    const pageTranslator = new PageTranslator({});
    const run = pageTranslator.run('en', 'de');

    location.href = 'https://page.test/pending-navigation';
    deferred.resolve(createSession());
    await expect(run).rejects.toThrow('startup cancelled');
    location.href = originalUrl;

    expect(pageTranslator.isRun()).toBe(false);
    expect(translateCalls).toHaveLength(0);

    await pageTranslator.run('en', 'de');
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));
    pageTranslator.stop();
  });
  test('uses the fallback active profile concurrency ceiling', async () => {
    const baseProfile = createConservativeTranslationModelProfile('test-model');
    const modelProfile = {
      ...baseProfile,
      adaptive: { enabled: true },
      batching: { ...baseProfile.batching, concurrency: 8 },
    };
    prepareSession.mockImplementation((input: { sessionId: string }) => {
      const session = createSession(input.sessionId, modelProfile);
      session.logEnabled = true;
      return Promise.resolve(session);
    });
    const fallback = {
      ...structuredClone(llmProviderPresets.custom),
      name: 'Fallback',
      maxConcurrentRequests: 1,
    };
    const pageTranslator = new PageTranslator({
      translatorModule: 'LLMTranslator',
      llmTranslator: {
        activeProfile: 'missing',
        profiles: [fallback],
      },
      enableLogExport: true,
    });

    await pageTranslator.run('en', 'de');
    await vi.waitFor(() => expect(translateCalls.length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(pageTranslator.getTranslationLog()?.batches[0]?.parallelism).toBeDefined(),
    );
    expect(pageTranslator.getTranslationLog()?.batches[0]?.parallelism).toMatchObject({
      dispatchConcurrency: 1,
    });
    pageTranslator.stop();
  });
});
