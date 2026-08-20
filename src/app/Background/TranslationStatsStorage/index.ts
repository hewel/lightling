import browser from 'webextension-polyfill';

import { decodeStruct } from '@/lib/types';
import {
  TranslationStats,
  TranslationStatsSchema,
} from '@/requests/backend/translationStats/data';

const defaultData: TranslationStats = {
  translationsCount: 0,
  llmInputTokens: 0,
  llmOutputTokens: 0,
};

/**
 * Cumulative usage statistics: total translations count and LLM token consumption
 */
export class TranslationStatsStorage {
  private readonly storeName = 'TranslationStatsStorage';

  public getStats = async (): Promise<TranslationStats> => this.getData();

  public addTranslation = () =>
    this.mutate((data) => ({
      ...data,
      translationsCount: data.translationsCount + 1,
    }));

  public addLLMUsage = (usage: { inputTokens: number; outputTokens: number }) =>
    this.mutate((data) => ({
      ...data,
      llmInputTokens: data.llmInputTokens + usage.inputTokens,
      llmOutputTokens: data.llmOutputTokens + usage.outputTokens,
    }));

  public reset = () => this.setData(defaultData);

  /**
   * Serialized mutation chain: stats increments arrive concurrently, so every
   * read-modify-write cycle queues behind the previous one to avoid lost updates
   */
  private queue: Promise<unknown> = Promise.resolve();
  private mutate(fn: (data: TranslationStats) => TranslationStats): Promise<void> {
    const run = this.queue.then(async () => {
      const data = await this.getData();
      await this.setData(fn(data));
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private readonly getData = async (): Promise<TranslationStats> => {
    const storeName = this.storeName;
    const { [storeName]: statsData } = await browser.storage.local.get(storeName);

    const struct = decodeStruct(TranslationStatsSchema, statsData);

    return struct.errors ? defaultData : struct.data;
  };

  private readonly setData = async (data: TranslationStats) => {
    const storeName = this.storeName;
    await browser.storage.local.set({ [storeName]: data });
  };
}
