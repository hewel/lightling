import { getLanguageCodesISO639 } from 'anylang/languages';
import type { TranslatorInstanceMembers } from 'anylang/translators';
import { Effect, Layer, Redacted, Schema } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import {
  OpenAiClient as OpenAiCompatClient,
  OpenAiLanguageModel as OpenAiCompatLanguageModel,
} from '@effect/ai-openai-compat';
import { OpenRouterClient, OpenRouterLanguageModel } from '@effect/ai-openrouter';

import type {
  PageTranslationAttemptMetrics,
  PageTranslationBatchRequest,
} from '@/lib/pageTranslation/protocol';
import { createUUID } from '@/lib/utils';
import {
  DEFAULT_ADAPTIVE_BATCHING,
  DEFAULT_LLM_FALLBACK_PROFILE,
  DEFAULT_TRANSLATION_PROFILE_OVERRIDES,
  DEFAULT_TRANSLATION_QUALITY_MODE,
  type AppConfigType,
} from '@/types/runtime';

import { getMessage } from '../../language';

import { mapTranslationInferenceRequest } from './inference';
import type { LLMBatchRequestOptions } from './LLMBatchTranslator';
import {
  InvalidLLMResponseError,
  LLMTranslationEngine,
  type LLMRequest,
  type LLMRequestEffect,
} from './LLMTranslationEngine';
import {
  resolveLLMProfileConnection,
  type ResolvedLLMExecutionSettings,
} from './modelInfo';
import { loadLLMExecutionSettingsCached } from './modelListCache';
import { validateFallbackProfiles, type ConfiguredLLMProfile } from './modelProfile';

export type LLMTranslatorConfig = AppConfigType['llmTranslator'];
export type LLMProfile = ConfiguredLLMProfile;
export type LLMProvider = LLMProfile['provider'];

/**
 * Fallback used when no profile is configured; an empty model fails fast with a descriptive error
 */
const emptyProfile: LLMProfile = {
  name: '',
  provider: 'openai-compatible',
  apiUrl: '',
  apiKey: '',
  model: '',
  contextWindowTokens: null,
  preferredInputTokens: null,
  maxOutputTokens: null,
  maxConcurrentRequests: null,
  qualityMode: DEFAULT_TRANSLATION_QUALITY_MODE,
  fallbackProfile: DEFAULT_LLM_FALLBACK_PROFILE,
  adaptiveBatching: DEFAULT_ADAPTIVE_BATCHING,
  translationProfile: structuredClone(DEFAULT_TRANSLATION_PROFILE_OVERRIDES),
};

/**
 * Resolve the profile to translate with: the active one, or the first as a fallback
 */
export const getActiveLLMProfile = (config: LLMTranslatorConfig): LLMProfile =>
  config.profiles.find((profile) => profile.name === config.activeProfile) ??
  config.profiles[0] ??
  emptyProfile;

/**
 * Translator powered by an arbitrary LLM API.
 *
 * The engine safely chunks arbitrary input and owns request pacing, so the
 * generic scheduler limits (getLengthLimit/getRequestsTimeout) are deliberately
 * disabled. Do not reintroduce the generic scheduler for LLM profiles.
 */
export class LLMTranslator implements TranslatorInstanceMembers {
  static translatorName = getMessage('common_llmTranslator');
  static isRequiredKey = () => false;
  static isSupportedAutoFrom = () => true;
  static getSupportedLanguages = () => getLanguageCodesISO639('v1');

  private readonly profile: LLMProfile;
  private readonly engine: LLMTranslationEngine;
  private resolvedSettings: ResolvedLLMExecutionSettings | null = null;
  private readonly config: LLMTranslatorConfig;
  private readonly translatorOptions: {
    onTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  };

  constructor(
    config: LLMTranslatorConfig,
    options: {
      onTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    } = {},
  ) {
    this.config = config;
    this.translatorOptions = options;
    const selectedProfile = getActiveLLMProfile(config);
    const configurationWarnings = validateFallbackProfiles(config.profiles);
    this.profile =
      configurationWarnings.length > 0 &&
      selectedProfile.fallbackProfile !== undefined &&
      selectedProfile.fallbackProfile !== null
        ? { ...selectedProfile, fallbackProfile: null }
        : selectedProfile;
    if (configurationWarnings.length > 0) {
      console.warn('[llm-translation-profile] invalid fallback configuration', {
        profile: selectedProfile.name,
        warnings: configurationWarnings,
      });
    }
    const settingsPromise = loadLLMExecutionSettingsCached(this.profile).then(
      (settings) => {
        this.resolvedSettings = settings;
        if (
          this.profile.translationProfile?.debug &&
          settings.profileWarnings.length > 0
        ) {
          console.debug('[llm-translation-profile]', {
            profile: settings.translationProfile.id,
            provider: settings.translationProfile.providerId,
            model: settings.translationProfile.modelId,
            warnings: settings.profileWarnings,
          });
        }
        return settings;
      },
    );
    this.engine = new LLMTranslationEngine({
      loadSettings: () => settingsPromise,
      fetch: (request) => this.buildFetchEffect(request),
      onUsage: options.onTokenUsage,
    });
  }

  public translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string> {
    return this.translateBatch([text], sourceLanguage, targetLanguage).then(
      (results) => results[0],
    );
  }

  public translateBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<string[]> {
    return this.translateBatchWithOptions(texts, sourceLanguage, targetLanguage, {
      context: createUUID(),
      priority: 0,
      retryLimit: 2,
    });
  }

