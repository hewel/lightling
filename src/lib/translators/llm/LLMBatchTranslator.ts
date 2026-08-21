import type { TranslateBatchOptions } from './LLMTranslationEngine';

export type LLMBatchRequestOptions = Omit<TranslateBatchOptions, 'isolateInvalidBatches'>;

export interface LLMBatchTranslator {
  translateBatchWithOptions(
    texts: string[],
    from: string,
    to: string,
    options: LLMBatchRequestOptions,
  ): Promise<string[]>;
  abort(context: string): void;
  dispose(): void;
}
