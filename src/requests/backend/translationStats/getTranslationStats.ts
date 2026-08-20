import { buildBackendRequest } from '../../utils/requestBuilder';

import { TranslationStats, TranslationStatsSchema } from './data';

export const [getTranslationStatsFactory, getTranslationStats] = buildBackendRequest<
  void,
  TranslationStats
>('getTranslationStats', {
  responseValidator: TranslationStatsSchema,

  factoryHandler:
    ({ backgroundContext }) =>
    async () =>
      backgroundContext.getTranslationStatsStorage().getStats(),
});
