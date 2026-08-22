import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import type { LLMBatchRequestOptions, LLMBatchTranslator } from './LLMBatchTranslator';
import { LLMScheduler, type LLMSchedulerConfig } from './LLMScheduler';
import {
  TranslationAbortedError,
  TranslationSchedulerReplacedError,
} from './LLMTranslationEngine';
class StubLLMTranslator implements LLMBatchTranslator {
  calls: Array<{
    texts: string[];
    from: string;
    to: string;
    options: LLMBatchRequestOptions;
  }> = [];
  pageCalls: Array<{
    request: PageTranslationBatchRequest;
    options: LLMBatchRequestOptions;
  }> = [];
  abortedContexts: string[] = [];
  disposed = false;

  translateBatchWithOptions = vi.fn(
    async (
      texts: string[],
      from: string,
      to: string,
      options: LLMBatchRequestOptions,
    ): Promise<string[]> => {
      this.calls.push({ texts, from, to, options });
      return texts.map((t) => `tr:${t}`);
    },
  );

  executePageBatch = vi.fn(
    async (
      request: PageTranslationBatchRequest,
      options: LLMBatchRequestOptions,
    ): Promise<{ id: string; target: string }[]> => {
      this.pageCalls.push({ request, options });
      return request.targets.map((target) => ({
        id: target.id,
        target: `tr:${target.sourceText}`,
      }));
    },
  );

  abort = vi.fn((context: string) => {
    this.abortedContexts.push(context);
  });

  dispose = vi.fn(() => {
    this.disposed = true;
  });
}

const defaultConfig: LLMSchedulerConfig = {
  translateRetryAttemptLimit: 2,
  directTranslateLength: null,
  translatePoolDelay: 300,
  chunkSizeForInstantTranslate: null,
};

