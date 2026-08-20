import { Schema } from 'effect';

export const TranslationStatsSchema = Schema.Struct({
  translationsCount: Schema.Int,
  llmInputTokens: Schema.Int,
  llmOutputTokens: Schema.Int,
});

export type TranslationStats = typeof TranslationStatsSchema.Type;
