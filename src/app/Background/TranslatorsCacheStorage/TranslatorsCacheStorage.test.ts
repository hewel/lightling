import { clearAllMocks } from '@/lib/tests';
import { getLLMCacheId } from '@/lib/translators/llm/LLMTranslationEngine';

import { TranslatorsCacheStorage } from '.';
beforeEach(clearAllMocks);

const testData = Array(10)
  .fill(null)
  .map((_, id) => ({
    from: 'en',
    to: 'de',
    originalText: 'original text ' + id,
    translatedText: 'translated text ' + id,
  }));

test('TranslatorsCacheStorage test', async () => {
  const cacheStorage = new TranslatorsCacheStorage('test-translator');

  // Write data
  for (const translationData of testData) {
    await cacheStorage.set(
      translationData.originalText,
      translationData.translatedText,
      translationData.from,
      translationData.to,
    );
  }

  // Test data persistence
  for (const translationData of testData) {
    const translatedText = await cacheStorage.get(
      translationData.originalText,
      translationData.from,
      translationData.to,
    );
    expect(translatedText).toBe(translationData.translatedText);
  }

  // Test after clear
  await cacheStorage.clear();

  const translationSample = testData[0];
  const translatedText = await cacheStorage.get(
    translationSample.originalText,
    translationSample.from,
    translationSample.to,
  );
  expect(translatedText).toBe(null);
});

describe('TranslatorsCacheStorage options', () => {
  test('TranslatorsCacheStorage with enabled `ignoreCase`', async () => {
    const translationSample = testData[0];
    const cacheStorage = new TranslatorsCacheStorage('test-translator', {
      ignoreCase: true,
    });

    // Write data
    await cacheStorage.set(
      translationSample.originalText,
      translationSample.translatedText,
      translationSample.from,
      translationSample.to,
    );

    const translatedTextForOriginalCase = await cacheStorage.get(
      translationSample.originalText,
      translationSample.from,
      translationSample.to,
    );
    expect(translatedTextForOriginalCase).toBe(translationSample.translatedText);

    const translatedTextForUpperCase = await cacheStorage.get(
      translationSample.originalText.toUpperCase(),
      translationSample.from,
      translationSample.to,
    );
    expect(translatedTextForUpperCase).toBe(translationSample.translatedText);
  });

  test('TranslatorsCacheStorage with disabled `ignoreCase`', async () => {
    const translationSample = testData[0];
    const cacheStorage = new TranslatorsCacheStorage('test-translator', {
      ignoreCase: false,
    });

    // Write data
    await cacheStorage.set(
      translationSample.originalText,
      translationSample.translatedText,
      translationSample.from,
      translationSample.to,
    );

    const translatedTextForOriginalCase = await cacheStorage.get(
      translationSample.originalText,
      translationSample.from,
      translationSample.to,
    );
    expect(translatedTextForOriginalCase).toBe(translationSample.translatedText);

    const translatedTextForUpperCase = await cacheStorage.get(
      translationSample.originalText.toUpperCase(),
      translationSample.from,
      translationSample.to,
    );
    expect(translatedTextForUpperCase).toBe(null);
  });
});

describe('multiple cache instances', () => {
  test('parallel use multiple cache instances', async () => {
    const cache1 = new TranslatorsCacheStorage('cache1');
    const cache2 = new TranslatorsCacheStorage('cache2');

    const dataSample1 = testData[0];
    const dataSample2 = testData[1];

    // Const write data
    await cache1.set(
      dataSample1.originalText,
      dataSample1.translatedText,
      dataSample1.from,
      dataSample1.to,
    );
    await cache2.set(
      dataSample2.originalText,
      dataSample2.translatedText,
      dataSample2.from,
      dataSample2.to,
    );

    // Test cached data
    const translatedText1 = await cache1.get(
      dataSample1.originalText,
      dataSample1.from,
      dataSample1.to,
    );
    expect(translatedText1).toBe(dataSample1.translatedText);

    const translatedText2 = await cache2.get(
      dataSample2.originalText,
      dataSample2.from,
      dataSample2.to,
    );
    expect(translatedText2).toBe(dataSample2.translatedText);

    // Test data independency
    await cache1.clear();
    await cache1
      .get(dataSample1.originalText, dataSample1.from, dataSample1.to)
      .then((translatedText) => {
        expect(translatedText).toBe(null);
      });

    await cache2
      .get(dataSample2.originalText, dataSample2.from, dataSample2.to)
      .then((translatedText) => {
        expect(translatedText).toBe(dataSample2.translatedText);
      });

    // Clear another stores
    const translatorNames = ['foo', 'bar', 'baz'];
    for (const translatorName of translatorNames) {
      const cacheToClean = new TranslatorsCacheStorage(translatorName);
      await cacheToClean.clear();
    }

    // Test data keep persistent
    await cache2
      .get(dataSample2.originalText, dataSample2.from, dataSample2.to)
      .then((translatedText) => {
        expect(translatedText).toBe(dataSample2.translatedText);
      });
  });
});

describe('TranslatorsCacheStorage.clearAll', () => {
  test('clearAll deletes all translator cache stores', async () => {
    const storeA = new TranslatorsCacheStorage('store-A');
    const storeB = new TranslatorsCacheStorage('store-B');

    await storeA.set('hello', 'hallo', 'en', 'de');
    await storeB.set('cat', 'Katze', 'en', 'de');

    expect(await storeA.get('hello', 'en', 'de')).toBe('hallo');
    expect(await storeB.get('cat', 'en', 'de')).toBe('Katze');

    await TranslatorsCacheStorage.clearAll();

    const freshA = new TranslatorsCacheStorage('store-A');
    const freshB = new TranslatorsCacheStorage('store-B');

    expect(await freshA.get('hello', 'en', 'de')).toBe(null);
    expect(await freshB.get('cat', 'en', 'de')).toBe(null);
  });
});

describe('LLM cache identity with TranslatorsCacheStorage', () => {
  test('two profiles differing only in model produce different cache stores with isolated data', async () => {
    const profileModelA = {
      provider: 'openai-compatible' as const,
      apiUrl: 'https://api.example.com/v1',
      model: 'model-a',
    };
    const profileModelB = {
      provider: 'openai-compatible' as const,
      apiUrl: 'https://api.example.com/v1',
      model: 'model-b',
    };

    const idA = getLLMCacheId(profileModelA);
    const idB = getLLMCacheId(profileModelB);

    expect(idA).not.toBe(idB);

    const storeA = new TranslatorsCacheStorage(idA);
    const storeB = new TranslatorsCacheStorage(idB);

    await storeA.set('hello', 'hallo-from-A', 'en', 'de');

    expect(await storeA.get('hello', 'en', 'de')).toBe('hallo-from-A');
    expect(await storeB.get('hello', 'en', 'de')).toBe(null);
  });

  test('renaming a profile or rotating apiKey keeps the same cache id', () => {
    const profileOriginal = {
      name: 'Original Name',
      apiKey: 'key-123',
      provider: 'openai-compatible' as const,
      apiUrl: 'https://api.example.com/v1',
      model: 'model-a',
    };
    const profileRenamed = {
      name: 'New Custom Name',
      apiKey: 'key-456-rotated',
      provider: 'openai-compatible' as const,
      apiUrl: 'https://api.example.com/v1',
      model: 'model-a',
    };

    const id1 = getLLMCacheId(profileOriginal);
    const id2 = getLLMCacheId(profileRenamed);

    expect(id1).toBe(id2);
  });
});
