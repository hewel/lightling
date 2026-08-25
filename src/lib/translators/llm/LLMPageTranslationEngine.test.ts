import { Duration, Effect } from 'effect';
import { AiError } from 'effect/unstable/ai';

import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';

import {
  LLMTranslationEngine,
  type LLMRequest,
  type LLMResponse,
} from './LLMTranslationEngine';
import { resolveLLMExecutionSettings } from './modelInfo';
import { llmProviderPresets } from './presets';

const configuredProfile = structuredClone(llmProviderPresets.custom);
configuredProfile.name = 'Test';
configuredProfile.model = 'test-model';
configuredProfile.maxConcurrentRequests = 1;
const settings = resolveLLMExecutionSettings(configuredProfile, null);

const target = (id: string, sourceText: string) => ({
  id,
  sourceText,
  normalizedText: sourceText,
  kind: 'body' as const,
  slot: 'visible-text' as const,
  contextClass: 'main:body',
  semanticKey: id,
  priority: 4,
});

const request: PageTranslationBatchRequest = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
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
  targets: [target('u1', 'Save'), target('u2', 'Use <x id="code"/>.')],
};

describe('LLM webpage request contract', () => {
  test('retries only the unit with placeholder corruption', async () => {
    const calls: LLMRequest[] = [];
    const initialResponse = JSON.stringify({
      translations: [
        { id: 'u1', target: 'Speichern' },
        { id: 'u2', target: 'Nutze den Code.' },
      ],
    });
    const retryResponse = JSON.stringify({
      translations: [{ id: 'u2', target: 'Nutze <x id="code"/>.' }],
    });
    const responses = [initialResponse, retryResponse];
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: (llmRequest) => {
        calls.push(llmRequest);
        const response: LLMResponse = {
          text: responses.shift() ?? '',
          usage: { inputTokens: null, outputTokens: null },
        };
        return Effect.succeed(response);
      },
    });
    const metrics: PageTranslationAttemptMetrics[] = [];

    await expect(
      engine.translatePageBatch(
        request,
        {
          context: 'session',
          priority: 4,
          retryLimit: 0,
          isolateInvalidBatches: true,
        },
        (increment) => metrics.push(increment),
      ),
    ).resolves.toEqual([
      { id: 'u1', target: 'Speichern' },
      { id: 'u2', target: 'Nutze <x id="code"/>.' },
    ]);

    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].messages)).not.toContain('u1');
    expect(JSON.stringify(calls[1].messages)).toContain('u2');
    expect(metrics).toEqual([
      {
        retryCount: 1,
        validationFailures: 1,
        acceptedProfileId: settings.translationProfile.id,
        acceptedRetryStage: 'isolated',
        failedIds: [],
        attempts: [
          {
            kind: 'parse',
            stage: 'initial',
            contextMode: 'normal',
            profileId: settings.translationProfile.id,
            targetIds: ['u1', 'u2'],
            rawResponse: initialResponse,
            issues: [{ id: 'u2', failure: 'placeholder-corruption' }],
          },
          {
            kind: 'parse',
            stage: 'isolated',
            contextMode: 'normal',
            profileId: settings.translationProfile.id,
            targetIds: ['u2'],
            rawResponse: retryResponse,
            issues: [],
          },
        ],
      },
    ]);
  });

  test('accepts an unchanged echo for alt text instead of retrying', async () => {
    const calls: LLMRequest[] = [];
    const echoResponse = JSON.stringify({
      translations: [{ id: 'u1', target: 'Lexx' }],
    });
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: (llmRequest) => {
        calls.push(llmRequest);
        const response: LLMResponse = {
          text: echoResponse,
          usage: { inputTokens: null, outputTokens: null },
        };
        return Effect.succeed(response);
      },
    });

    await expect(
      engine.translatePageBatch(
        {
          ...request,
          targetLanguage: 'zh',
          group: { kind: 'image-alt', slot: 'alt', contextClass: 'main:image-alt' },
          targets: [
            { ...target('u1', 'Lexx'), kind: 'image-alt' as const, slot: 'alt' as const },
          ],
        },
        {
          context: 'session',
          priority: 4,
          retryLimit: 3,
          isolateInvalidBatches: true,
        },
        () => {},
      ),
    ).resolves.toEqual([{ id: 'u1', target: 'Lexx' }]);

    expect(calls).toHaveLength(1);
  });

  test('reassembles placeholder-free fragments after structural retries fail', async () => {
    const calls: LLMRequest[] = [];
    const corruptedResponse = JSON.stringify({
      translations: [{ id: 'u1', target: 'Klicke Speichern mit Code jetzt.' }],
    });
    const fragmentTranslations = [
      { id: 'u1:fragment-1', target: 'Klicke' },
      { id: 'u1:fragment-2', target: 'Speichern' },
      { id: 'u1:fragment-3', target: 'mit' },
      { id: 'u1:fragment-4', target: 'jetzt.' },
    ];
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: (llmRequest) => {
        calls.push(llmRequest);
        const prompt = JSON.stringify(llmRequest.messages);
        let text = corruptedResponse;
        for (const translation of fragmentTranslations) {
          if (!prompt.includes(translation.id)) continue;
          text = JSON.stringify({ translations: [translation] });
        }
        return Effect.succeed({
          text,
          usage: { inputTokens: null, outputTokens: null },
        });
      },
    });
    const metrics: PageTranslationAttemptMetrics[] = [];

    const result = await engine.translatePageBatch(
      {
        ...request,
        targets: [target('u1', 'Click <g id="link">Save</g> with <x id="code"/> now.')],
      },
      {
        context: 'session',
        priority: 4,
        retryLimit: 0,
        isolateInvalidBatches: true,
      },
      (increment) => metrics.push(increment),
    );
    expect(result).toEqual([
      {
        id: 'u1',
        target: 'Klicke <g id="link">Speichern</g> mit <x id="code"/> jetzt.',
      },
    ]);

    expect(calls.length).toBeGreaterThan(2);
    const fragmentedCall = calls.find((call) =>
      JSON.stringify(call.messages).includes('u1:fragment-1'),
    );
    const fragmentedPrompt = JSON.stringify(fragmentedCall?.messages);
    expect(fragmentedPrompt).not.toContain('<x id=');
    expect(fragmentedPrompt).not.toContain('<g id=');
    expect(metrics[0]?.acceptedRetryStage).toBe('fragmented');
    expect(metrics[0]?.failedIds).toEqual([]);
  });

  test('records transport retries in the terminal journal', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const metrics: PageTranslationAttemptMetrics[] = [];
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(settings),
        fetch: () => {
          calls++;
          if (calls === 1) {
            return Effect.fail(
              AiError.make({
                module: 'test',
                method: 'generateText',
                reason: new AiError.RateLimitError({ retryAfter: Duration.millis(50) }),
              }),
            );
          }
          return Effect.succeed({
            text: JSON.stringify({ translations: [{ id: 'u1', target: 'Speichern' }] }),
            usage: { inputTokens: null, outputTokens: null },
          });
        },
      });
      const promise = engine.translatePageBatch(
        { ...request, targets: [request.targets[0]] },
        {
          context: 'session',
          priority: 4,
          retryLimit: 1,
          isolateInvalidBatches: true,
        },
        (terminal) => metrics.push(terminal),
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(promise).resolves.toEqual([{ id: 'u1', target: 'Speichern' }]);
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        retryCount: 1,
        validationFailures: 0,
        attempts: [
          {
            kind: 'transport-retry',
            stage: 'initial',
            targetIds: ['u1'],
            attemptNumber: 2,
            httpStatus: 429,
            retryAfterMs: 50,
          },
          {
            kind: 'parse',
            stage: 'initial',
            targetIds: ['u1'],
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('emits terminal metrics before exhausted provider failures', async () => {
    vi.useFakeTimers();
    try {
      const metrics: PageTranslationAttemptMetrics[] = [];
      const engine = new LLMTranslationEngine({
        loadSettings: () => Promise.resolve(settings),
        fetch: () =>
          Effect.fail(
            AiError.make({
              module: 'test',
              method: 'generateText',
              reason: new AiError.RateLimitError({ retryAfter: Duration.millis(50) }),
            }),
          ),
      });
      const promise = engine.translatePageBatch(
        { ...request, targets: [request.targets[0]] },
        {
          context: 'session',
          priority: 4,
          retryLimit: 1,
          isolateInvalidBatches: true,
        },
        (terminal) => metrics.push(terminal),
      );
      const settled = promise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      await expect(settled).resolves.toBeInstanceOf(Error);
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        failedIds: ['u1'],
        attempts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'transport-retry',
            httpStatus: 429,
            retryAfterMs: 50,
          }),
          expect.objectContaining({
            kind: 'parse',
            httpStatus: 429,
            retryAfterMs: 50,
          }),
        ]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('repairs renamed placeholder ids without a retry', async () => {
    const calls: LLMRequest[] = [];
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: (llmRequest) => {
        calls.push(llmRequest);
        const response: LLMResponse = {
          text: JSON.stringify({
            translations: [
              { id: 'u1', target: 'Speichern' },
              { id: 'u2', target: 'Nutze <x id="wrong"/>.' },
            ],
          }),
          usage: { inputTokens: null, outputTokens: null },
        };
        return Effect.succeed(response);
      },
    });

    await expect(
      engine.translatePageBatch(request, {
        context: 'session',
        priority: 4,
        retryLimit: 0,
        isolateInvalidBatches: true,
      }),
    ).resolves.toEqual([
      { id: 'u1', target: 'Speichern' },
      { id: 'u2', target: 'Nutze <x id="code"/>.' },
    ]);
    expect(calls).toHaveLength(1);
  });

  test('accepts preserved named entities without an isolated retry', async () => {
    let calls = 0;
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: () => {
        calls++;
        return Effect.succeed({
          text: JSON.stringify({
            translations: [{ id: 'brand', target: 'Noctalia' }],
          }),
          usage: { inputTokens: null, outputTokens: null },
        });
      },
    });
    const namedEntityRequest: PageTranslationBatchRequest = {
      ...request,
      targetLanguage: 'zh',
      memory: { ...request.memory, namedEntities: ['Noctalia'] },
      targets: [target('brand', 'Noctalia')],
    };

    await expect(
      engine.translatePageBatch(namedEntityRequest, {
        context: 'session',
        priority: 4,
        retryLimit: 0,
        isolateInvalidBatches: true,
      }),
    ).resolves.toEqual([{ id: 'brand', target: 'Noctalia' }]);
    expect(calls).toBe(1);
  });

  test('returns accepted targets when another target exhausts retries', async () => {
    const responses = [
      JSON.stringify({
        translations: [
          { id: 'u1', target: 'Speichern' },
          { id: 'u2', target: 'Nutze den Code.' },
        ],
      }),
      'invalid',
      'invalid',
      'invalid',
    ];
    const metrics: PageTranslationAttemptMetrics[] = [];
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(settings),
      fetch: () =>
        Effect.succeed({
          text: responses.shift() ?? '',
          usage: { inputTokens: null, outputTokens: null },
        }),
    });

    await expect(
      engine.translatePageBatch(
        request,
        {
          context: 'session',
          priority: 4,
          retryLimit: 0,
          isolateInvalidBatches: true,
        },
        (increment) => metrics.push(increment),
      ),
    ).resolves.toEqual([{ id: 'u1', target: 'Speichern' }]);
    expect(metrics.at(-1)).toMatchObject({ failedIds: ['u2'] });
  });

  test('maps order-based array responses and runs isolated retries in parallel', async () => {
    const arrayProfile = structuredClone(llmProviderPresets.custom);
    arrayProfile.name = 'Test';
    arrayProfile.model = 'test-model';
    arrayProfile.maxConcurrentRequests = 2;
    arrayProfile.qualityMode = 'fast';
    const arraySettings = resolveLLMExecutionSettings(arrayProfile, null);
    const arrayRequest: PageTranslationBatchRequest = {
      ...request,
      targets: [target('u1', 'Alpha'), target('u2', 'Beta')],
    };

    const calls: LLMRequest[] = [];
    let retriesStarted = 0;
    let openBarrier!: () => void;
    // Opens only when both isolated-retry fibers are in flight; if the
    // engine ever runs them sequentially the barrier never opens and the
    // test fails on its timeout instead of passing silently.
    const barrier = new Promise<void>((resolve) => {
      openBarrier = resolve;
    });
    const engine = new LLMTranslationEngine({
      loadSettings: () => Promise.resolve(arraySettings),
      fetch: (llmRequest) => {
        calls.push(llmRequest);
        if (calls.length === 1) {
          // Initial batch: both units come back empty and fail validation.
          return Effect.succeed({
            text: JSON.stringify({ translations: ['', ''] }),
            usage: { inputTokens: null, outputTokens: null },
          });
        }
        const body = JSON.stringify(llmRequest.messages);
        return Effect.promise(async () => {
          retriesStarted += 1;
          if (retriesStarted === 2) openBarrier();
          await barrier;
          return {
            text: JSON.stringify({
              translations: [body.includes('Alpha') ? '一' : '二'],
            }),
            usage: { inputTokens: null, outputTokens: null },
          };
        });
      },
    });

    await expect(
      engine.translatePageBatch(arrayRequest, {
        context: 'session',
        priority: 4,
        retryLimit: 0,
        isolateInvalidBatches: true,
      }),
    ).resolves.toEqual([
      { id: 'u1', target: '一' },
      { id: 'u2', target: '二' },
    ]);
    // 1 batch attempt + 2 isolated retries; the barrier opening proves the
    // retries overlapped.
    expect(calls).toHaveLength(3);
    expect(retriesStarted).toBe(2);
    // Array shape keeps unit ids off the wire.
    for (const call of calls) {
      expect(JSON.stringify(call.messages)).not.toContain('u1');
      expect(JSON.stringify(call.messages)).not.toContain('u2');
    }
  });
});
