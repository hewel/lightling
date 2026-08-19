import { getLanguageCodesISO639 } from 'anylang/languages';
import { LLMFetcher } from 'anylang/translators';
// Base class is not re-exported from the package index; anylang has no exports map, so the deep path resolves
import { LLMTranslator as BaseLLMTranslator } from 'anylang/translators/LLMTranslators/LLMTranslator';
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
};

/**
 * Resolve the profile to translate with: the active one, or the first as a fallback
 */
export const getActiveLLMProfile = (config: LLMTranslatorConfig): LLMProfile =>
  config.profiles.find((profile) => profile.name === config.activeProfile) ??
  config.profiles[0] ??
  emptyProfile;

/**
 * Fetches translations from an LLM API via the Effect AI client of the profile's provider
 */
class EffectLLMFetcher implements LLMFetcher {
  constructor(private readonly profile: LLMProfile) {}

  getLengthLimit = () => 5000;
  getRequestsTimeout = () => 500;

  fetch = (prompt: string): Promise<string> => {
    const { provider, apiUrl, apiKey, model } = this.profile;
    if (model === '') {
      return Promise.reject(new Error('LLM translator model is not configured'));
    }

    // Empty values resolve to provider defaults: no auth header for an empty key
    const clientOptions = {
      apiUrl: apiUrl === '' ? undefined : apiUrl,
      apiKey: apiKey === '' ? undefined : Redacted.make(apiKey),
    };

    const request = LanguageModel.generateText({ prompt, toolChoice: 'none' }).pipe(
      Effect.map((response) => response.text),
    );

    const program = (() => {
      switch (provider) {
        case 'anthropic':
          return request.pipe(
            Effect.provide(AnthropicLanguageModel.model(model)),
            Effect.provide(AnthropicClient.layer(clientOptions)),
          );
        case 'openrouter':
          return request.pipe(
            Effect.provide(OpenRouterLanguageModel.model(model)),
            Effect.provide(OpenRouterClient.layer(clientOptions)),
          );
        case 'openai':
          return request.pipe(
            Effect.provide(OpenAiLanguageModel.model(model)),
            Effect.provide(OpenAiClient.layer(clientOptions)),
          );
        case 'openai-compatible':
          return request.pipe(
            Effect.provide(OpenAiCompatLanguageModel.model(model)),
            Effect.provide(OpenAiCompatClient.layer(clientOptions)),
          );
      }
    })().pipe(Effect.provide(FetchHttpClient.layer));

    return Effect.runPromise(program);
  };
}

/**
 * Translator powered by an arbitrary LLM API
 */
export class LLMTranslator extends BaseLLMTranslator {
  static translatorName = getMessage('common_llmTranslator');
  static isRequiredKey = () => false;
  static isSupportedAutoFrom = () => true;
  static getSupportedLanguages = () => getLanguageCodesISO639('v1');

  constructor(config: LLMTranslatorConfig) {
    super(new EffectLLMFetcher(getActiveLLMProfile(config)));
  }
}
