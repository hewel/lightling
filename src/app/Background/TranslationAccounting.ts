import type { TranslationStatsStorage } from './TranslationStatsStorage';

export type TranslationTokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export class TranslationAccounting {
  constructor(private readonly statsStorage: TranslationStatsStorage) {}

  public recordTranslation = (): void => {
    void this.statsStorage.addTranslation().catch(() => undefined);
  };

  public recordLLMUsage = (usage: TranslationTokenUsage): void => {
    void this.statsStorage.addLLMUsage(usage).catch(() => undefined);
  };
}
