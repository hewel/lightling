import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';

import {
  getTranslationBudgetSnapshot,
  getTranslationBudgetSnapshotFactory,
} from './getTranslationBudgetSnapshot';
import {
  setTranslationBudgetSnapshot,
  setTranslationBudgetSnapshotFactory,
} from './setTranslationBudgetSnapshot';

const snapshot: BudgetSnapshot = {
  concurrency: 2,
  batchSourceTokens: 600,
  budgetTokens: 3000,
};

describe('translation budget snapshot requests', () => {
  test('gets through the background storage service', async () => {
    const get = vi.fn().mockResolvedValue(snapshot);
    const cleanup = getTranslationBudgetSnapshotFactory({
      backgroundContext: {
        getTranslationBudgetStorage: () => ({ get }),
      } as never,
      config: {} as never,
    });

    try {
      await expect(getTranslationBudgetSnapshot({ identity: 'model' })).resolves.toEqual(
        snapshot,
      );
      expect(get).toHaveBeenCalledWith('model');
    } finally {
      cleanup();
    }
  });

  test('sets through the background storage service with its timestamp', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const cleanup = setTranslationBudgetSnapshotFactory({
      backgroundContext: {
        getTranslationBudgetStorage: () => ({ set }),
      } as never,
      config: {} as never,
    });

    try {
      await expect(
        setTranslationBudgetSnapshot({ identity: 'model', snapshot, updatedAt: 123 }),
      ).resolves.toBeUndefined();
      expect(set).toHaveBeenCalledWith('model', snapshot, 123);
    } finally {
      cleanup();
    }
  });
});
