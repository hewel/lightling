import { isLanguageCodeISO639v1 } from 'anylang/languages';
import {
  Scheduler,
  SchedulerWithCache,
  type IScheduler,
  type ISchedulerTranslateOptions,
} from 'anylang/scheduling';

import {
  createSemanticKey,
  DEFAULT_GLOSSARY_VERSION,
  deriveAttemptMetrics,
  getPlaceholderIntegrityFailure,
  isInvariantTranslationSource,
  type PageTranslationBatchRequest,
  type PageTranslationAttemptMetrics,
  type PageTranslationBatchResponse,
  type PageTranslationResult,
  WEBPAGE_NORMALIZATION_VERSION,
} from '@/lib/pageTranslation/protocol';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { LLMScheduler } from '@/lib/translators/llm/LLMScheduler';
import {
  getLLMCacheId,
  isTranslationCancellationError,
} from '@/lib/translators/llm/LLMTranslationEngine';
import { getActiveLLMProfile, LLMTranslator } from '@/lib/translators/llm/LLMTranslator';
import { resolveTranslationModelProfile } from '@/lib/translators/llm/modelProfile';
import { AppConfigType } from '@/types/runtime';
import { RecordValues } from '@/types/utils';

import { TranslatorsMap } from '..';
import { TranslatorsCacheStorage } from '../TranslatorsCacheStorage';
import { createPageBatchExecution } from './pageBatchExecution';
import { PageTranslationMemory } from './PageTranslationMemory';

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
    onTranslation?: () => void;
  };
  private readonly pageTranslationMemory = new PageTranslationMemory();

  constructor(
    config: Config,
    translators: Translators,
    options?: {
      onLLMTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
      onTranslation?: () => void;
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

  public async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    options?: ISchedulerTranslateOptions,
  ): Promise<string> {
    const { supportedLanguages, isSupportAutodetect } = this.getTranslatorFeatures();

    if (
      (sourceLanguage === 'auto' && !isSupportAutodetect) ||
      (sourceLanguage !== 'auto' && !supportedLanguages.includes(sourceLanguage))
    )
      throw new Error('Source language is not supported by selected translator');
    if (!supportedLanguages.includes(targetLanguage))
      throw new Error('Target language is not supported by selected translator');

    const result = await this.getTranslationSchedulerInstance().translate(
      text,
      sourceLanguage,
      targetLanguage,
      options,
    );

    this.managerOptions?.onTranslation?.();

    return result;
  }

  public abort(context: string): Promise<void> {
    return this.getTranslationSchedulerInstance().abort(context);
  }

  public async translatePageBatch(
    request: PageTranslationBatchRequest,
  ): Promise<PageTranslationBatchResponse> {
    const identity = this.getPageTranslationIdentity();
    const targets = request.targets.map((target) => ({
      ...target,
      semanticKey: createSemanticKey({
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        normalizedText: target.normalizedText,
        kind: target.kind,
        slot: target.slot,
        contextClass: target.contextClass,
        provider: identity.provider,
        model: identity.model,
        glossaryVersion: DEFAULT_GLOSSARY_VERSION,
        promptVersion: identity.promptVersion,
        profileVersion: identity.profileVersion,
      }),
    }));
    const results = new Map<string, PageTranslationResult>();
    const misses: typeof targets = [];
    const metrics: PageTranslationAttemptMetrics = {
      retryCount: 0,
      validationFailures: 0,
    };
    const invariantTerms = [
      ...request.memory.protectedTerms,
      ...request.memory.namedEntities,
    ];

    for (const target of targets) {
      if (isInvariantTranslationSource(target.sourceText, invariantTerms)) {
        results.set(target.id, {
          id: target.id,
          target: target.sourceText,
          cacheKey: target.semanticKey,
          cacheHit: false,
          provenance: 'invariant',
        });
        continue;
      }

      const entry = await this.pageTranslationMemory.get(target.semanticKey);
      if (entry === null) {
        misses.push(target);
      } else {
        results.set(target.id, {
          id: target.id,
          target: entry.translatedText,
          cacheKey: entry.key,
          cacheHit: true,
          provenance: 'cache',
        });
      }
    }
    if (misses.length > 0) {
      let translated: { id: string; target: string }[];
      try {
        const scheduler = this.getTranslationSchedulerInstance();
        translated = await createPageBatchExecution({
          translatorClass: this.getTranslatorClass(),
          getScheduler: () => scheduler,
          llmSchedulerInstance: this.llmSchedulerInstance,
          retryLimit: this.config.scheduler.translateRetryAttemptLimit,
        }).execute({ ...request, targets: misses }, (terminal) => {
          if (terminal.acceptedProfileId !== undefined) {
            metrics.acceptedProfileId = terminal.acceptedProfileId;
          }
          if (terminal.acceptedRetryStage !== undefined) {
            metrics.acceptedRetryStage = terminal.acceptedRetryStage;
          }
          if (terminal.failedIds !== undefined) {
            metrics.failedIds = terminal.failedIds;
          }
          if (terminal.attempts !== undefined) {
            metrics.attempts = [...(metrics.attempts ?? []), ...terminal.attempts];
          }
        });
      } catch (error) {
        if (
          (this.getTranslatorClass() as unknown) !== LLMTranslator ||
          isTranslationCancellationError(error)
        ) {
          throw error;
        }
        metrics.failedIds = misses.map((target) => target.id);
        const derivedMetrics = deriveAttemptMetrics(metrics.attempts ?? []);
        metrics.retryCount = derivedMetrics.retryCount;
        metrics.validationFailures = derivedMetrics.validationFailures;
        return {
          translations: [],
          metrics,
          failure: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }

      for (const translation of translated) {
        const target = misses.find((candidate) => candidate.id === translation.id);
        if (target === undefined) continue;
        const integrityFailure = getPlaceholderIntegrityFailure(
          target.sourceText,
          translation.target,
        );
        if (integrityFailure !== null) {
          metrics.attempts = [
            ...(metrics.attempts ?? []),
            {
              kind: 'parse',
              stage: 'initial',
              profileId: metrics.acceptedProfileId ?? identity.profileVersion,
              targetIds: [target.id],
              issues: [{ id: target.id, failure: integrityFailure }],
            },
          ];
          metrics.failedIds = [...(metrics.failedIds ?? []), target.id];
          continue;
        }
        const now = Date.now();
        const entry = {
          key: target.semanticKey,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          sourceText: target.sourceText,
          translatedText: translation.target,
          kind: target.kind,
          slot: target.slot,
          contextClass: target.contextClass,
          provider: identity.provider,
          model: identity.model,
          glossaryVersion: DEFAULT_GLOSSARY_VERSION,
          promptVersion: identity.promptVersion,
          profileVersion: identity.profileVersion,
          normalizationVersion: WEBPAGE_NORMALIZATION_VERSION,
          createdAt: now,
          lastUsedAt: now,
        };
        await this.pageTranslationMemory.set(entry);
        results.set(target.id, {
          id: target.id,
          target: translation.target,
          cacheKey: target.semanticKey,
          cacheHit: false,
          provenance: 'provider',
        });
      }
    }

    const translations = targets.flatMap((target) => {
      const result = results.get(target.id);
      return result === undefined ? [] : [result];
    });
    metrics.failedIds = targets
      .filter((target) => !results.has(target.id))
      .map((target) => target.id);
    const derivedMetrics = deriveAttemptMetrics(metrics.attempts ?? []);
    metrics.retryCount = derivedMetrics.retryCount;
    metrics.validationFailures = derivedMetrics.validationFailures;
    return { translations, metrics };
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
        const activeProfile = getActiveLLMProfile(this.config.llmTranslator);
        const llmScheduler = new LLMScheduler(
          translator,
          {
            translateRetryAttemptLimit: this.config.scheduler.translateRetryAttemptLimit,
            directTranslateLength: this.config.scheduler.directTranslateLength,
            translatePoolDelay: this.config.scheduler.translatePoolDelay,
            chunkSizeForInstantTranslate:
              this.config.scheduler.chunkSizeForInstantTranslate,
            pageMaxConcurrentRequests: activeProfile.maxConcurrentRequests ?? 12,
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

  private getPageTranslationIdentity(): {
    provider: string;
    model: string;
    promptVersion: string;
    profileVersion: string;
  } {
    if ((this.getTranslatorClass() as unknown) === LLMTranslator) {
      const profile = getActiveLLMProfile(this.config.llmTranslator);
      const resolved = resolveTranslationModelProfile(profile, null).profile;
      return {
        provider: profile.provider,
        model: profile.model,
        promptVersion: resolved.promptVersion,
        profileVersion: getLLMCacheId(profile),
      };
    }
    return {
      provider: this.config.translatorModule,
      model: this.config.translatorModule,
      promptVersion: 'non-llm-page-v1',
      profileVersion: 'non-llm-translator-v1',
    };
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
