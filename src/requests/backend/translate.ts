import type { ISchedulerTranslateOptions } from 'anylang/scheduling';
import { Schema } from 'effect';

import { buildBackendRequest } from '../utils/requestBuilder';

export const TranslateRequestSchema = Schema.Struct({
  text: Schema.String,
  from: Schema.String,
  to: Schema.String,
  options: Schema.optional(
    Schema.Struct({
      context: Schema.optional(Schema.String),
      priority: Schema.optional(Schema.Finite),
      directTranslate: Schema.optional(Schema.Boolean),
    }),
  ),
});

export const TranslateResponseSchema = Schema.String;
export const [translateFactory, translateRequest] = buildBackendRequest<
  {
    text: string;
    from: string;
    to: string;
    options?: ISchedulerTranslateOptions;
  },
  string
>('translate', {
  requestValidator: TranslateRequestSchema,
  responseValidator: TranslateResponseSchema,
  factoryHandler:
    ({ backgroundContext }) =>
    async ({ text, from, to, options }) => {
      const translateManager = await backgroundContext.getTranslateManager();
      return translateManager.translate(text, from, to, options);
    },
});

export const translate = (
  text: string,
  from: string,
  to: string,
  options?: ISchedulerTranslateOptions,
) =>
  translateRequest({
    text,
    from,
    to,
    options,
  });
