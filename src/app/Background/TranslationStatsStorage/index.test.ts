import browser from 'webextension-polyfill';

import { clearAllMocks } from '@/lib/tests';

import { TranslationStatsStorage } from '.';

beforeEach(clearAllMocks);

test('defaults to zeros when storage is empty', async () => {
  const storage = new TranslationStatsStorage();

  await expect(storage.getStats()).resolves.toEqual({
    translationsCount: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
  });
});

test('accumulates translations and LLM usage', async () => {
  const storage = new TranslationStatsStorage();

  await storage.addTranslation();
  await storage.addTranslation();
  await storage.addLLMUsage({ inputTokens: 10, outputTokens: 5 });
  await storage.addLLMUsage({ inputTokens: 3, outputTokens: 7 });

  await expect(storage.getStats()).resolves.toEqual({
    translationsCount: 2,
    llmInputTokens: 13,
    llmOutputTokens: 12,
  });
});

test('concurrent increments all land on the exact sum', async () => {
  const storage = new TranslationStatsStorage();

  await Promise.all(
    Array.from({ length: 10 }, () => [
      storage.addTranslation(),
      storage.addLLMUsage({ inputTokens: 2, outputTokens: 1 }),
    ]).flat(),
  );

  await expect(storage.getStats()).resolves.toEqual({
    translationsCount: 10,
    llmInputTokens: 20,
    llmOutputTokens: 10,
  });
});

test('reset returns counters to zero', async () => {
  const storage = new TranslationStatsStorage();

  await storage.addTranslation();
  await storage.addLLMUsage({ inputTokens: 10, outputTokens: 5 });
  await storage.reset();

  await expect(storage.getStats()).resolves.toEqual({
    translationsCount: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
  });
});

test('corrupt stored value falls back to defaults', async () => {
  await browser.storage.local.set({
    TranslationStatsStorage: { translationsCount: 'x' },
  });

  const storage = new TranslationStatsStorage();

  await expect(storage.getStats()).resolves.toEqual({
    translationsCount: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
  });
});
