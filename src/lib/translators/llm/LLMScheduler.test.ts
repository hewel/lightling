import { LLMScheduler, type LLMSchedulerConfig } from './LLMScheduler';
import {
  TranslationAbortedError,
  TranslationSchedulerReplacedError,
  type TranslateBatchOptions,
} from './LLMTranslationEngine';
import type { LLMTranslator } from './LLMTranslator';

class StubLLMTranslator {
  calls: Array<{
    texts: string[];
    from: string;
    to: string;
    options: TranslateBatchOptions;
  }> = [];
  abortedContexts: string[] = [];
  disposed = false;

  translateBatchWithOptions = vi.fn(
    async (
      texts: string[],
      from: string,
      to: string,
      options: TranslateBatchOptions,
    ): Promise<string[]> => {
      this.calls.push({ texts, from, to, options });
      return texts.map((t) => `tr:${t}`);
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
  isAllowDirectTranslateBadChunks: true,
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
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
        isolateInvalidBatches: true,
      },
    });
  });

  test('differing priority or context prevents pooling', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
      ['text1'],
      ['text2'],
      ['text3'],
    ]);
  });

  test('directTranslate in options flushes early without timer delay', async () => {
    const stubTranslator = new StubLLMTranslator();
    const onFinalError = vi.fn();
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
      stubTranslator as unknown as LLMTranslator,
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
      stubTranslator as unknown as LLMTranslator,
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
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
    const scheduler = new LLMScheduler(
      stubTranslator as unknown as LLMTranslator,
      defaultConfig,
      onFinalError,
    );

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
      new TranslationAbortedError(),
    );

    const p2 = scheduler.translate('aborted', 'en', 'es', { directTranslate: true });
    await expect(p2).rejects.toThrow(TranslationAbortedError);
    expect(onFinalError).not.toHaveBeenCalled();

    // 3. TranslationSchedulerReplacedError
    stubTranslator.translateBatchWithOptions.mockRejectedValueOnce(
      new TranslationSchedulerReplacedError(),
    );

    const p3 = scheduler.translate('replaced', 'en', 'es', { directTranslate: true });
    await expect(p3).rejects.toThrow(TranslationSchedulerReplacedError);
    expect(onFinalError).not.toHaveBeenCalled();
  });
});
