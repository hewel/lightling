import { saveFile } from '@/lib/files';
import {
  PAGE_TRANSLATION_LOG_SCHEMA_VERSION,
  type PageTranslationLog,
} from '@/lib/pageTranslation/log';

import { exportPageTranslationLogFile } from './exportPageTranslationLog';

vi.mock('@/lib/files', () => ({ saveFile: vi.fn() }));

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
    occurrences: 0,
    logicalSegments: 0,
    uniqueUnits: 0,
    deduplicationRatio: 0,
    memoryHits: 0,
    memoryMisses: 0,
    sourceTokens: 0,
    contextTokens: 0,
    batches: 0,
    retries: 0,
    validationFailures: 0,
    staleCancellations: 0,
    terminologyConflicts: 0,
    startedAt: 1,
  },
  batches: [],
  droppedBatches: 0,
};

describe('exportPageTranslationLogFile', () => {
  test('downloads stable pretty JSON with a sanitized filename', async () => {
    exportPageTranslationLogFile(
      log,
      'example.com / settings',
      new Date('2026-08-21T10:20:30.456Z'),
    );

    expect(saveFile).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(saveFile).mock.calls[0];
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual(log);
    expect(await blob.text()).toContain('\n  "schemaVersion"');
    expect(filename).toBe(
      'lightling-page-translation-log_example.com_settings_2026-08-21T10-20-30-456Z.json',
    );
  });
});