  public translateBatchWithOptions(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    options: LLMBatchRequestOptions,
  ): Promise<string[]> {
    if (this.profile.model === '') {
      return Promise.reject(new Error('LLM translator model is not configured'));
    }
    return this.engine.translateBatch(texts, sourceLanguage, targetLanguage, {
      ...options,
      isolateInvalidBatches: true,
    });
  }

  public async translatePageBatch(
    request: PageTranslationBatchRequest,
    options: LLMBatchRequestOptions,
    onMetrics?: (metrics: PageTranslationAttemptMetrics) => void,
  ): Promise<{ id: string; target: string }[]> {
    if (this.profile.model === '') {
      throw new Error('LLM translator model is not configured');
    }

    const fallbackName = this.profile.fallbackProfile;
    const fallback =
      fallbackName === null || fallbackName === this.profile.name
        ? undefined
        : this.config.profiles.find((candidate) => candidate.name === fallbackName);
    const translateFallback = async (
      targets: PageTranslationBatchRequest['targets'],
    ): Promise<{ id: string; target: string }[]> => {
      if (fallback === undefined || targets.length === 0) return [];
      onMetrics?.({ retryCount: 1, validationFailures: 0 });
      const fallbackTranslator = new LLMTranslator(
        {
          activeProfile: fallback.name,
          profiles: [{ ...fallback, fallbackProfile: null }],
        },
        this.translatorOptions,
      );
      try {
        return await fallbackTranslator.translatePageBatch(
          { ...request, targets },
          options,
          onMetrics,
        );
      } finally {
        fallbackTranslator.dispose();
      }
    };

    let translated: { id: string; target: string }[];
    try {
      translated = await this.engine.translatePageBatch(
        request,
        {
          ...options,
          isolateInvalidBatches: true,
        },
        onMetrics,
      );
    } catch (error) {
      if (!Schema.is(InvalidLLMResponseError)(error) || fallback === undefined) {
        throw error;
      }
      return translateFallback(request.targets);
    }

    const translatedIds = new Set(translated.map((item) => item.id));
    const missingTargets = request.targets.filter(
      (target) => !translatedIds.has(target.id),
    );
    const fallbackTranslations = await translateFallback(missingTargets);
    if (fallbackTranslations.length === 0) return translated;

    const merged = new Map(
      [...translated, ...fallbackTranslations].map((item) => [item.id, item]),
    );
    const result = request.targets.flatMap((target) => {
      const item = merged.get(target.id);
      return item === undefined ? [] : [item];
    });
    const resolvedIds = new Set(result.map((item) => item.id));
    onMetrics?.({
      retryCount: 0,
      validationFailures: 0,
      failedIds: request.targets
        .filter((target) => !resolvedIds.has(target.id))
        .map((target) => target.id),
    });
    return result;
  }

  public abort(context: string): void {
    this.engine.abort(context);
  }

  public dispose(): void {
    this.engine.dispose();
  }

  public checkLimitExceeding(): number {
    return 0;
  }

  public getLengthLimit(): number {
    return Number.MAX_SAFE_INTEGER;
  }

  public getRequestsTimeout(): number {
    return 0;
  }

  private buildFetchEffect(request: LLMRequest): LLMRequestEffect {
    const { provider, apiUrl, apiKey, model } = resolveLLMProfileConnection(this.profile);
    const clientOptions = {
      apiUrl,
      apiKey: apiKey === undefined ? undefined : Redacted.make(apiKey),
    };

    const settings = this.resolvedSettings;
    if (settings === null) {
      return Effect.die(new Error('LLM execution settings are not loaded'));
    }
    const mapping = mapTranslationInferenceRequest(
      provider,
      settings.translationProfile,
      request,
      settings.supportedParameters,
    );
    const baseEffect =
      mapping.structuredGeneration && request.responseSchema !== undefined
        ? LanguageModel.generateObject({
            prompt: request.messages,
            schema: request.responseSchema,
            objectName: 'page_translations',
            toolChoice: 'none',
          }).pipe(
            Effect.map((response) => ({
              text: JSON.stringify(response.value),
              usage: {
                inputTokens: response.usage.inputTokens.total ?? null,
                outputTokens: response.usage.outputTokens.total ?? null,
              },
            })),
          )
        : LanguageModel.generateText({
            prompt: request.messages,
            toolChoice: 'none',
          }).pipe(
            Effect.map((response) => ({
              text: response.text,
              usage: {
                inputTokens: response.usage.inputTokens.total ?? null,
                outputTokens: response.usage.outputTokens.total ?? null,
              },
            })),
          );

    const config = mapping.generationConfig;

    const modelEffect = (() => {
      switch (provider) {
        case 'anthropic':
          return baseEffect.pipe(
            Effect.provide(
              Layer.provide(
                AnthropicLanguageModel.model(model, config),
                AnthropicClient.layer(clientOptions),
              ),
            ),
          );
        case 'openrouter':
          return baseEffect.pipe(
            Effect.provide(
              Layer.provide(
                OpenRouterLanguageModel.model(model, config),
                OpenRouterClient.layer(clientOptions),
              ),
            ),
          );
        case 'openai':
          return baseEffect.pipe(
            Effect.provide(
              Layer.provide(
                OpenAiLanguageModel.model(model, config),
                OpenAiClient.layer(clientOptions),
              ),
            ),
          );
        case 'openai-compatible':
          return baseEffect.pipe(
            Effect.provide(
              Layer.provide(
                OpenAiCompatLanguageModel.model(model, config),
                OpenAiCompatClient.layer(clientOptions),
              ),
            ),
          );
      }
    })();

    return modelEffect.pipe(Effect.provide(FetchHttpClient.layer));
  }
}
