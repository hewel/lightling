import {
  buildTokenAwareBatches,
  calculateSourceBudget,
  OutputRatioTracker,
  type TokenCounter,
} from './batching';
import type { TranslationUnit } from './domPipeline';

const counter: TokenCounter = {
  id: 'test-tokenizer',
  count: (text) => Math.ceil(text.length / 8),
};

const makeUnit = (id: string, sourceText: string): TranslationUnit => ({
  id,
  sourceText,
  normalizedText: sourceText,
  kind: 'body',
  slot: 'visible-text',
  contextClass: 'main:body',
  semanticKey: `key-${id}`,
  priority: 1,
  occurrences: [],
  section: { sectionId: 'section', headingPath: [] },
});

const options = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
  contextWindow: 4096,
  preferredInputTokens: 100,
  pageProfile: {
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
  outputRatio: 1,
  safetyTokens: 32,
  tokenCounter: counter,
};

describe('token-aware page batching', () => {
  test('reserves prompt, memory, schema, safety, and expected output', () => {
    expect(
      calculateSourceBudget({
        contextWindow: 1000,
        promptTokens: 100,
        memoryTokens: 50,
        contextTokens: 50,
        schemaTokens: 100,
        safetyTokens: 100,
        outputRatio: 1,
      }),
    ).toBe(300);
    expect(
      calculateSourceBudget({
        contextWindow: 100,
        promptTokens: 100,
        memoryTokens: 1,
        contextTokens: 0,
        schemaTokens: 0,
        safetyTokens: 0,
        outputRatio: 1,
      }),
    ).toBe(0);
  });

  test('packs structurally supplied units within item and token limits', () => {
    const batches = buildTokenAwareBatches(
      [makeUnit('a', 'Save'), makeUnit('b', 'Cancel'), makeUnit('c', 'Delete')],
      { ...options, maxItems: 2 },
    );
    expect(batches.map((batch) => batch.targets.length)).toEqual([2, 1]);
    expect(batches.every((batch) => batch.sourceTokens <= batch.sourceBudget)).toBe(true);
  });

  test('splits an oversized logical segment only at balanced sentence boundaries', () => {
    const source =
      'First sentence is deliberately long enough. Second sentence is also deliberately long enough.';
    const batches = buildTokenAwareBatches([makeUnit('long', source)], {
      ...options,
      preferredInputTokens: 8,
    });
    const parts = batches.flatMap((batch) => batch.targets);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.target.sourceText).join('')).toBe(source);
    expect(parts.every((part) => part.partCount === parts.length)).toBe(true);
  });

  test('refuses to split through a placeholder span', () => {
    const source = '<g id="inline">A long first sentence. A long second sentence.</g>';
    expect(() =>
      buildTokenAwareBatches([makeUnit('unsafe', source)], {
        ...options,
        preferredInputTokens: 4,
      }),
    ).toThrow(/safe sentence boundary/u);
  });

  test('updates output ratios with a bounded moving average', () => {
    const tracker = new OutputRatioTracker();
    tracker.observe('en', 'ja', 10, 1000);
    expect(tracker.get('en', 'ja')).toBe(3);
    tracker.observe('en', 'ja', 1000, 1);
    expect(tracker.get('en', 'ja')).toBeGreaterThanOrEqual(0.5);
  });
});
