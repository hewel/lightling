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
      },
    ]);
  });
});
