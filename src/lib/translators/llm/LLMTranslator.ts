import { getLanguageCodesISO639 } from 'anylang/languages';
import { LLMFetcher } from 'anylang/translators';
// Base class is not re-exported from the package index; anylang has no exports map, so the deep path resolves
import { LLMTranslator as BaseLLMTranslator } from 'anylang/translators/LLMTranslators/LLMTranslator';
import { Effect, Redacted } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';
import { FetchHttpClient } from 'effect/unstable/http';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai-compat';

import { AppConfigType } from '@/types/runtime';

import { getMessage } from '../../language';

export type LLMTranslatorConfig = AppConfigType['llmTranslator'];

/**
 * Fetches translations from an OpenAI-compatible API via the Effect AI client
 */
class EffectLLMFetcher implements LLMFetcher {
  constructor(private readonly config: LLMTranslatorConfig) {}

  getLengthLimit = () => 5000;
  getRequestsTimeout = () => 500;

  fetch = (prompt: string): Promise<string> => {
    const { apiUrl, apiKey, model } = this.config;
    if (model === '') {
      return Promise.reject(new Error('LLM translator model is not configured'));
    }

    const program = LanguageModel.generateText({ prompt, toolChoice: 'none' }).pipe(
      Effect.map((response) => response.text),
      Effect.provide(OpenAiLanguageModel.model(model)),
      Effect.provide(
        OpenAiClient.layer({
          apiUrl: apiUrl === '' ? undefined : apiUrl,
          apiKey: apiKey === '' ? undefined : Redacted.make(apiKey),
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    );

    return Effect.runPromise(program);
  };
}

/**
 * Translator powered by an arbitrary OpenAI-compatible LLM API
 */
export class LLMTranslator extends BaseLLMTranslator {
  static translatorName = getMessage('common_llmTranslator');
  static isRequiredKey = () => false;
  static isSupportedAutoFrom = () => true;
  static getSupportedLanguages = () => getLanguageCodesISO639('v1');

  constructor(config: LLMTranslatorConfig) {
    super(new EffectLLMFetcher(config));
  }
}
