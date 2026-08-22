import type { IScheduler } from 'anylang/scheduling';

import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';
import { LLMTranslator } from '@/lib/translators/llm/LLMTranslator';

export type PageBatchExecutionResult = { id: string; target: string };

type PageBatchMetricsHandler = (metrics: PageTranslationAttemptMetrics) => void;

export interface PageBatchExecution {
  execute(
    request: PageTranslationBatchRequest,
    onMetrics?: PageBatchMetricsHandler,
  ): Promise<PageBatchExecutionResult[]>;
}

export class LLMPageBatchExecution implements PageBatchExecution {
  constructor(
    private readonly translator: LLMTranslator,
    private readonly retryLimit: number,
  ) {}

  public execute(
    request: PageTranslationBatchRequest,
    onMetrics?: PageBatchMetricsHandler,
  ): Promise<PageBatchExecutionResult[]> {
    return this.translator.translatePageBatch(
      request,
      {
        context: request.sessionId,
        priority: Math.max(...request.targets.map((target) => target.priority)),
        retryLimit: this.retryLimit,
      },
      onMetrics,
    );
  }
}

export class SchedulerPageBatchExecution implements PageBatchExecution {
  constructor(private readonly scheduler: IScheduler) {}

  public execute(
    request: PageTranslationBatchRequest,
  ): Promise<PageBatchExecutionResult[]> {
    return Promise.all(
      request.targets.map(async (target) => ({
        id: target.id,
        target: await this.scheduler.translate(
          target.sourceText,
          request.sourceLanguage,
          request.targetLanguage,
          {
            context: request.sessionId,
            priority: target.priority,
          },
        ),
      })),
    );
  }
}

export interface CreatePageBatchExecutionOptions {
  translatorClass: unknown;
  getLLMTranslator: () => LLMTranslator;
  getScheduler: () => IScheduler;
  retryLimit: number;
}

export const createPageBatchExecution = ({
  translatorClass,
  getLLMTranslator,
  getScheduler,
  retryLimit,
}: CreatePageBatchExecutionOptions): PageBatchExecution => {
  if (translatorClass === LLMTranslator) {
    return new LLMPageBatchExecution(getLLMTranslator(), retryLimit);
  }
  return new SchedulerPageBatchExecution(getScheduler());
};
