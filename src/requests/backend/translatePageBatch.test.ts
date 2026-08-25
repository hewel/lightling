import type { PageTranslationBatchRequest } from '@/lib/pageTranslation/protocol';
import { TranslationAbortedError } from '@/lib/translators/llm/LLMTranslationEngine';

import { translatePageBatch, translatePageBatchFactory } from './translatePageBatch';

const request: PageTranslationBatchRequest = {
  sourceLanguage: 'en',
  targetLanguage: 'de',
  sessionId: 'session-1',
  memory: {
    languageDirection: 'ltr',
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
  group: {
    kind: 'body',
    slot: 'visible-text',
    contextClass: 'body',
  },
  targets: [
    {
      id: 'target-1',
      sourceText: 'Save',
      normalizedText: 'Save',
      kind: 'body',
      slot: 'visible-text',
      contextClass: 'body',
      semanticKey: 'target-1',
      priority: 1,
    },
  ],
};

describe('translatePageBatch request boundary', () => {
  test('resolves provider failures with structured failure and metrics', async () => {
    const cleanup = translatePageBatchFactory({
      config: {} as never,
      backgroundContext: {
        getTranslateManager: async () => ({
          translatePageBatch: async () => {
            throw new Error('provider exhausted');
          },
        }),
        getTranslationAccounting: () => ({ recordTranslation: vi.fn() }),
      } as never,
    });

    try {
      await expect(translatePageBatch(request)).resolves.toEqual({
        translations: [],
        metrics: {
          retryCount: 0,
          validationFailures: 0,
          failedIds: ['target-1'],
          attempts: [],
        },
        failure: { name: 'Error', message: 'provider exhausted' },
      });
    } finally {
      cleanup();
    }
  });
  test('preserves structured provenance through the request boundary', async () => {
    const recordTranslation = vi.fn();
    const cleanup = translatePageBatchFactory({
      config: {} as never,
      backgroundContext: {
        getTranslateManager: async () => ({
          translatePageBatch: async () => ({
            translations: [
              {
                id: 'target-1',
                target: 'Speichern',
                cacheKey: 'target-1',
                cacheHit: false,
                provenance: 'provider',
              },
            ],
          }),
        }),
        getTranslationAccounting: () => ({ recordTranslation }),
      } as never,
    });

    try {
      await expect(translatePageBatch(request)).resolves.toEqual({
        translations: [
          {
            id: 'target-1',
            target: 'Speichern',
            cacheKey: 'target-1',
            cacheHit: false,
            provenance: 'provider',
          },
        ],
      });
      expect(recordTranslation).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('keeps cancellation as a rejected request', async () => {
    const cleanup = translatePageBatchFactory({
      config: {} as never,
      backgroundContext: {
        getTranslateManager: async () => ({
          translatePageBatch: async () => {
            throw TranslationAbortedError.new();
          },
        }),
      } as never,
    });

    try {
      await expect(translatePageBatch(request)).rejects.toBeInstanceOf(
        TranslationAbortedError,
      );
    } finally {
      cleanup();
    }
  });
});
