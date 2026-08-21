import { Effect } from 'effect';

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
  sessionSignature: 'signature',
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
    const responses = [
      JSON.stringify({
        translations: [
          { id: 'u1', target: 'Speichern' },
          { id: 'u2', target: 'Nutze den Code.' },
        ],
      }),
      JSON.stringify({
        translations: [{ id: 'u2', target: 'Nutze <x id="code"/>.' }],
      }),
    ];
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
      { retryCount: 0, validationFailures: 1 },
      { retryCount: 1, validationFailures: 0 },
      {
        retryCount: 0,
        validationFailures: 0,
        acceptedProfileId: settings.translationProfile.id,
        acceptedRetryStage: 'isolated',
        failedIds: [],
      },
    ]);
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
