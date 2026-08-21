import { Duration, Effect } from 'effect';
import { AiError } from 'effect/unstable/ai';

import {
  FRAMING_TOKENS,
  getLLMCacheId,
  getUtf8ByteLength,
  isContextLengthExceeded,
  LLMTranslationEngine,
  LLM_TRANSLATION_PROMPT_VERSION,
  MAX_BATCH_ITEMS,
  parseLLMResponse,
  SYSTEM_PROMPT,
  TranslationAbortedError,
  TranslationSchedulerReplacedError,
  type LLMRequest,
  type LLMRequestEffect,
  type LLMResponse,
} from './LLMTranslationEngine';
import {
  createConservativeTranslationModelProfile,
  TRANSLATION_MODEL_PROFILE_VERSION,
  TRANSLATION_PAGE_PROMPT_VERSION,
} from './modelProfile';
import { conservativeTokenCounter } from './tokenizer';

const makeResponse = (text: string): LLMResponse => ({
  text,
  usage: { inputTokens: null, outputTokens: null },
});

const makeSettings = (
  overrides: Partial<{
    contextWindowTokens: number;
    preferredInputTokens: number;
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
    maxConcurrentRequests: number;
    supportedParameters: readonly string[] | null;
  }> = {},
) => {
  const base = {
    contextWindowTokens: 4096,
    contextWindowSource: 'fallback' as const,
    preferredInputTokens: 1200,
    preferredInputSource: 'fallback' as const,
    maxInputTokens: null as number | null,
    maxInputSource: null as 'provider' | null,
    maxOutputTokens: null as number | null,
    maxOutputSource: null as 'override' | 'provider' | 'known-model' | null,
    maxConcurrentRequests: 2,
    concurrencySource: 'fallback' as const,
    supportedParameters: null as readonly string[] | null,
    ...overrides,
  };
  const profile = createConservativeTranslationModelProfile('test-model');
  return {
    ...base,
    translationProfile: {
      ...profile,
      contextWindow: base.contextWindowTokens,
      safetyReserveTokens: 64,
      schemaReserveTokens: 32,
      ...(base.maxOutputTokens === null
        ? {}
        : { maximumOutputTokens: base.maxOutputTokens }),
      batching: {
        ...profile.batching,
        maxItems: MAX_BATCH_ITEMS,
        preferredSourceTokens: base.preferredInputTokens,
        maxSourceTokens: base.preferredInputTokens,
        concurrency: base.maxConcurrentRequests,
      },
    },
    tokenCounter: conservativeTokenCounter,
    profileWarnings: [],
  };
};

const makeAiError = (reason: AiError.AiErrorReason): AiError.AiError =>
  AiError.make({ module: 'test', method: 'generateText', reason });

const makeRetryableError = (): AiError.AiError =>
  makeAiError(new AiError.RateLimitError({ retryAfter: Duration.millis(50) }));

const makeAuthError = (): AiError.AiError =>
  makeAiError(new AiError.AuthenticationError({ kind: 'InvalidKey' }));

const makeContextLengthError = (): AiError.AiError =>
  makeAiError(
    new AiError.InvalidRequestError({
      description: 'context_length_exceeded',
    }),
  );

const successResponse = (texts: string[]): LLMRequestEffect =>
  Effect.succeed(makeResponse(JSON.stringify(texts)));

/**
 * Echo handler: returns one translation per requested item, prefixed, so the
 * caller always gets a valid response matching the batch count.
 */
const userMessageOf = (request: LLMRequest): string => {
  // RawInput may be an iterable of messages; the second message carries texts
  const messages = Array.from(request.messages as Iterable<{ content: string }>).map(
    (message) => message.content,
  );
  return messages.at(-1) ?? '';
};

/**
 * Echo handler: returns one translation per requested item, prefixed, so the
 * caller always gets a valid response matching the batch count.
 */
