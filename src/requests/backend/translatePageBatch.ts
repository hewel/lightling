import {
  PageTranslationBatchRequestSchema,
  PageTranslationBatchResponseSchema,
  type PageTranslationBatchRequest,
  type PageTranslationBatchResponse,
} from '@/lib/pageTranslation/protocol';

import { buildBackendRequest } from '../utils/requestBuilder';

const isTranslationCancellationError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '_tag' in error &&
  (error._tag === 'TranslationAbortedError' ||
    error._tag === 'TranslationSchedulerReplacedError');

export const [translatePageBatchFactory, translatePageBatch] = buildBackendRequest<
  PageTranslationBatchRequest,
  PageTranslationBatchResponse
>('translatePageBatch', {
  requestValidator: PageTranslationBatchRequestSchema,
  responseValidator: PageTranslationBatchResponseSchema,
  factoryHandler:
    ({ backgroundContext }) =>
    async (request) => {
      try {
        const manager = await backgroundContext.getTranslateManager();
        const response = await manager.translatePageBatch(request);
        if (response.failure !== undefined) return response;
        const accounting = backgroundContext.getTranslationAccounting();
        for (const translation of response.translations) {
          if (!translation.cacheHit) accounting.recordTranslation();
        }
        return response;
      } catch (error) {
        if (isTranslationCancellationError(error)) throw error;
        return {
          translations: [],
          metrics: {
            retryCount: 0,
            validationFailures: 0,
            failedIds: request.targets.map((target) => target.id),
            attempts: [],
          },
          failure: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
});
