import { Schema } from 'effect';

/**
 * Object contains translation data
 */
export type ITranslation = {
  from: string;
  to: string;
  originalText: string;
  translatedText: string;
};

export const TranslationType = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  originalText: Schema.String,
  translatedText: Schema.String,
});