const echoingFetch =
  (prefix = 'tr:') =>
  (requests: LLMRequest[]) =>
  (request: LLMRequest): LLMRequestEffect => {
    requests.push(request);
    const match = userMessageOf(request).match(/Texts: (.*)$/);
    const texts: string[] = match ? JSON.parse(match[1]) : [];
    return successResponse(texts.map((text) => `${prefix}${text}`));
  };

const batchOptions = (
  overrides: Partial<{
    context: string;
    priority: number;
    retryLimit: number;
    isolateInvalidBatches: boolean;
  }> = {},
) => ({
  context: 'ctx',
  priority: 0,
  retryLimit: 0,
  isolateInvalidBatches: true,
  ...overrides,
});

const createEngine = (fetch: (request: LLMRequest) => LLMRequestEffect) =>
  new LLMTranslationEngine({
    loadSettings: () => Promise.resolve(makeSettings()),
    fetch,
  });

const textsOf = (request: LLMRequest): string[] => {
  const match = userMessageOf(request).match(/Texts: (.*)$/);
  return match ? (JSON.parse(match[1]) as string[]) : [];
};

const createDeferred = <T>() => {
  const deferred = {} as {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
  };
  deferred.promise = new Promise<T>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
};

/**
 * Flushes settings resolution plus the deferred pump dispatch. The pump runs
 * one macrotask after settings resolve, so two macrotask hops are required
 * before the first provider call can be observed.
 */
const flushDispatch = () =>
  new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));

