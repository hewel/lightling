import type {
  PageTranslationBatchRequest,
  TranslationTarget,
} from '@/lib/pageTranslation/protocol';

import {
  budgetPageTranslationRequest,
  estimateMaxOutputTokens,
  OutputRatioTracker,
} from './budget';
import { resolveTranslationModelProfile } from './modelProfile';
import { llmProviderPresets } from './presets';
import type { TranslationTokenCounter } from './tokenizer';

const counter: TranslationTokenCounter = {
  id: 'word-counter',
  accuracy: 'exact',
  count: (text) => Math.max(1, Math.ceil(text.length / 8)),
};

const profile = (() => {
  const configured = structuredClone(llmProviderPresets.openai);
  configured.contextWindowTokens = 800;
  configured.translationProfile.safetyReserveTokens = 64;
  configured.translationProfile.schemaReserveTokens = 32;
  configured.translationProfile.batching.maxContextTokens = 80;
  configured.translationProfile.batching.maxMemoryTokens = 20;
  configured.translationProfile.batching.maxSourceTokens = 120;
  return resolveTranslationModelProfile(configured, null).profile;
})();

const target: TranslationTarget = {
  id: 'u1',
  sourceText: 'Save the repository.',
  normalizedText: 'Save the repository.',
  kind: 'body',
  slot: 'visible-text',
  contextClass: 'technical-documentation',
  semanticKey: 'u1',
  priority: 1,
};

const request: PageTranslationBatchRequest = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
  sessionId: 'session',
  sessionSignature: 'signature',
  memory: {
    pageTitle: 'Repository settings page with a deliberately long descriptive title',
    pageType: 'technical documentation settings reference',
    languageDirection: 'en>de',
    glossary: [
      ['repository', 'Repository'],
      ['unrelated terminology entry', 'Unrelated'],
    ],
    protectedTerms: ['repository', 'UnrelatedProduct'],
    namedEntities: ['RepositoryProduct', 'UnrelatedEntity'],
  },
  section: {
    sectionId: 'settings',
    headingPath: ['Settings', 'Repository'],
    summary: 'A deliberately verbose section summary '.repeat(12),
  },
  context: {
    headingPath: ['Settings', 'Repository'],
    previous: [
      { source: 'Old previous context '.repeat(10) },
      { source: 'Recent previous context '.repeat(10) },
    ],
    following: [{ source: 'Following context '.repeat(12) }],
    retrieved: [
      { source: 'Most relevant retrieved context '.repeat(10) },
      { source: 'Least relevant retrieved context '.repeat(10) },
    ],
  },
  group: {
    kind: 'body',
    slot: 'visible-text',
    contextClass: 'technical-documentation',
  },
  targets: [target],
};

describe('translation token budgeting', () => {
  test('calculates dynamic output limits from source and structure', () => {
    expect(
      estimateMaxOutputTokens({
        sourceTokens: 100,
        itemCount: 3,
        placeholderCount: 2,
        outputRatio: 1.5,
        perItemOverhead: 10,
        perPlaceholderOverhead: 4,
        schemaOverhead: 20,
        availableOutputTokens: 500,
        modelMaximumOutputTokens: 400,
      }),
    ).toBe(208);
    expect(
      estimateMaxOutputTokens({
        sourceTokens: 1000,
        itemCount: 20,
        placeholderCount: 0,
        outputRatio: 2,
        perItemOverhead: 10,
        perPlaceholderOverhead: 0,
        schemaOverhead: 50,
        availableOutputTokens: 300,
        modelMaximumOutputTokens: 250,
      }),
    ).toBe(250);
  });

  test('reduces context in deterministic priority order and keeps relevant glossary', () => {
    const budgeted = budgetPageTranslationRequest(request, profile, counter, 1.2);
    const order = [
      'retrieved-context',
      'following-context',
      'previous-context',
      'section-summary',
      'page-memory',
    ];
    const positions = budgeted.reductions.map((reduction) => order.indexOf(reduction));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(budgeted.request.memory.glossary).toContainEqual(['repository', 'Repository']);
    expect(budgeted.request.memory.glossary).not.toContainEqual([
      'unrelated terminology entry',
      'Unrelated',
    ]);
    expect(budgeted.budget.reservedOutputTokens).toBeGreaterThanOrEqual(64);
  });

  test('tracks output ratios independently by profile, language direction, and content class', () => {
    const tracker = new OutputRatioTracker();
    tracker.observe(profile.id, 'en', 'de', 'short-ui', 100, 50);
    tracker.observe(profile.id, 'en', 'ja', 'body-prose', 100, 300);

    expect(tracker.get(profile, 'en', 'de', 'short-ui')).toBe(0.5);
    expect(tracker.get(profile, 'en', 'ja', 'body-prose')).toBe(3);
    expect(tracker.get(profile, 'en', 'de', 'body-prose')).toBe(1.35);
  });
});