describe('LLMScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('pooling unions same-key texts into one batch call', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    const promise1 = scheduler.translate('hello', 'en', 'es', {
      context: 'page-1',
      priority: 1,
    });
    const promise2 = scheduler.translate('world', 'en', 'es', {
      context: 'page-1',
      priority: 1,
    });

    expect(stubTranslator.calls.length).toBe(0);

    vi.advanceTimersByTime(300);

    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).toBe('tr:hello');
    expect(res2).toBe('tr:world');
    expect(stubTranslator.calls.length).toBe(1);
    expect(stubTranslator.calls[0]).toEqual({
      texts: ['hello', 'world'],
      from: 'en',
      to: 'es',
      options: {
        context: 'page-1',
        priority: 1,
        retryLimit: 2,
      },
    });
  });

  test('dispatches queued ordinary batches by priority and preserves FIFO ties', async () => {
    const stubTranslator = new StubLLMTranslator();
    const started: string[] = [];
    let releaseFirst: ((value: string[]) => void) | undefined;
    stubTranslator.translateBatchWithOptions.mockImplementation(
      async (texts: string[]) => {
        started.push(texts[0]);
        if (texts[0] === 'first') {
          return new Promise<string[]>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return texts.map((text) => `tr:${text}`);
      },
    );
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, vi.fn());

    const first = scheduler.translate('first', 'en', 'es', { directTranslate: true });
    const low = scheduler.translate('low', 'en', 'es', {
      directTranslate: true,
      priority: 1,
    });
    const high = scheduler.translate('high', 'en', 'es', {
      directTranslate: true,
      priority: 5,
    });

    expect(started).toEqual(['first']);
    releaseFirst?.(['tr:first']);
    await Promise.resolve();
    await expect(high).resolves.toBe('tr:high');
    await expect(low).resolves.toBe('tr:low');
    await expect(first).resolves.toBe('tr:first');
    expect(started).toEqual(['first', 'high', 'low']);
  });
  test('limits concurrent ordinary executions to configured profile concurrency', async () => {
    const stubTranslator = new StubLLMTranslator();
    const deferreds: Array<{
      promise: Promise<string[]>;
      resolve(value: string[]): void;
    }> = [];
    let active = 0;
    let maxActive = 0;
    stubTranslator.translateBatchWithOptions.mockImplementation(
      async (_texts: string[]) => {
        active++;
        maxActive = Math.max(maxActive, active);
        const deferred = Promise.withResolvers<string[]>();
        deferreds.push(deferred);
        const result = await deferred.promise;
        active--;
        return result;
      },
    );
    const scheduler = new LLMScheduler(
      stubTranslator,
      { ...defaultConfig, maxConcurrentRequests: 2 },
      vi.fn(),
    );

    const first = scheduler.translate('first', 'en', 'es', { directTranslate: true });
    const second = scheduler.translate('second', 'en', 'es', { directTranslate: true });
    const third = scheduler.translate('third', 'en', 'es', { directTranslate: true });

    expect(maxActive).toBe(2);
    deferreds[0].resolve(['tr:first']);
    deferreds[1].resolve(['tr:second']);
    for (let i = 0; i < 10 && deferreds.length < 3; i++) {
      await Promise.resolve();
    }
    deferreds[2].resolve(['tr:third']);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'tr:first',
      'tr:second',
      'tr:third',
    ]);
    expect(maxActive).toBe(2);
  });

  test('dispatches page batches by priority through the shared scheduler', async () => {
    const stubTranslator = new StubLLMTranslator();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, vi.fn());
    const makeRequest = (id: string): PageTranslationBatchRequest => ({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      sessionId: 'session',
      memory: {
        languageDirection: 'auto',
        glossary: [],
        protectedTerms: [],
        namedEntities: [],
      },
      context: {
        headingPath: [],
        previous: [],
        following: [],
        retrieved: [],
      },
      group: { kind: 'body', slot: 'visible-text', contextClass: 'main:body' },
      targets: [
        {
          id,
          sourceText: id,
          normalizedText: id,
          kind: 'body',
          slot: 'visible-text',
          contextClass: 'main:body',
          semanticKey: id,
          priority: 1,
        },
      ],
    });

    const low = scheduler.translatePageBatch(makeRequest('low'), {
      context: 'page-low',
      priority: 1,
      retryLimit: 2,
    });
    const high = scheduler.translatePageBatch(makeRequest('high'), {
      context: 'page-high',
      priority: 5,
      retryLimit: 2,
    });

    await Promise.all([low, high]);
    expect(stubTranslator.pageCalls.map(({ request }) => request.targets[0].id)).toEqual([
      'high',
      'low',
    ]);
  });

  test('differing priority or context prevents pooling', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    const p1 = scheduler.translate('text1', 'en', 'es', {
      context: 'ctx-A',
      priority: 0,
    });
    const p2 = scheduler.translate('text2', 'en', 'es', {
      context: 'ctx-B',
      priority: 0,
    });
    const p3 = scheduler.translate('text3', 'en', 'es', {
      context: 'ctx-A',
      priority: 1,
    });

    vi.advanceTimersByTime(300);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe('tr:text1');
    expect(r2).toBe('tr:text2');
    expect(r3).toBe('tr:text3');
    expect(stubTranslator.calls.length).toBe(3);
    expect(stubTranslator.calls.map((c) => c.texts)).toEqual([
      ['text3'],
      ['text1'],
      ['text2'],
    ]);
  });

  test('directTranslate in options flushes early without timer delay', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    const promise = scheduler.translate('instant', 'en', 'de', {
      directTranslate: true,
      context: 'ctx-direct',
    });

    expect(stubTranslator.calls.length).toBe(1);
    expect(stubTranslator.calls[0].texts).toEqual(['instant']);

    const result = await promise;
    expect(result).toBe('tr:instant');
  });

  test('directTranslateLength flushes early when text length meets or exceeds threshold', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(
      stubTranslator,
      { ...defaultConfig, directTranslateLength: 10 },
      onFinalError,
    );

    const promise = scheduler.translate('long text here', 'en', 'de');
    expect(stubTranslator.calls.length).toBe(1);
    expect(stubTranslator.calls[0].texts).toEqual(['long text here']);

    const result = await promise;
    expect(result).toBe('tr:long text here');
  });

  test('chunkSizeForInstantTranslate flushes early when pooled count meets threshold', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(
      stubTranslator,
      { ...defaultConfig, chunkSizeForInstantTranslate: 2 },
      onFinalError,
    );

    const p1 = scheduler.translate('item1', 'en', 'de');
    expect(stubTranslator.calls.length).toBe(0);

    const p2 = scheduler.translate('item2', 'en', 'de');
    expect(stubTranslator.calls.length).toBe(1);
    expect(stubTranslator.calls[0].texts).toEqual(['item1', 'item2']);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('tr:item1');
    expect(r2).toBe('tr:item2');
  });

  test('abort rejects pooled tasks with TranslationAbortedError and future translate for aborted context rejects', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    const p1 = scheduler.translate('hello', 'en', 'es', { context: 'ctx-abort' });

    await scheduler.abort('ctx-abort');

    expect(stubTranslator.abort).toHaveBeenCalledWith('ctx-abort');
    await expect(p1).rejects.toThrow(TranslationAbortedError);

    // Later translate for the same aborted context rejects immediately
    await expect(
      scheduler.translate('world', 'en', 'es', { context: 'ctx-abort' }),
    ).rejects.toThrow(TranslationAbortedError);

    expect(stubTranslator.calls.length).toBe(0);
  });

  test('dispose rejects pooled tasks with TranslationSchedulerReplacedError and is idempotent', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    const p1 = scheduler.translate('hello', 'en', 'es');

    scheduler.dispose();
    scheduler.dispose(); // Idempotent check

    expect(stubTranslator.dispose).toHaveBeenCalledTimes(1);
    await expect(p1).rejects.toThrow(TranslationSchedulerReplacedError);

    // Later translate after dispose rejects immediately
    await expect(scheduler.translate('world', 'en', 'es')).rejects.toThrow(
      TranslationSchedulerReplacedError,
    );
  });

  test('onFinalError is called for non-cancellation failures and not for cancellation errors', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(stubTranslator, defaultConfig, onFinalError);

    // 1. Regular error
    stubTranslator.translateBatchWithOptions.mockRejectedValueOnce(
      new Error('API network failure'),
    );

    const p1 = scheduler.translate('fail1', 'en', 'es', { directTranslate: true });
    await expect(p1).rejects.toThrow('API network failure');
    expect(onFinalError).toHaveBeenCalledTimes(1);
    expect(onFinalError).toHaveBeenCalledWith(expect.any(Error));

    onFinalError.mockClear();

    // 2. TranslationAbortedError
    stubTranslator.translateBatchWithOptions.mockRejectedValueOnce(
      TranslationAbortedError.new(),
    );

    const p2 = scheduler.translate('aborted', 'en', 'es', { directTranslate: true });
    await expect(p2).rejects.toThrow(TranslationAbortedError);
    expect(onFinalError).not.toHaveBeenCalled();

    // 3. TranslationSchedulerReplacedError
    stubTranslator.translateBatchWithOptions.mockRejectedValueOnce(
      TranslationSchedulerReplacedError.new(),
    );

    const p3 = scheduler.translate('replaced', 'en', 'es', { directTranslate: true });
    await expect(p3).rejects.toThrow(TranslationSchedulerReplacedError);
    expect(onFinalError).not.toHaveBeenCalled();
  });
});