/** One macrotask hop: enough for promise continuations after a resolve. */
const microtasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('LLMTranslationEngine', () => {
  describe('getLLMCacheId', () => {
    test('includes prompt version, provider, URL, and model but not name or key', () => {
      const id = getLLMCacheId({
        provider: 'openai-compatible',
        apiUrl: 'https://llm.example/v1',
        model: 'test-model',
      });

      expect(JSON.parse(id)).toEqual([
        'LLMTranslator',
        LLM_TRANSLATION_PROMPT_VERSION,
        TRANSLATION_MODEL_PROFILE_VERSION,
        TRANSLATION_PAGE_PROMPT_VERSION,
        'openai-compatible',
        'https://llm.example/v1',
        'test-model',
        null,
        null,
        null,
        null,
      ]);
    });

    test('differentiates delimiter collisions', () => {
      const a = getLLMCacheId({
        provider: 'a","b' as never,
        apiUrl: 'https://x.test',
        model: 'x',
      });
      const b = getLLMCacheId({
        provider: 'a' as never,
        apiUrl: 'b","https://x.test',
        model: 'x',
      });
      expect(a).not.toBe(b);
    });

    test('empty URL equals explicit provider default URL', () => {
      const empty = getLLMCacheId({
        provider: 'openai',
        apiUrl: '',
        model: 'gpt-4o-mini',
      });
      const explicit = getLLMCacheId({
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      });
      expect(empty).toBe(explicit);
    });

    test('renaming or rotating the key keeps identity; changing model does not', () => {
      const base = getLLMCacheId({
        provider: 'openai-compatible',
        apiUrl: 'https://api.ant-ling.com/v1',
        model: 'Ling-3.0-flash',
      });
      expect(base).toBe(
        getLLMCacheId({
          provider: 'openai-compatible',
          apiUrl: 'https://api.ant-ling.com/v1/',
          model: 'Ling-3.0-flash',
        }),
      );
      expect(base).not.toBe(
        getLLMCacheId({
          provider: 'openai-compatible',
          apiUrl: 'https://api.ant-ling.com/v1',
          model: 'Ling-3.0-tiny',
        }),
      );
    });
  });

  describe('prompt and output parsing', () => {
    test('uses the fixed system prompt and JSON source/target user message', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      await engine.translateBatch(['Hello'], 'en', 'es', batchOptions());

      expect(requests).toHaveLength(1);
      const prompt = requests[0].messages as Iterable<{ role: string; content: string }>;
      const messages = Array.from(prompt);
      expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
      expect(messages[1].content).toContain('Source: English');
      expect(messages[1].content).toContain('Target: Spanish');
      expect(messages[1].content).toContain('["Hello"]');
    });

    test('renders auto source as auto-detect', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      await engine.translateBatch(['Hello'], 'auto', 'es', batchOptions());

      expect(userMessageOf(requests[0])).toContain('Source: auto-detect');
    });

    test('parses a plain JSON array', () => {
      expect(parseLLMResponse('["a","b"]', 2)).toEqual(['a', 'b']);
    });

    test('parses a fenced JSON array', () => {
      expect(parseLLMResponse('```json\n["a","b"]\n```', 2)).toEqual(['a', 'b']);
    });

    test('rejects a response with wrong count', () => {
      expect(parseLLMResponse('["a","b"]', 3)).toBeNull();
    });

    test('rejects non-string array members', () => {
      expect(parseLLMResponse('["a",1]', 2)).toBeNull();
    });

    test('never extracts JSON from arbitrary prose', () => {
      expect(parseLLMResponse('Sure! Here you go: ["a"]', 1)).toBeNull();
    });
  });

  describe('budget and batching', () => {
    test('empty input resolves to empty array', async () => {
      const engine = createEngine(() => successResponse([]));
      const result = await engine.translateBatch([], 'en', 'es', batchOptions());
      expect(result).toEqual([]);
    });

    test('empty-string entries resolve without requests and preserve indexes', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      const result = await engine.translateBatch(
        ['a', '', 'b', ''],
        'en',
        'es',
        batchOptions(),
      );

      expect(result).toEqual(['tr:a', '', 'tr:b', '']);
      // Both non-empty items fit one request; empty strings are never sent
      expect(requests).toHaveLength(1);
      expect(textsOf(requests[0])).toEqual(['a', 'b']);
    });

    test('under a 512-token context each request fits budget and provider caps', async () => {
      const requests: LLMRequest[] = [];
      const settings = makeSettings({
        contextWindowTokens: 512,
        preferredInputTokens: 200,
        maxInputTokens: 300,
        maxOutputTokens: 256,
      });
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(settings),
        fetch: echoingFetch()(requests),
      });

      const result = await engine.translateBatch(
        ['short one', 'another short', 'a'.repeat(500)],
        'en',
        'es',
        batchOptions(),
      );

      expect(result[0]).toBe('tr:short one');
      expect(result[1]).toBe('tr:another short');
      expect(result[2]).toContain('tr:');

      const usableContext =
        settings.translationProfile.contextWindow -
        settings.translationProfile.safetyReserveTokens -
        settings.translationProfile.schemaReserveTokens;
      expect(requests.length).toBeGreaterThanOrEqual(2);
      for (const request of requests) {
        const texts = textsOf(request);
        expect(texts.length).toBeLessThanOrEqual(MAX_BATCH_ITEMS);

        const textsEst = texts.reduce(
          (sum, text) => sum + Math.ceil(getUtf8ByteLength(JSON.stringify(text)) / 3),
          0,
        );
        const textsUpper = texts.reduce(
          (sum, text) => sum + getUtf8ByteLength(JSON.stringify(text)),
          0,
        );
        const framingBytes = getUtf8ByteLength(
          userMessageOf(request).split('Texts: ')[0],
        );
        const baseEst =
          Math.ceil((getUtf8ByteLength(SYSTEM_PROMPT) + framingBytes) / 3) +
          FRAMING_TOKENS;

        // Estimated and conservative upper-bound checks include the dynamic output reserve.
        expect(baseEst + textsEst + request.maxOutputTokens).toBeLessThanOrEqual(
          usableContext,
        );
        expect(baseEst + textsUpper + request.maxOutputTokens).toBeLessThanOrEqual(
          usableContext,
        );
        // Provider input cap on both measures
        expect(baseEst + textsEst).toBeLessThanOrEqual(settings.maxInputTokens as number);
        expect(baseEst + textsUpper).toBeLessThanOrEqual(
          settings.maxInputTokens as number,
        );
        // Output reserve capped by the profile cap
        expect(request.maxOutputTokens).toBeLessThanOrEqual(256);
      }
    });

    test('enforces the 12-item batch limit', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      const texts = Array.from({ length: 15 }, (_, i) => `item-${i}`);
      const result = await engine.translateBatch(texts, 'en', 'es', batchOptions());

      expect(result).toEqual(texts.map((text) => `tr:${text}`));
      expect(requests.length).toBeGreaterThanOrEqual(2);
      for (const request of requests) {
        expect(textsOf(request).length).toBeLessThanOrEqual(MAX_BATCH_ITEMS);
      }
    });

    test('splits oversized strings and reassembles pieces in order', async () => {
      const requests: LLMRequest[] = [];
      const engine = new LLMTranslationEngine({
        loadSettings: () =>
          Promise.resolve(
            makeSettings({
              contextWindowTokens: 512,
              preferredInputTokens: 10,
            }),
          ),
        fetch: echoingFetch('')(requests),
      });

      const longText = 'Alpha. Bravo. Charlie. Delta. Echo. Foxtrot.';
      const result = await engine.translateBatch([longText], 'en', 'es', batchOptions());

      expect(requests.length).toBeGreaterThan(1);
      const joined = result[0];
      expect(joined.indexOf('Alpha.')).toBeLessThan(joined.indexOf('Bravo.'));
      expect(joined.indexOf('Bravo.')).toBeLessThan(joined.indexOf('Charlie.'));
      expect(joined.indexOf('Echo.')).toBeLessThan(joined.indexOf('Foxtrot.'));
      expect(joined.replace(/\. /g, ' ').replace(/\./g, '')).toBe(
        longText.replace(/\./g, ''),
      );
    });

    test('throws when a single code point cannot fit', async () => {
      const engine = new LLMTranslationEngine({
        loadSettings: () =>
          Promise.resolve(
            makeSettings({
              contextWindowTokens: 64,
              preferredInputTokens: 10,
              maxOutputTokens: 16,
            }),
          ),
        fetch: () => successResponse(['never called']),
      });

      await expect(
        engine.translateBatch(['🔥'], 'en', 'es', batchOptions()),
      ).rejects.toThrow('LLM context window is too small for the translation prompt');
    });
  });

  describe('multi-line texts', () => {
    test('translates each line as a separate newline-free item and rejoins', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      const result = await engine.translateBatch(
        ['Omitting most sections.\nA notable exception is'],
        'en',
        'es',
        batchOptions(),
      );

      expect(result).toEqual(['tr:Omitting most sections.\ntr:A notable exception is']);
      expect(requests).toHaveLength(1);
      expect(textsOf(requests[0])).toEqual([
        'Omitting most sections.',
        'A notable exception is',
      ]);
      // No item sent to the provider contains a line separator
      for (const request of requests) {
        for (const text of textsOf(request)) {
          expect(text).not.toMatch(/\r|\n/);
        }
      }
    });

    test('preserves empty lines and CRLF separators', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      const result = await engine.translateBatch(
        ['a\r\n\r\nb'],
        'en',
        'es',
        batchOptions(),
      );

      expect(result).toEqual(['tr:a\r\n\r\ntr:b']);
      expect(textsOf(requests[0])).toEqual(['a', 'b']);
    });

    test('separator-only texts resolve without requests', async () => {
      const requests: LLMRequest[] = [];
      const engine = createEngine(echoingFetch()(requests));

      const result = await engine.translateBatch(['\n\n'], 'en', 'es', batchOptions());

      expect(result).toEqual(['\n\n']);
      expect(requests).toHaveLength(0);
    });
  });

  describe('retry policy', () => {
    test('retryLimit 0 makes exactly one attempt', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        return Effect.fail(makeRetryableError());
      });

      await expect(
        engine.translateBatch(['Hello'], 'en', 'es', batchOptions()),
      ).rejects.toBeDefined();
      expect(attempts).toBe(1);
    });

    test('retryLimit 2 makes at most three attempts on retryable errors', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        const engine = createEngine(() => {
          attempts++;
          return Effect.fail(makeRetryableError());
        });

        const promise = engine.translateBatch(['Hello'], 'en', 'es', {
          ...batchOptions(),
          retryLimit: 2,
        });

        const settled = promise.catch((error: unknown) => error);
        // Initial attempt + two retries with 50ms retryAfter delays
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(settled).resolves.toBeInstanceOf(Error);
        expect(attempts).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    test('retry succeeds when a later attempt works', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        const engine = createEngine(() => {
          attempts++;
          return attempts < 3
            ? Effect.fail(makeRetryableError())
            : successResponse(['Hola']);
        });

        const promise = engine.translateBatch(['Hello'], 'en', 'es', {
          ...batchOptions(),
          retryLimit: 2,
        });
        await vi.advanceTimersByTimeAsync(60_000);

        await expect(promise).resolves.toEqual(['Hola']);
        expect(attempts).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    test('does not retry authentication errors', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        return Effect.fail(makeAuthError());
      });

      await expect(
        engine.translateBatch(['Hello'], 'en', 'es', {
          ...batchOptions(),
          retryLimit: 2,
        }),
      ).rejects.toBeDefined();
      expect(attempts).toBe(1);
    });

    test('treats context length errors as planning feedback, not retries', async () => {
      let attempts = 0;
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings()),
        fetch: () => {
          attempts++;
          return Effect.fail(makeContextLengthError());
        },
      });

      await expect(
        engine.translateBatch(['a', 'b'], 'en', 'es', batchOptions()),
      ).rejects.toBeDefined();

      // One parent attempt, then strict-smaller one-item children (no retry
      // loop around the provider error itself)
      expect(attempts).toBe(3);
    });

    test('context length failure of an unsplit one-code-point item rejects with the original error', async () => {
      let attempts = 0;
      const error = makeContextLengthError();
      const engine = createEngine(() => {
        attempts++;
        return Effect.fail(error);
      });

      await expect(
        engine.translateBatch(['🔥'], 'en', 'es', batchOptions()),
      ).rejects.toBe(error);
      expect(attempts).toBe(1);
    });
  });

  describe('usage reporting', () => {
    test('reports token usage for each successful request', async () => {
      const onUsage = vi.fn();
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings()),
        fetch: () =>
          Effect.succeed({
            text: JSON.stringify(['tr:a', 'tr:b']),
            usage: { inputTokens: 10, outputTokens: 5 },
          }),
        onUsage,
      });

      await expect(
        engine.translateBatch(['a', 'b'], 'en', 'de', batchOptions()),
      ).resolves.toEqual(['tr:a', 'tr:b']);
      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 });
    });

    test('does not report usage for failed requests', async () => {
      const onUsage = vi.fn();
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings()),
        fetch: () => Effect.fail(makeRetryableError()),
        onUsage,
      });

      await expect(
        engine.translateBatch(['a'], 'en', 'de', batchOptions()),
      ).rejects.toBeDefined();
      expect(onUsage).not.toHaveBeenCalled();
    });

    test('skips zero-only usage reports from providers that omit usage', async () => {
      const onUsage = vi.fn();
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings()),
        fetch: () => Effect.succeed(makeResponse(JSON.stringify(['tr:a']))),
        onUsage,
      });

      await expect(
        engine.translateBatch(['a'], 'en', 'de', batchOptions()),
      ).resolves.toEqual(['tr:a']);
      expect(onUsage).not.toHaveBeenCalled();
    });
  });

  describe('invalid output recovery', () => {
    test('bisects a malformed multi-item batch when isolation is enabled', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        // Never a valid JSON array, even for a one-item batch
        return Effect.succeed(makeResponse('not json'));
      });

      await expect(
        engine.translateBatch(['a', 'b'], 'en', 'es', batchOptions()),
      ).rejects.toBeDefined();

      // Initial 2-item batch fails to parse; each one-item child makes its
      // first attempt plus one correction attempt
      expect(attempts).toBe(5);
    });

    test('releases the slot so bisect children run before lower-priority work', async () => {
      const startOrder: string[][] = [];
      const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();
      const getKey = (texts: string[]) => JSON.stringify(texts);

      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 1 })),
        fetch: (request) => {
          const texts = textsOf(request);
          startOrder.push(texts);
          const key = getKey(texts);
          const deferred = createDeferred<string>();
          deferreds.set(key, deferred);
          return Effect.promise(() => deferred.promise).pipe(Effect.map(makeResponse));
        },
      });

      const low3 = engine.translateBatch(['low3'], 'en', 'es', batchOptions());
      const high = engine.translateBatch(['h1', 'h2'], 'en', 'es', {
        ...batchOptions(),
        priority: 10,
      });
      await flushDispatch();

      // High priority starts first despite arriving second
      expect(startOrder).toEqual([['h1', 'h2']]);

      // Malformed high-priority output: release the slot and bisect
      deferreds.get(getKey(['h1', 'h2']))?.resolve('not json at all');
      await microtasks();

      // Children inherit priority 10 and start before the waiting priority-0 job
      deferreds.get(getKey(['h1']))?.resolve(JSON.stringify(['tr:h1']));
      await microtasks();
      deferreds.get(getKey(['h2']))?.resolve(JSON.stringify(['tr:h2']));
      await microtasks();
      deferreds.get(getKey(['low3']))?.resolve(JSON.stringify(['tr:low3']));

      await expect(high).resolves.toEqual(['tr:h1', 'tr:h2']);
      await expect(low3).resolves.toEqual(['tr:low3']);

      expect(startOrder).toEqual([['h1', 'h2'], ['h1'], ['h2'], ['low3']]);
    });

    test('malformed single item attempts one correction then fails with InvalidLLMResponseError', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        return Effect.succeed(makeResponse('not json'));
      });

      await expect(
        engine.translateBatch(['a'], 'en', 'es', batchOptions()),
      ).rejects.toThrow('Invalid response from LLM');
      expect(attempts).toBe(2);
    });

    test('two invalid one-item responses end as InvalidLLMResponseError without network retry', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        return Effect.succeed(makeResponse('still not json'));
      });

      await expect(
        engine.translateBatch(['a'], 'en', 'es', { ...batchOptions(), retryLimit: 3 }),
      ).rejects.toThrow('Invalid response from LLM');
      // Exactly the first attempt and one correction; no retries
      expect(attempts).toBe(2);
    });

    test('a valid correction recovers the single item', async () => {
      let attempts = 0;
      const engine = createEngine(() => {
        attempts++;
        return attempts === 1
          ? Effect.succeed(makeResponse('prose instead of json'))
          : successResponse(['recovered']);
      });

      await expect(
        engine.translateBatch(['a'], 'en', 'es', batchOptions()),
      ).resolves.toEqual(['recovered']);
      expect(attempts).toBe(2);
    });
  });

  describe('concurrency and priority', () => {
    test('runs at most two concurrent requests and preserves result order', async () => {
      const active = new Set<string>();
      let maxActive = 0;
      const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();

      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 2 })),
        fetch: (request) => {
          const [key] = textsOf(request);
          active.add(key);
          maxActive = Math.max(maxActive, active.size);
          const deferred = createDeferred<string>();
          deferreds.set(key, deferred);
          return Effect.promise(() => deferred.promise).pipe(
            Effect.map(makeResponse),
            Effect.tap(() => Effect.sync(() => active.delete(key))),
          );
        },
      });

      const promises = ['a', 'b', 'c', 'd', 'e'].map((text) =>
        engine.translateBatch([text], 'en', 'es', batchOptions()),
      );
      await flushDispatch();

      expect(maxActive).toBe(2);
      expect([...active].sort()).toEqual(['a', 'b']);

      deferreds.get('a')?.resolve(JSON.stringify(['tr:a']));
      deferreds.get('b')?.resolve(JSON.stringify(['tr:b']));
      await microtasks();

      expect(maxActive).toBe(2);

      deferreds.get('c')?.resolve(JSON.stringify(['tr:c']));
      deferreds.get('d')?.resolve(JSON.stringify(['tr:d']));
      await microtasks();

      deferreds.get('e')?.resolve(JSON.stringify(['tr:e']));

      const results = await Promise.all(promises);
      expect(results.map((result) => result[0])).toEqual([
        'tr:a',
        'tr:b',
        'tr:c',
        'tr:d',
        'tr:e',
      ]);
    });

    test('higher numeric priority starts before lower priority', async () => {
      const startOrder: string[] = [];
      const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();

      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 1 })),
        fetch: (request) => {
          const [key] = textsOf(request);
          startOrder.push(key);
          const deferred = createDeferred<string>();
          deferreds.set(key, deferred);
          return Effect.promise(() => deferred.promise).pipe(Effect.map(makeResponse));
        },
      });

      const low = engine.translateBatch(['low'], 'en', 'es', batchOptions());
      const high = engine.translateBatch(['high'], 'en', 'es', {
        ...batchOptions(),
        priority: 5,
      });
      await flushDispatch();

      // Both jobs queue up before dispatch: the higher numeric priority
      // starts first even though it arrived later
      expect(startOrder).toEqual(['high']);

      deferreds.get('high')?.resolve(JSON.stringify(['tr:high']));
      await microtasks();
      expect(startOrder).toEqual(['high', 'low']);

      deferreds.get('low')?.resolve(JSON.stringify(['tr:low']));

      await expect(Promise.all([low, high])).resolves.toEqual([['tr:low'], ['tr:high']]);
    });

    test('a higher-priority job queued before the low one starts next', async () => {
      const startOrder: string[] = [];
      const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();

      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 1 })),
        fetch: (request) => {
          const [key] = textsOf(request);
          startOrder.push(key);
          const deferred = createDeferred<string>();
          deferreds.set(key, deferred);
          return Effect.promise(() => deferred.promise).pipe(Effect.map(makeResponse));
        },
      });

      const blocker = engine.translateBatch(['blocker'], 'en', 'es', batchOptions());
      await flushDispatch();

      const low = engine.translateBatch(['low'], 'en', 'es', batchOptions());
      const high = engine.translateBatch(['high'], 'en', 'es', {
        ...batchOptions(),
        priority: 5,
      });
      await microtasks();

      deferreds.get('blocker')?.resolve(JSON.stringify(['tr:blocker']));
      await microtasks();

      // High priority overtakes the earlier low-priority job
      expect(startOrder).toEqual(['blocker', 'high']);

      deferreds.get('high')?.resolve(JSON.stringify(['tr:high']));
      await microtasks();
      deferreds.get('low')?.resolve(JSON.stringify(['tr:low']));

      await expect(Promise.all([blocker, low, high])).resolves.toEqual([
        ['tr:blocker'],
        ['tr:low'],
        ['tr:high'],
      ]);
    });
  });

  describe('cancellation', () => {
    test('abort during settings loading prevents translation calls', async () => {
      let fetchCalled = false;
      const settingsDeferred = createDeferred<ReturnType<typeof makeSettings>>();

      const engine = new LLMTranslationEngine({
        loadSettings: () => settingsDeferred.promise,
        fetch: () => {
          fetchCalled = true;
          return successResponse(['x']);
        },
      });

      const context = 'cancelled-ctx';
      const promise = engine.translateBatch(['Hello'], 'en', 'es', {
        ...batchOptions(),
        context,
      });

      await microtasks();
      engine.abort(context);
      settingsDeferred.resolve(makeSettings());

      await expect(promise).rejects.toBeInstanceOf(TranslationAbortedError);
      expect(fetchCalled).toBe(false);
    });

    test('shared settings discovery still completes for other contexts', async () => {
      const settingsDeferred = createDeferred<ReturnType<typeof makeSettings>>();
      const requests: LLMRequest[] = [];

      const engine = new LLMTranslationEngine({
        loadSettings: () => settingsDeferred.promise,
        fetch: echoingFetch()(requests),
      });

      const aborted = engine.translateBatch(['gone'], 'en', 'es', {
        ...batchOptions(),
        context: 'aborted',
      });
      const surviving = engine.translateBatch(['stay'], 'en', 'es', {
        ...batchOptions(),
        context: 'surviving',
      });

      await microtasks();
      engine.abort('aborted');
      settingsDeferred.resolve(makeSettings());

      await expect(aborted).rejects.toBeInstanceOf(TranslationAbortedError);
      await expect(surviving).resolves.toEqual(['tr:stay']);
    });

    test('abort rejects queued and active work of the context only', async () => {
      const deferreds = new Map<string, ReturnType<typeof createDeferred<string>>>();

      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 1 })),
        fetch: (request) => {
          const [key] = textsOf(request);
          const deferred = createDeferred<string>();
          deferreds.set(key, deferred);
          return Effect.promise(() => deferred.promise).pipe(Effect.map(makeResponse));
        },
      });

      const active = engine.translateBatch(['page-A-1'], 'en', 'es', {
        ...batchOptions(),
        context: 'page-A',
      });
      const queued = engine.translateBatch(['page-A-2'], 'en', 'es', {
        ...batchOptions(),
        context: 'page-A',
      });
      const other = engine.translateBatch(['page-B'], 'en', 'es', {
        ...batchOptions(),
        context: 'page-B',
      });
      await flushDispatch();

      engine.abort('page-A');

      await expect(active).rejects.toBeInstanceOf(TranslationAbortedError);
      await expect(queued).rejects.toBeInstanceOf(TranslationAbortedError);

      deferreds.get('page-B')?.resolve(JSON.stringify(['tr:page-B']));
      await expect(other).resolves.toEqual(['tr:page-B']);
    });

    test('dispose rejects pending and future work', async () => {
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(makeSettings({ maxConcurrentRequests: 1 })),
        fetch: () => {
          const deferred = createDeferred<string>();
          return Effect.promise(() => deferred.promise).pipe(Effect.map(makeResponse));
        },
      });

      const pending = engine.translateBatch(['Hello'], 'en', 'es', batchOptions());
      await microtasks();

      engine.dispose();

      await expect(pending).rejects.toBeInstanceOf(TranslationSchedulerReplacedError);
      await expect(
        engine.translateBatch(['Hello'], 'en', 'es', {
          ...batchOptions(),
          context: 'ctx2',
        }),
      ).rejects.toBeInstanceOf(TranslationSchedulerReplacedError);
    });
  });

  describe('context length detection', () => {
    test('detects context_length_exceeded literal', () => {
      expect(isContextLengthExceeded(makeContextLengthError())).toBe(true);
    });

    test('detects max_tokens_exceeded literal', () => {
      expect(
        isContextLengthExceeded(
          makeAiError(
            new AiError.InvalidRequestError({ description: 'max_tokens_exceeded' }),
          ),
        ),
      ).toBe(true);
    });

    test('detects token_limit_exceeded in the error body', () => {
      expect(isContextLengthExceeded(new Error('token_limit_exceeded'))).toBe(true);
    });
  });

  describe('UTF-8 byte length', () => {
    test('counts ASCII as one byte per char', () => {
      expect(getUtf8ByteLength('abc')).toBe(3);
    });

    test('counts two-byte code points correctly', () => {
      expect(getUtf8ByteLength('ééé')).toBe(6);
    });

    test('counts surrogate pairs as four bytes', () => {
      expect(getUtf8ByteLength('🔥🔥')).toBe(8);
    });
  });
});
