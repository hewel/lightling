import { OutputRatioTracker } from '@/lib/translators/llm/budget';
import { createConservativeTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import type { TranslationTokenCounter } from '@/lib/translators/llm/tokenizer';

import {
  buildTokenAwareBatches,
  calculateSourceBudget,
  DEFAULT_LANE_BATCH_CAPS,
} from './batching';
import type { TranslationUnit } from './domPipeline';
import { TranslationPriorityLane } from './priorityLanes';

const counter: TranslationTokenCounter = {
  id: 'test-tokenizer',
  accuracy: 'exact',
  count: (text) => Math.ceil(text.length / 8),
};

const makeUnit = (
  id: string,
  sourceText: string,
  lane: TranslationPriorityLane = TranslationPriorityLane.Rest,
): TranslationUnit => ({
  id,
  sourceText,
  normalizedText: sourceText,
  kind: 'body',
  slot: 'visible-text',
  contextClass: 'main:body',
  semanticKey: `key-${id}`,
  priority: 1,
  lane,
  distanceToViewport: 0,
  documentOrder: 0,
  occurrences: [],
  section: { sectionId: 'section', headingPath: [] },
});

const modelProfile = createConservativeTranslationModelProfile('test-model');

const options = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
  modelProfile,
  tokenCounter: counter,
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
      {
        ...options,
        modelProfile: {
          ...modelProfile,
          batching: { ...modelProfile.batching, maxItems: 2 },
        },
      },
    );
    expect(batches.map((batch) => batch.targets.length)).toEqual([2, 1]);
    expect(batches.every((batch) => batch.sourceTokens <= batch.sourceBudget)).toBe(true);
  });
  test('clamps Urgent and Visible lanes to the default batch limits', () => {
    for (const lane of [
      TranslationPriorityLane.Urgent,
      TranslationPriorityLane.Visible,
    ]) {
      const batches = buildTokenAwareBatches(
        Array.from({ length: 17 }, (_, index) =>
          makeUnit(`${lane}-${index}`, `Unit ${index}`, lane),
        ),
        {
          ...options,
          laneBatchCaps: DEFAULT_LANE_BATCH_CAPS,
        },
      );

      expect(batches.map((batch) => batch.targets.length)).toEqual([16, 1]);
      expect(batches.every((batch) => batch.sourceBudget === 1000)).toBe(true);
    }
  });

  test('keeps Near and Rest lanes at the existing model sizing', () => {
    const units = [
      makeUnit('foreground', 'Foreground unit', TranslationPriorityLane.Visible),
      ...Array.from({ length: 40 }, (_, index) =>
        makeUnit(
          `background-${index}`,
          `Background unit ${index}`,
          index < 20 ? TranslationPriorityLane.Near : TranslationPriorityLane.Rest,
        ),
      ),
    ];
    const batches = buildTokenAwareBatches(units, {
      ...options,
      laneBatchCaps: DEFAULT_LANE_BATCH_CAPS,
    });

    expect(batches.map((batch) => batch.targets.length)).toEqual([1, 40]);
    expect(batches.map((batch) => batch.sourceBudget)).toEqual([
      1000,
      modelProfile.batching.preferredSourceTokens,
    ]);
  });

  test('never raises a smaller model or controller allowance to a lane cap', () => {
    const batches = buildTokenAwareBatches(
      Array.from({ length: 9 }, (_, index) =>
        makeUnit(
          `visible-${index}`,
          `Visible unit ${index}`,
          TranslationPriorityLane.Visible,
        ),
      ),
      {
        ...options,
        modelProfile: {
          ...modelProfile,
          batching: { ...modelProfile.batching, maxItems: 8 },
        },
        preferredSourceTokens: 600,
        laneBatchCaps: DEFAULT_LANE_BATCH_CAPS,
      },
    );

    expect(batches.map((batch) => batch.targets.length)).toEqual([8, 1]);
    expect(batches.every((batch) => batch.sourceBudget === 600)).toBe(true);
  });

  test('splits an oversized logical segment only at balanced sentence boundaries', () => {
    const source =
      'First sentence is deliberately long enough. Second sentence is also deliberately long enough.';
    const batches = buildTokenAwareBatches([makeUnit('long', source)], {
      ...options,
      preferredSourceTokens: 8,
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
        preferredSourceTokens: 4,
      }),
    ).toThrow(/safe sentence boundary/u);
  });

  test('keeps wire targets plain and structured-cloneable', () => {
    // Firefox structured-clones extension messages; any DOM/non-cloneable
    // reference leaking from the unit into target breaks every batch with
    // DataCloneError.
    const unit = {
      ...makeUnit('dom', 'First sentence here. Second sentence here.'),
      occurrences: [{ nonCloneable: () => undefined }],
      section: { sectionId: 'section', headingPath: [], nonCloneable: () => undefined },
    } as unknown as TranslationUnit;
    const batches = buildTokenAwareBatches([unit], {
      ...options,
      preferredSourceTokens: 4,
    });
    const parts = batches.flatMap((batch) => batch.targets);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.target).not.toHaveProperty('occurrences');
      expect(part.target).not.toHaveProperty('section');
      expect(() => structuredClone(part.target)).not.toThrow();
    }
  });

  test('updates output ratios with a bounded moving average', () => {
    const tracker = new OutputRatioTracker();
    tracker.observe(modelProfile.id, 'en', 'ja', 'body', 10, 1000);
    expect(tracker.get(modelProfile, 'en', 'ja', 'body')).toBe(3);
    tracker.observe(modelProfile.id, 'en', 'ja', 'body', 1000, 1);
    expect(tracker.get(modelProfile, 'en', 'ja', 'body')).toBeGreaterThanOrEqual(0.5);
  });
});
