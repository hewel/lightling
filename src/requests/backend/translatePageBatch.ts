import type {
  PageTranslationBatchRequest,
  PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [translatePageBatchFactory, translatePageBatch] = buildBackendRequest<
  PageTranslationBatchRequest,
  PageTranslationBatchResponse
>('translatePageBatch', {
  factoryHandler:
    ({ backgroundContext }) =>
    async (request) => {
      const manager = await backgroundContext.getTranslateManager();
      const response = await manager.translatePageBatch(request);
      const accounting = backgroundContext.getTranslationAccounting();
      for (const translation of response.translations) {
        if (!translation.cacheHit) accounting.recordTranslation();
      }
      return response;
    },
});
