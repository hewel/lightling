import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';

import { buildBackendRequest } from '../utils/requestBuilder';

export type SetTranslationBudgetSnapshotRequest = {
  identity: string;
  snapshot: BudgetSnapshot;
  updatedAt: number;
};

export const [setTranslationBudgetSnapshotFactory, setTranslationBudgetSnapshot] =
  buildBackendRequest<SetTranslationBudgetSnapshotRequest>(
    'setTranslationBudgetSnapshot',
    {
      factoryHandler:
        ({ backgroundContext }) =>
        ({ identity, snapshot, updatedAt }) =>
          backgroundContext
            .getTranslationBudgetStorage()
            .set(identity, snapshot, updatedAt),
    },
  );
