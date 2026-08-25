import type { MockInstance } from 'vitest';
import browser from 'webextension-polyfill';

import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';

import { TranslationBudgetStorage } from '.';

const firstSnapshot: BudgetSnapshot = {
  concurrency: 2,
  batchSourceTokens: 600,
  budgetTokens: 3000,
};

const secondSnapshot: BudgetSnapshot = {
  concurrency: 3,
  batchSourceTokens: 700,
  budgetTokens: 4000,
};

describe('TranslationBudgetStorage', () => {
  let values: Map<string, unknown>;
  let getSpy: MockInstance<typeof browser.storage.local.get>;
  let setSpy: MockInstance<typeof browser.storage.local.set>;

  beforeEach(() => {
    values = new Map();
    getSpy = vi.spyOn(browser.storage.local, 'get').mockImplementation(async (key) => {
      const name = typeof key === 'string' ? key : '';
      return { [name]: values.get(name) };
    });
    setSpy = vi.spyOn(browser.storage.local, 'set').mockImplementation(async (items) => {
      Object.entries(items).forEach(([key, value]) => values.set(key, value));
    });
  });

  afterEach(() => {
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  test('does not let an older invocation overwrite a newer timestamp', async () => {
    const firstWrite = Promise.withResolvers<void>();
    setSpy.mockImplementationOnce(async (items) => {
      await firstWrite.promise;
      Object.entries(items).forEach(([key, value]) => values.set(key, value));
    });
    const storage = new TranslationBudgetStorage();

    const older = storage.set('model', firstSnapshot, 100);
    const newer = storage.set('model', secondSnapshot, 200);
    await vi.waitFor(() => expect(setSpy).toHaveBeenCalledTimes(1));
    firstWrite.resolve();
    await Promise.all([older, newer]);

    expect(await storage.get('model')).toEqual(secondSnapshot);
  });

  test('uses the last invocation for equal timestamps', async () => {
    const storage = new TranslationBudgetStorage();

    await Promise.all([
      storage.set('model', firstSnapshot, 100),
      storage.set('model', secondSnapshot, 100),
    ]);

    expect(await storage.get('model')).toEqual(secondSnapshot);
  });

  test('waits for a pending write before reading', async () => {
    const firstWrite = Promise.withResolvers<void>();
    setSpy.mockImplementationOnce(async (items) => {
      await firstWrite.promise;
      Object.entries(items).forEach(([key, value]) => values.set(key, value));
    });
    const storage = new TranslationBudgetStorage();
    const write = storage.set('model', firstSnapshot, 100);
    const read = storage.get('model');

    await Promise.resolve();
    expect(getSpy).not.toHaveBeenCalled();
    firstWrite.resolve();

    await expect(read).resolves.toEqual(firstSnapshot);
    await write;
  });

  test('keeps identities in independent storage keys', async () => {
    const storage = new TranslationBudgetStorage();

    await Promise.all([
      storage.set('model-a', firstSnapshot, 100),
      storage.set('model-b', secondSnapshot, 100),
    ]);

    expect(await storage.get('model-a')).toEqual(firstSnapshot);
    expect(await storage.get('model-b')).toEqual(secondSnapshot);
    expect(setSpy.mock.calls).toHaveLength(2);
    expect(new Set(setSpy.mock.calls.map(([items]) => Object.keys(items)[0]))).toEqual(
      new Set(['translationBudgetState:model-a', 'translationBudgetState:model-b']),
    );
  });

  test('propagates storage rejection and allows later writes', async () => {
    setSpy.mockRejectedValueOnce(new Error('write failed'));
    const storage = new TranslationBudgetStorage();

    await expect(storage.set('model', firstSnapshot, 100)).rejects.toThrow(
      'write failed',
    );
    await expect(storage.set('model', secondSnapshot, 200)).resolves.toBeUndefined();
    await expect(storage.get('model')).resolves.toEqual(secondSnapshot);
  });
});
