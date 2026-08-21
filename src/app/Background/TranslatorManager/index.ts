import { isLanguageCodeISO639v1 } from 'anylang/languages';
import { IScheduler, Scheduler, SchedulerWithCache } from 'anylang/scheduling';

import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { LLMScheduler } from '@/lib/translators/llm/LLMScheduler';
import { getLLMCacheId } from '@/lib/translators/llm/LLMTranslationEngine';
import { getActiveLLMProfile, LLMTranslator } from '@/lib/translators/llm/LLMTranslator';
import { AppConfigType } from '@/types/runtime';
import { RecordValues } from '@/types/utils';

import { TranslatorsMap } from '..';
import { TranslatorsCacheStorage } from '../TranslatorsCacheStorage';

export type Config = Pick<
  AppConfigType,
  'translatorModule' | 'scheduler' | 'cache' | 'llmTranslator'
>;

/**
 * Build and manage a translation scheduler
 */
export class TranslatorManager<Translators extends TranslatorsMap = TranslatorsMap> {
  private config: Config;
  private translators: Translators;
  private readonly managerOptions?: {
    onLLMTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  };
  constructor(
    config: Config,
    translators: Translators,
    options?: {
      onLLMTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    },
  ) {
    this.config = config;
    this.translators = translators;
    this.managerOptions = options;
  }

  public setConfig(config: Config) {
    this.config = config;
    this.getTranslationSchedulerInstance(true);
  }

  public setTranslators(customTranslators: Translators) {
    this.translators = customTranslators;
    this.getTranslationSchedulerInstance(true);
  }

  public getTranslatorFeatures() {
    const translatorClass = this.getTranslatorClass();
    return {
      supportedLanguages: translatorClass
        .getSupportedLanguages()
        .filter((lang) => isLanguageCodeISO639v1(lang)),
      isSupportAutodetect: translatorClass.isSupportedAutoFrom(),
    };
  }

  /**
   * Return map with available translators
   */
  public getTranslators(): Translators {
    return this.translators;
  }

  public getTranslator(): InstanceType<RecordValues<Translators>> {
    return this.getTranslatorInstance();
  }

  /**
   * Return configured translation scheduler
   */
  public getScheduler() {
    return this.getTranslationSchedulerInstance();
  }

  private llmSchedulerInstance: LLMScheduler | null = null;
  private schedulerInstance: IScheduler | null = null;
  private getTranslationSchedulerInstance(forceCreate = false) {
    if (this.schedulerInstance === null || forceCreate) {
      if (this.llmSchedulerInstance !== null) {
        this.llmSchedulerInstance.dispose();
        this.llmSchedulerInstance = null;
      }

      this.translator = null;

      const translatorClass = this.getTranslatorClass();
      const isLLM = (translatorClass as unknown) === LLMTranslator;
      const { useCache, ...schedulerConfig } = this.config.scheduler;
      let schedulerInstance: IScheduler;

      if (isLLM) {
        const translator = this.getTranslatorInstance() as LLMTranslator;
        const onFinalError = (error: unknown) => {
          telemetry.track(TELEMETRY_EVENT_NAME.ERROR_CAPTURED, {
            scope: 'translator',
            error: String(error),
            translatorName: LLMTranslator.translatorName,
          });
        };

        const llmScheduler = new LLMScheduler(
          translator,
          {
            translateRetryAttemptLimit: this.config.scheduler.translateRetryAttemptLimit,
            directTranslateLength: this.config.scheduler.directTranslateLength,
            translatePoolDelay: this.config.scheduler.translatePoolDelay,
            chunkSizeForInstantTranslate:
              this.config.scheduler.chunkSizeForInstantTranslate,
          },
          onFinalError,
        );
        this.llmSchedulerInstance = llmScheduler;
        schedulerInstance = llmScheduler;
      } else {
        const translator = this.getTranslatorInstance();
        schedulerInstance = new Scheduler(translator, schedulerConfig);
      }

      this.schedulerInstance = useCache
        ? new SchedulerWithCache(
            schedulerInstance as unknown as Scheduler,
            this.getCacheInstance(),
          )
        : schedulerInstance;
    }

    return this.schedulerInstance;
  }

  private translator: InstanceType<RecordValues<Translators>> | null = null;
  private getTranslatorInstance() {
    if (this.translator !== null) return this.translator;

    const translatorClass = this.getTranslatorClass();

    if ((translatorClass as unknown) === LLMTranslator) {
      // LLM cancellation/replacement errors must not emit telemetry.
      // The LLM translator is instantiated directly, and error telemetry
      // is handled exclusively by LLMScheduler on final logical failures.
      this.translator = new LLMTranslator(this.config.llmTranslator, {
        onTokenUsage: this.managerOptions?.onLLMTokenUsage,
      }) as InstanceType<RecordValues<Translators>>;
      return this.translator;
    }

    const constructorArgs: [] = [];

    this.translator = new (class extends translatorClass {
      async translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string,
      ): Promise<string> {
        try {
          return await super.translate(text, sourceLanguage, targetLanguage);
        } catch (error) {
          telemetry.track(TELEMETRY_EVENT_NAME.ERROR_CAPTURED, {
            scope: 'translator',
            error: String(error),
            translatorName: translatorClass.translatorName,
          });

          throw error;
        }
      }

      async translateBatch(
        text: string[],
        sourceLanguage: string,
        targetLanguage: string,
      ): Promise<(string | null)[]> {
        try {
          return await super.translateBatch(text, sourceLanguage, targetLanguage);
        } catch (error) {
          telemetry.track(TELEMETRY_EVENT_NAME.ERROR_CAPTURED, {
            scope: 'translator',
            error: String(error),
            translatorName: translatorClass.translatorName,
          });

          throw error;
        }
      }
    })(...constructorArgs) as InstanceType<RecordValues<Translators>>;

    return this.translator;
  }

  private getCacheInstance() {
    const translatorClass = this.getTranslatorClass();
    const isLLM = (translatorClass as unknown) === LLMTranslator;

    if (isLLM) {
      const profile = getActiveLLMProfile(this.config.llmTranslator);
      const cacheId = getLLMCacheId(profile);
      return new TranslatorsCacheStorage(cacheId, this.config.cache);
    }

    const { translatorModule, cache } = this.config;
    return new TranslatorsCacheStorage(translatorModule, cache);
  }

  private getTranslatorClass(): RecordValues<Translators> {
    const { translatorModule } = this.config;

    const translators = this.getTranslators();
    const translatorClass = translators[translatorModule];
    if (translatorClass === undefined) {
      throw new Error(`Not found translator "${translatorModule}"`);
    }

    return translatorClass as RecordValues<Translators>;
  }
}
