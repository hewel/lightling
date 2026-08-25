import browser from 'webextension-polyfill';

import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';

export type TranslationBudgetStateEntry = {
  snapshot: BudgetSnapshot;
  updatedAt: number;
};

const TRANSLATION_BUDGET_STORAGE_KEY_PREFIX = 'translationBudgetState:';

const isBudgetSnapshot = (value: unknown): value is BudgetSnapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.concurrency === 'number' &&
    Number.isFinite(snapshot.concurrency) &&
    snapshot.concurrency > 0 &&
    typeof snapshot.batchSourceTokens === 'number' &&
    Number.isFinite(snapshot.batchSourceTokens) &&
    snapshot.batchSourceTokens > 0 &&
    typeof snapshot.budgetTokens === 'number' &&
    Number.isFinite(snapshot.budgetTokens) &&
    snapshot.budgetTokens > 0
  );
};

const storageKey = (identity: string): string =>
  `${TRANSLATION_BUDGET_STORAGE_KEY_PREFIX}${identity}`;

/**
 * Background-owned persistence for adaptive translation budgets.
 *
 * The background context is shared by all tabs, so each discovery identity has
 * one write chain and one timestamp ordering authority.
 */
export class TranslationBudgetStorage {
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly latestUpdatedAt = new Map<string, number>();

  public readonly get = async (identity: string): Promise<BudgetSnapshot | null> => {
    const key = storageKey(identity);
    await this.pendingWrites.get(key);

    const data = await browser.storage.local.get(key);
    const entry = data[key];
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt))
      return null;

    const latest = this.latestUpdatedAt.get(key);
    if (latest === undefined || record.updatedAt > latest) {
      this.latestUpdatedAt.set(key, record.updatedAt);
    }
    return isBudgetSnapshot(record.snapshot) ? record.snapshot : null;
  };

  public readonly set = (
    identity: string,
    snapshot: BudgetSnapshot,
    updatedAt: number,
  ): Promise<void> => {
    const key = storageKey(identity);
    const latest = this.latestUpdatedAt.get(key);
    if (latest !== undefined && updatedAt < latest) return Promise.resolve();
    this.latestUpdatedAt.set(key, updatedAt);

    const previousWrite = this.pendingWrites.get(key) ?? Promise.resolve();
    const write = previousWrite.then(async () => {
      const current = this.latestUpdatedAt.get(key);
      if (current !== undefined && updatedAt < current) return;

      await browser.storage.local.set({
        [key]: { snapshot, updatedAt } satisfies TranslationBudgetStateEntry,
      });
    });
    const trackedWrite = write.catch(() => undefined);
    this.pendingWrites.set(key, trackedWrite);
    void trackedWrite.finally(() => {
      if (this.pendingWrites.get(key) === trackedWrite) {
        this.pendingWrites.delete(key);
      }
    });

    return write;
  };
}
