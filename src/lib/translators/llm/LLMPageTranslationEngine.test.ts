import { Effect } from 'effect';

import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import {
  LLMTranslationEngine,
  type LLMRequest,
  type LLMResponse,
} from './LLMTranslationEngine';

const settings = {
  contextWindowTokens: 4096,
  contextWindowSource: 'fallback' as const,
  preferredInputTokens: 1200,
  preferredInputSource: 'fallback' as const,
  maxInputTokens: null,
  maxInputSource: null,
  maxOutputTokens: null,
  maxOutputSource: null,
  maxConcurrentRequests: 1,
  concurrencySource: 'fallback' as const,
  supportedParameters: null,
};

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
          { id: 'u2', target: 'Nutze <x id="wrong"/>.' },
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
    const metrics: { retryCount: number; validationFailures: number }[] = [];

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
    expect(JSON.stringify(calls[1].prompt)).not.toContain('u1');
    expect(JSON.stringify(calls[1].prompt)).toContain('u2');
    expect(metrics).toEqual([
      { retryCount: 0, validationFailures: 1 },
      { retryCount: 1, validationFailures: 0 },
    ]);
  });
});
