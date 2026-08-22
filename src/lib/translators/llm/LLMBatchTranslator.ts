import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';

import type { TranslateBatchOptions } from './LLMTranslationEngine';

export type LLMBatchRequestOptions = Omit<TranslateBatchOptions, 'isolateInvalidBatches'>;

export interface LLMBatchTranslator {
  translateBatchWithOptions(
    texts: string[],
    from: string,
    to: string,
    options: LLMBatchRequestOptions,
  ): Promise<string[]>;
  /**
   * Direct execution hooks used by LLMScheduler to avoid routing a scheduled
   * request back through another scheduler instance.
   */
  executeBatchWithOptions?: (
    texts: string[],
    from: string,
    to: string,
    options: LLMBatchRequestOptions,
  ) => Promise<string[]>;
  executePageBatch?: (
    request: PageTranslationBatchRequest,
    options: LLMBatchRequestOptions,
    onMetrics?: (metrics: PageTranslationAttemptMetrics) => void,
  ) => Promise<{ id: string; target: string }[]>;
  abort(context: string): void;
  getMaxConcurrentRequests?: () => number;
  dispose(): void;
}
