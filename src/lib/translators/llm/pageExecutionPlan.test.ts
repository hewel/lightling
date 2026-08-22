import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';

import {
  planNext,
  type PageExecutionPlanAttempt,
  type PageExecutionPlanPolicy,
} from './pageExecutionPlan';

const target = (id: string) => ({
  id,
  sourceText: id,
  normalizedText: id,
  kind: 'body' as const,
  slot: 'visible-text' as const,
  contextClass: 'body',
  semanticKey: id,
  priority: 1,
});

const request = (ids: string[]): PageTranslationBatchRequest =>
  ({
    sourceLanguage: 'en',
    targetLanguage: 'de',
    sessionId: 'session',
    memory: {
      languageDirection: 'en>de',
      glossary: [],
      protectedTerms: [],
      namedEntities: [],
    },
    context: { headingPath: [], previous: [], following: [], retrieved: [] },
    group: { kind: 'body', slot: 'visible-text', contextClass: 'body' },
    targets: ids.map(target),
  }) as PageTranslationBatchRequest;

const policy: PageExecutionPlanPolicy = {
  maxRetries: 3,
  retryWithSmallerBatch: true,
  retryWithoutRetrievedContext: true,
  retryWithRicherLocalContext: true,
};

const attempt = (
  targetIds: string[],
  stage: PageExecutionPlanAttempt['stage'],
  extra: Partial<PageExecutionPlanAttempt> = {},
): PageExecutionPlanAttempt => ({
  targetIds,
  stage,
  contextMode: stage === 'simplified-context' ? 'without-retrieved' : 'normal',
  ...extra,
});

describe('page execution plan', () => {
  test('stops after two consecutive empty responses', () => {
    const first = attempt(['a'], 'initial', { rawResponse: '  ' });
    const second = attempt(['a'], 'isolated', { rawResponse: '' });

    expect(planNext(request(['a']), [first, second], policy)).toEqual({
      kind: 'terminal',
      reason: 'incompatible-model',
    });
  });

  test('allows one empty-response retry without walking the full ladder', () => {
    const first = attempt(['a'], 'initial', { rawResponse: '' });
    const retry = planNext(request(['a']), [first], policy);
    expect(retry).toMatchObject({ kind: 'attempt', stage: 'isolated' });

    const nonEmptyFailure = attempt(['a'], 'isolated', {
      rawResponse: 'not json',
      issues: [{ failure: 'invalid-json' }],
    });
    expect(planNext(request(['a']), [first, nonEmptyFailure], policy)).toEqual({
      kind: 'terminal',
      reason: 'exhausted',
    });
  });

  test('isolates placeholder corruption once before structural fallback', () => {
    const history = [
      attempt(['a'], 'initial', {
        issues: [{ id: 'a', failure: 'placeholder-corruption' }],
        translations: [],
      }),
    ];
    expect(planNext(request(['a']), history, policy)).toMatchObject({
      kind: 'attempt',
      stage: 'isolated',
    });
    history.push(
      attempt(['a'], 'isolated', {
        issues: [{ id: 'a', failure: 'placeholder-corruption' }],
        translations: [],
      }),
    );
    expect(planNext(request(['a']), history, policy)).toEqual({
      kind: 'terminal',
      reason: 'exhausted',
    });
  });

  test('selects retry stages independently for target issue kinds', () => {
    const history = [
      attempt(['a', 'b'], 'initial', {
        issues: [
          { id: 'a', failure: 'language-mismatch' },
          { id: 'b', failure: 'placeholder-corruption' },
        ],
        translations: [],
      }),
    ];
    const first = planNext(request(['a', 'b']), history, policy);
    expect(first).toMatchObject({
      kind: 'attempt',
      stage: 'rich-context',
      targets: [target('a')],
    });
    history.push(
      attempt(['a'], 'rich-context', {
        issues: [{ id: 'a', failure: 'language-mismatch' }],
        translations: [],
      }),
    );
    const second = planNext(request(['a', 'b']), history, policy);
    expect(second).toMatchObject({
      kind: 'attempt',
      stage: 'isolated',
      targets: [target('b')],
    });
  });
  test('groups only compatible stages for parallel retries', () => {
    const history = [
      attempt(['a', 'b'], 'initial', {
        issues: [
          { id: 'a', failure: 'language-mismatch' },
          { id: 'b', failure: 'placeholder-corruption' },
        ],
        translations: [],
      }),
    ];
    const first = planNext(request(['a', 'b']), history, policy);
    expect(first).toMatchObject({
      kind: 'attempt',
      stage: 'rich-context',
      targets: [target('a')],
    });
  });

  test('returns every target sharing the first retry stage', () => {
    const history = [
      attempt(['a', 'b'], 'initial', {
        issues: [
          { id: 'a', failure: 'placeholder-corruption' },
          { id: 'b', failure: 'placeholder-corruption' },
        ],
        translations: [],
      }),
    ];
    expect(planNext(request(['a', 'b']), history, policy)).toMatchObject({
      kind: 'attempt',
      stage: 'isolated',
      targets: [target('a'), target('b')],
    });
  });

  test('bounds ladder stages by maxRetries', () => {
    const bounded = { ...policy, maxRetries: 1 };
    const history = [
      attempt(['a'], 'initial', {
        issues: [{ id: 'a', failure: 'placeholder-corruption' }],
        translations: [],
      }),
      attempt(['a'], 'isolated', {
        issues: [{ id: 'a', failure: 'placeholder-corruption' }],
        translations: [],
      }),
    ];
    expect(planNext(request(['a']), history, bounded)).toEqual({
      kind: 'terminal',
      reason: 'exhausted',
    });
  });

  test('starts language mismatch on rich-context', () => {
    const history = [
      attempt(['a'], 'initial', {
        issues: [{ id: 'a', failure: 'language-mismatch' }],
        translations: [],
      }),
    ];
    expect(planNext(request(['a']), history, policy)).toMatchObject({
      kind: 'attempt',
      stage: 'rich-context',
      contextMode: 'rich',
    });
  });
});
