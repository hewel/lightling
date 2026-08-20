import { clearAllMocks } from '@/lib/tests';

import { TranslatorsCacheStorage } from '.';
import { TranslatorsCacheStorageMigration } from './TranslatorsCacheStorage.migrations';

describe('TranslatorsCacheStorage migrations', () => {
  beforeEach(clearAllMocks);

  test('migration from v3 to v4 deletes translatorsCache database and clears stored data', async () => {
    const store = new TranslatorsCacheStorage('test-translator-module');

    // Seed data into cache
    await store.set('hello', 'hallo', 'en', 'de');
    await store.set('world', 'Welt', 'en', 'de');

    // Verify data exists
    expect(await store.get('hello', 'en', 'de')).toBe('hallo');
    expect(await store.get('world', 'en', 'de')).toBe('Welt');

    // Run migration v3 -> v4
    await TranslatorsCacheStorageMigration.migrate(3, 4);

    // Verify cache storage is empty / misses
    const freshStore = new TranslatorsCacheStorage('test-translator-module');
    expect(await freshStore.get('hello', 'en', 'de')).toBe(null);
    expect(await freshStore.get('world', 'en', 'de')).toBe(null);
  });
});
