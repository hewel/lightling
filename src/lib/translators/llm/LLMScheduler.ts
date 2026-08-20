import type { IScheduler, ISchedulerTranslateOptions } from 'anylang/scheduling';

import type { AppConfigType } from '@/types/runtime';

import {
  TranslationAbortedError,
  TranslationSchedulerReplacedError,
} from './LLMTranslationEngine';
import type { LLMTranslator } from './LLMTranslator';

export type LLMSchedulerConfig = Omit<AppConfigType['scheduler'], 'useCache'>;

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
  tasks: Task[];
  timer: number | NodeJS.Timeout | null;
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

  constructor(
    private readonly translator: LLMTranslator,
    private readonly config: LLMSchedulerConfig,
    private readonly onFinalError: (error: unknown) => void,
  ) {}

  public async translate(
    text: string,
    from: string,
    to: string,
    options?: ISchedulerTranslateOptions,
  ): Promise<string> {
    if (this.isDisposed) {
      throw new TranslationSchedulerReplacedError();
    }

    const context = options?.context ?? 'scheduler';
    const priority = options?.priority ?? 0;

    if (this.abortedContexts.has(context)) {
      throw new TranslationAbortedError();
    }

    return new Promise<string>((resolve, reject) => {
      const task: Task = { text, resolve, reject };
      const key = `${from}\0${to}\0${context}\0${priority}`;

      let container = this.containers.get(key);
      const isNewContainer = container === undefined;

      if (container === undefined) {
        container = {
          key,
          from,
          to,
          context,
          priority,
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
        this.flushContainer(container);
      } else if (isNewContainer) {
        container.timer = setTimeout(() => {
          if (container) {
            this.flushContainer(container);
          }
        }, this.config.translatePoolDelay);
      }
    });
  }

  public async abort(context: string): Promise<void> {
    this.abortedContexts.add(context);

    // Cancel all matching pooled containers and tasks
    const abortedTasks: Task[] = [];
    for (const [key, container] of Array.from(this.containers.entries())) {
      if (container.context === context) {
        this.containers.delete(key);
        if (container.timer !== null) {
          clearTimeout(container.timer);
          container.timer = null;
        }
        abortedTasks.push(...container.tasks);
      }
    }

    const error = new TranslationAbortedError();
    for (const task of abortedTasks) {
      task.reject(error);
    }

    this.translator.abort(context);
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

    const error = new TranslationSchedulerReplacedError();
    for (const task of allTasks) {
      task.reject(error);
    }

    this.translator.dispose();
  }

  private flushContainer(container: TaskContainer): void {
    if (this.containers.get(container.key) === container) {
      this.containers.delete(container.key);
    }
    if (container.timer !== null) {
      clearTimeout(container.timer);
      container.timer = null;
    }

    if (container.tasks.length === 0) return;

    if (this.isDisposed) {
      const error = new TranslationSchedulerReplacedError();
      for (const task of container.tasks) {
        task.reject(error);
      }
      return;
    }

    if (this.abortedContexts.has(container.context)) {
      const error = new TranslationAbortedError();
      for (const task of container.tasks) {
        task.reject(error);
      }
      return;
    }

    const tasks = container.tasks;
    const texts = tasks.map((t) => t.text);

    this.translator
      .translateBatchWithOptions(texts, container.from, container.to, {
        context: container.context,
        priority: container.priority,
        retryLimit: this.config.translateRetryAttemptLimit,
        isolateInvalidBatches: true,
      })
      .then((results) => {
        for (let i = 0; i < tasks.length; i++) {
          tasks[i].resolve(results[i]);
        }
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
      });
  }
}
