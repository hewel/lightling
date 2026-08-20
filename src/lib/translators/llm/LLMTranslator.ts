import { getLanguageCodesISO639 } from 'anylang/languages';
import type { TranslatorInstanceMembers } from 'anylang/translators';
import { Effect, Redacted } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import {
  OpenAiClient as OpenAiCompatClient,
  OpenAiLanguageModel as OpenAiCompatLanguageModel,
} from '@effect/ai-openai-compat';
import { OpenRouterClient, OpenRouterLanguageModel } from '@effect/ai-openrouter';

import { AppConfigType } from '@/types/runtime';

import { getMessage } from '../../language';

import {
  LLMTranslationEngine,
  type LLMRequest,
  type LLMRequestEffect,
  type TranslateBatchOptions,
} from './LLMTranslationEngine';
import {
  getEffectiveLLMApiUrl,
  loadLLMExecutionSettings,
  type ResolvedLLMExecutionSettings,
} from './modelInfo';

export type LLMTranslatorConfig = AppConfigType['llmTranslator'];
export type LLMProfile = LLMTranslatorConfig['profiles'][number];
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
};

/**
 * Resolve the profile to translate with: the active one, or the first as a fallback
 */
export const getActiveLLMProfile = (config: LLMTranslatorConfig): LLMProfile =>
  config.profiles.find((profile) => profile.name === config.activeProfile) ??
  config.profiles[0] ??
  emptyProfile;

const isOpenAiTemperatureOmittedModel = (model: string): boolean => {
  if (model.startsWith('o1')) return true;
  if (model.startsWith('o3')) return true;
  if (model.startsWith('o4-mini')) return true;
  if (model.startsWith('codex-mini')) return true;
  if (model.startsWith('computer-use-preview')) return true;
  if (model.startsWith('gpt-5') && !model.includes('chat')) return true;
  return false;
};

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

  constructor(
    config: LLMTranslatorConfig,
    options: {
      onTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    } = {},
  ) {
    this.profile = getActiveLLMProfile(config);
    const settingsPromise = loadLLMExecutionSettings(this.profile).then((settings) => {
      this.resolvedSettings = settings;
      return settings;
    });
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
      context: crypto.randomUUID(),
      priority: 0,
      retryLimit: 2,
      isolateInvalidBatches: true,
    });
  }

  public translateBatchWithOptions(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    options: TranslateBatchOptions,
  ): Promise<string[]> {
    if (this.profile.model === '') {
      return Promise.reject(new Error('LLM translator model is not configured'));
    }
    return this.engine.translateBatch(texts, sourceLanguage, targetLanguage, options);
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
    const { provider, apiUrl, apiKey, model } = this.profile;
    const clientOptions = {
      apiUrl: apiUrl === '' ? undefined : apiUrl,
      apiKey: apiKey === '' ? undefined : Redacted.make(apiKey),
    };

    const baseEffect = LanguageModel.generateText({
      prompt: request.prompt,
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

    const config = this.buildProviderConfig(provider, model, request.maxOutputTokens);

    const modelEffect = (() => {
      switch (provider) {
        case 'anthropic':
          return baseEffect.pipe(
            Effect.provide(AnthropicLanguageModel.model(model, config)),
            Effect.provide(AnthropicClient.layer(clientOptions)),
          );
        case 'openrouter':
          return baseEffect.pipe(
            Effect.provide(OpenRouterLanguageModel.model(model, config)),
            Effect.provide(OpenRouterClient.layer(clientOptions)),
          );
        case 'openai':
          return baseEffect.pipe(
            Effect.provide(OpenAiLanguageModel.model(model, config)),
            Effect.provide(OpenAiClient.layer(clientOptions)),
          );
        case 'openai-compatible':
          return baseEffect.pipe(
            Effect.provide(OpenAiCompatLanguageModel.model(model, config)),
            Effect.provide(OpenAiCompatClient.layer(clientOptions)),
          );
      }
    })();

    return modelEffect.pipe(Effect.provide(FetchHttpClient.layer));
  }

  private buildProviderConfig(
    provider: LLMProvider,
    model: string,
    maxOutputTokens: number,
  ): Record<string, unknown> {
    const supported = this.resolvedSettings?.supportedParameters ?? null;

    switch (provider) {
      case 'anthropic':
        return { max_tokens: maxOutputTokens, temperature: 0 };
      case 'openrouter': {
        const config: Record<string, unknown> = { max_tokens: maxOutputTokens };
        if (supported === null || supported.includes('temperature')) {
          config.temperature = 0;
        }
        return config;
      }
      case 'openai': {
        const config: Record<string, unknown> = { max_output_tokens: maxOutputTokens };
        if (!isOpenAiTemperatureOmittedModel(model)) {
          config.temperature = 0;
        }
        return config;
      }
      case 'openai-compatible': {
        const effectiveUrl = getEffectiveLLMApiUrl({
          provider,
          apiUrl: this.profile.apiUrl,
        });
        const config: Record<string, unknown> = {
          max_output_tokens: maxOutputTokens,
          temperature: 0,
        };
        // Ling-3.0 models are hybrid reasoning models; Ant Ling burns the whole
        // output budget on the reasoning chain when thinking is left enabled,
        // so the JSON array never materializes (finish_reason 'length'). The
        // docs scope `thinking` to flash, but tiny honors it too (verified).
        if (
          effectiveUrl === 'https://api.ant-ling.com/v1' &&
          model.startsWith('Ling-3.0-')
        ) {
          config.thinking = { type: 'disabled' };
        }
        return config;
      }
    }
  }
}
