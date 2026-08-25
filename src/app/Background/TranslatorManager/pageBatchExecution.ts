import type { IScheduler } from 'anylang/scheduling';

import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';
import type { LLMScheduler } from '@/lib/translators/llm/LLMScheduler';
import { LLMTranslator } from '@/lib/translators/llm/LLMTranslator';

export type PageBatchExecutionResult = { id: string; target: string };

type PageBatchMetricsHandler = (metrics: PageTranslationAttemptMetrics) => void;

type PageBatchScheduler = Pick<LLMScheduler, 'translatePageBatch'>;

type LLMPageBatchExecutor =
  | Pick<LLMTranslator, 'translatePageBatch'>
  | PageBatchScheduler;

export interface PageBatchExecution {
  execute(
    request: PageTranslationBatchRequest,
    onMetrics?: PageBatchMetricsHandler,
  ): Promise<PageBatchExecutionResult[]>;
}

export class LLMPageBatchExecution implements PageBatchExecution {
  constructor(
    private readonly executor: LLMPageBatchExecutor,
    private readonly retryLimit: number,
  ) {}

  public execute(
    request: PageTranslationBatchRequest,
    onMetrics?: PageBatchMetricsHandler,
  ): Promise<PageBatchExecutionResult[]> {
    return this.executor.translatePageBatch(
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
  getScheduler: () => IScheduler;
  llmSchedulerInstance?: LLMScheduler | null;
  retryLimit: number;
}

const isPageBatchScheduler = (
  scheduler: LLMScheduler | null | undefined,
): scheduler is LLMScheduler =>
  scheduler !== null &&
  scheduler !== undefined &&
  typeof scheduler.translatePageBatch === 'function';

export const createPageBatchExecution = ({
  translatorClass,
  getScheduler,
  llmSchedulerInstance,
  retryLimit,
}: CreatePageBatchExecutionOptions): PageBatchExecution => {
  if (translatorClass === LLMTranslator) {
    if (!isPageBatchScheduler(llmSchedulerInstance)) {
      throw new Error('LLM page translation requires the configured LLM scheduler');
    }
    return new LLMPageBatchExecution(llmSchedulerInstance, retryLimit);
  }
  return new SchedulerPageBatchExecution(getScheduler());
};
