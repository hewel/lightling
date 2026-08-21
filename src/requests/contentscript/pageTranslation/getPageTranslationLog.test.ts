import {
  PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
  type PageTranslationLog,
} from '@/lib/pageTranslation/log';

import { readPageTranslationLog } from './getPageTranslationLog';

const log: PageTranslationLog = {
  schemaVersion: PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
  exportedAt: 2,
  session: {
    id: 'session',
    signature: 'signature',
    url: 'https://example.com/',
    documentTitle: 'Example',
    sourceLanguage: 'en',
    targetLanguage: 'de',
    provider: 'openai',
    model: 'small-model',
    startedAt: 1,
  },
  pageProfile: {
    languageDirection: 'auto',
    glossary: [],
    protectedTerms: [],
    namedEntities: [],
  },
  metrics: {
    occurrences: 1,
    logicalSegments: 1,
    uniqueUnits: 1,
    deduplicationRatio: 0,
    memoryHits: 0,
    memoryMisses: 1,
    sourceTokens: 1,
    contextTokens: 1,
    batches: 1,
    retries: 0,
    validationFailures: 0,
    staleCancellations: 0,
    terminologyConflicts: 0,
    startedAt: 1,
  },
  batches: [],
  droppedBatches: 0,
};

describe('readPageTranslationLog', () => {
  test('returns the active opt-in log and rejects when no log is available', async () => {
    const getTranslationLog = vi.fn(async (): Promise<PageTranslationLog | null> => log);
    const context = {
      getDOMTranslator: () => ({ getTranslationLog }),
    };

    await expect(readPageTranslationLog(context)).resolves.toEqual(log);
    getTranslationLog.mockResolvedValueOnce(null);
    await expect(readPageTranslationLog(context)).rejects.toThrow(
      'Page translation log export is not enabled',
    );
  });
});
