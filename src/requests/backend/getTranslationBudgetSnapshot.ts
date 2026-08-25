import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';

import { buildBackendRequest } from '../utils/requestBuilder';

export type TranslationBudgetSnapshotRequest = {
  identity: string;
};

export const [getTranslationBudgetSnapshotFactory, getTranslationBudgetSnapshot] =
  buildBackendRequest<TranslationBudgetSnapshotRequest, BudgetSnapshot | null>(
    'getTranslationBudgetSnapshot',
    {
      factoryHandler:
        ({ backgroundContext }) =>
        ({ identity }) =>
          backgroundContext.getTranslationBudgetStorage().get(identity),
    },
  );
