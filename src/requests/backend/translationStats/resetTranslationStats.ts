import { buildBackendRequest } from '../../utils/requestBuilder';

export const [resetTranslationStatsFactory, resetTranslationStats] = buildBackendRequest(
  'resetTranslationStats',
  {
    factoryHandler:
      ({ backgroundContext }) =>
      async () =>
        backgroundContext.getTranslationStatsStorage().reset(),
  },
);
