import type { IScheduler, ISchedulerTranslateOptions } from 'anylang/scheduling';

import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';

import type { LLMBatchRequestOptions, LLMBatchTranslator } from './LLMBatchTranslator';
import {
  TranslationAbortedError,
  TranslationSchedulerReplacedError,
} from './LLMTranslationEngine';

export type LLMSchedulerConfig = {
  translateRetryAttemptLimit: number;
  directTranslateLength: number | null;
  translatePoolDelay: number;
  chunkSizeForInstantTranslate: number | null;
  maxConcurrentRequests?: number;
  pageMaxConcurrentRequests?: number;
};

type LLMTranslateOptions = ISchedulerTranslateOptions & {
  retryLimit?: number;
};

interface Task {
  text: string;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
}

interface TaskContainer {
  key: string;
  from: string;
  to: string;
  context: string;
  priority: number;
  retryLimit: number;
  serial: number;
  tasks: Task[];
  timer: number | NodeJS.Timeout | null;
}

interface PageTask {
  serial: number;
  request: PageTranslationBatchRequest;
  options: LLMBatchRequestOptions;
  onMetrics?: (metrics: PageTranslationAttemptMetrics) => void;
  resolve: (value: { id: string; target: string }[]) => void;
  reject: (reason?: unknown) => void;
}

const isCancellationError = (error: unknown): boolean =>
  error instanceof TranslationAbortedError ||
  error instanceof TranslationSchedulerReplacedError ||
  (typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error._tag === 'TranslationAbortedError' ||
      error._tag === 'TranslationSchedulerReplacedError'));

export class LLMScheduler implements IScheduler {
  private isDisposed = false;
  private readonly abortedContexts = new Set<string>();
  private readonly containers = new Map<string, TaskContainer>();
  private readonly pageQueue: PageTask[] = [];
  private readonly batchQueue: TaskContainer[] = [];
  private batchActiveRequests = 0;
  private pageActiveRequests = 0;
  private pumpScheduled = false;
  private serialCounter = 0;

  constructor(
    private readonly translator: LLMBatchTranslator,
    private readonly config: LLMSchedulerConfig,
    private readonly onFinalError: (error: unknown) => void,
  ) {}
  private getMaxConcurrentRequests(): number {
    return Math.max(
      1,
      this.config.maxConcurrentRequests ??
        this.translator.getMaxConcurrentRequests?.() ??
        1,
    );
  }

  private getPageMaxConcurrentRequests(): number {
    return Math.max(1, this.config.pageMaxConcurrentRequests ?? 12);
  }

  public async translate(
    text: string,
    from: string,
    to: string,
    options?: LLMTranslateOptions,
  ): Promise<string> {
    if (this.isDisposed) {
      throw TranslationSchedulerReplacedError.new();
    }

    const context = options?.context ?? 'scheduler';
    const priority = options?.priority ?? 0;
    const retryLimit = options?.retryLimit ?? this.config.translateRetryAttemptLimit;

    if (this.abortedContexts.has(context)) {
      throw TranslationAbortedError.new();
    }

    return new Promise<string>((resolve, reject) => {
      const task: Task = { text, resolve, reject };
      const key = `${from}\0${to}\0${context}\0${priority}\0${retryLimit}`;

      let container = this.containers.get(key);
      const isNewContainer = container === undefined;

      if (container === undefined) {
        container = {
          key,
          from,
          to,
          context,
          priority,
          retryLimit,
          serial: this.serialCounter++,
          tasks: [task],
          timer: null,
        };
        this.containers.set(key, container);
      } else {
        container.tasks.push(task);
      }

      const shouldFlushEarly =
        options?.directTranslate === true ||
        (this.config.directTranslateLength !== null &&
          text.length >= this.config.directTranslateLength) ||
        (this.config.chunkSizeForInstantTranslate !== null &&
          container.tasks.length >= this.config.chunkSizeForInstantTranslate);

      if (shouldFlushEarly) {
        this.flushContainer(container, true);
      } else if (isNewContainer) {
        container.timer = setTimeout(() => {
          if (container) {
            this.flushContainer(container, false);
          }
        }, this.config.translatePoolDelay);
      }
    });
  }

  public async translateBatch(
    texts: string[],
    from: string,
    to: string,
    options: LLMBatchRequestOptions,
  ): Promise<string[]> {
    if (this.isDisposed) throw TranslationSchedulerReplacedError.new();
    if (this.abortedContexts.has(options.context)) throw TranslationAbortedError.new();
    if (texts.length === 0) return [];

    return Promise.all(
      texts.map((text) =>
        this.translate(text, from, to, {
          context: options.context,
          priority: options.priority,
          retryLimit: options.retryLimit,
        }),
      ),
    );
  }

  public async translatePageBatch(
    request: PageTranslationBatchRequest,
    options: LLMBatchRequestOptions,
    onMetrics?: (metrics: PageTranslationAttemptMetrics) => void,
  ): Promise<{ id: string; target: string }[]> {
    if (this.isDisposed) throw TranslationSchedulerReplacedError.new();
    if (this.abortedContexts.has(options.context)) throw TranslationAbortedError.new();
    if (request.targets.length === 0) return [];
    if (this.translator.executePageBatch === undefined) {
      throw new Error('LLM translation adapter does not support page batches');
    }

    return new Promise((resolve, reject) => {
      this.pageQueue.push({
        serial: this.serialCounter++,
        request,
        options,
        onMetrics,
        resolve,
        reject,
      });
      this.schedulePump(false);
    });
  }

  public async abort(context: string): Promise<void> {
    this.abortedContexts.add(context);

    const abortedTasks: Task[] = [];
    for (const [key, container] of Array.from(this.containers.entries())) {
      if (container.context !== context) continue;
      this.containers.delete(key);
      if (container.timer !== null) {
        clearTimeout(container.timer);
        container.timer = null;
      }
      abortedTasks.push(...container.tasks);
    }

    const queuedBatches = this.batchQueue.filter(
      (container) => container.context === context,
    );
    this.batchQueue.splice(
      0,
      this.batchQueue.length,
      ...this.batchQueue.filter((container) => container.context !== context),
    );
    const abortedPageTasks = this.pageQueue.filter(
      (task) => task.options.context === context,
    );
    this.pageQueue.splice(
      0,
      this.pageQueue.length,
      ...this.pageQueue.filter((task) => task.options.context !== context),
    );

    const error = TranslationAbortedError.new();
    for (const task of abortedTasks) task.reject(error);
    for (const container of queuedBatches) {
      for (const task of container.tasks) task.reject(error);
    }
    for (const task of abortedPageTasks) task.reject(error);
    this.translator.abort(context);
    this.pump();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const allTasks: Task[] = [];
    for (const container of this.containers.values()) {
      if (container.timer !== null) {
        clearTimeout(container.timer);
        container.timer = null;
      }
      allTasks.push(...container.tasks);
    }
    this.containers.clear();

    const error = TranslationSchedulerReplacedError.new();
    for (const task of allTasks) task.reject(error);
    for (const container of this.batchQueue) {
      for (const task of container.tasks) task.reject(error);
    }
    for (const task of this.pageQueue) task.reject(error);
    this.batchQueue.length = 0;
    this.pageQueue.length = 0;

    this.translator.dispose();
  }

  private flushContainer(container: TaskContainer, immediate: boolean): void {
    if (this.containers.get(container.key) === container) {
      this.containers.delete(container.key);
    }
    if (container.timer !== null) {
      clearTimeout(container.timer);
      container.timer = null;
    }

    if (container.tasks.length === 0) return;

    if (this.isDisposed) {
      const error = TranslationSchedulerReplacedError.new();
      for (const task of container.tasks) task.reject(error);
      return;
    }

    if (this.abortedContexts.has(container.context)) {
      const error = TranslationAbortedError.new();
      for (const task of container.tasks) task.reject(error);
      return;
    }

    this.batchQueue.push(container);
    this.schedulePump(immediate);
  }

  private schedulePump(immediate: boolean): void {
    if (immediate) {
      this.pump();
      return;
    }
    if (this.pumpScheduled || this.isDisposed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (!this.isDisposed) {
      const canDispatchBatch =
        this.batchQueue.length > 0 &&
        this.batchActiveRequests < this.getMaxConcurrentRequests();
      const canDispatchPage =
        this.pageQueue.length > 0 &&
        this.pageActiveRequests < this.getPageMaxConcurrentRequests();
      if (!canDispatchBatch && !canDispatchPage) break;

      let batchIndex = -1;
      let pageIndex = -1;
      let bestPriority = -Infinity;
      let bestSerial = Infinity;

      if (canDispatchBatch) {
        for (let i = 0; i < this.batchQueue.length; i++) {
          const candidate = this.batchQueue[i];
          if (
            candidate.priority > bestPriority ||
            (candidate.priority === bestPriority && candidate.serial < bestSerial)
          ) {
            bestPriority = candidate.priority;
            bestSerial = candidate.serial;
            batchIndex = i;
            pageIndex = -1;
          }
        }
      }
      if (canDispatchPage) {
        for (let i = 0; i < this.pageQueue.length; i++) {
          const candidate = this.pageQueue[i];
          if (
            candidate.options.priority > bestPriority ||
            (candidate.options.priority === bestPriority && candidate.serial < bestSerial)
          ) {
            bestPriority = candidate.options.priority;
            bestSerial = candidate.serial;
            batchIndex = -1;
            pageIndex = i;
          }
        }
      }

      if (batchIndex >= 0) {
        const [container] = this.batchQueue.splice(batchIndex, 1);
        if (this.abortedContexts.has(container.context)) continue;
        this.batchActiveRequests++;
        const tasks = container.tasks;
        const options: LLMBatchRequestOptions = {
          context: container.context,
          priority: container.priority,
          retryLimit: container.retryLimit,
        };
        const texts = tasks.map((task) => task.text);
        const execution =
          this.translator.executeBatchWithOptions !== undefined
            ? this.translator.executeBatchWithOptions(
                texts,
                container.from,
                container.to,
                options,
              )
            : this.translator.translateBatchWithOptions(
                texts,
                container.from,
                container.to,
                options,
              );
        void execution
          .then((results) => {
            for (let i = 0; i < tasks.length; i++) tasks[i].resolve(results[i]);
          })
          .catch((error) => {
            const isCancellation = isCancellationError(error);
            for (const task of tasks) {
              if (!isCancellation) {
                try {
                  this.onFinalError(error);
                } catch {
                  // ignore
                }
              }
              task.reject(error);
            }
          })
          .finally(() => {
            this.batchActiveRequests--;
            this.pump();
          });
        continue;
      }

      if (pageIndex >= 0) {
        const [task] = this.pageQueue.splice(pageIndex, 1);
        if (this.abortedContexts.has(task.options.context)) continue;
        this.pageActiveRequests++;
        void this.translator.executePageBatch!(task.request, task.options, task.onMetrics)
          .then(task.resolve, task.reject)
          .finally(() => {
            this.pageActiveRequests--;
            this.pump();
          });
        continue;
      }

      break;
    }
  }
}
