import { Schema } from 'effect';
import type { Prompt } from 'effect/unstable/ai';

import type {
  LLMProvider,
  ReasoningMode,
  StructuredOutputMode,
  TranslationModelProfile,
} from './modelProfile';

export const TranslationObjectResponseSchema = Schema.Struct({
  translations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      target: Schema.String,
    }),
  ),
});

export const TranslationPairResponseSchema = Schema.Struct({
  translations: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
});

export type TranslationResponseSchema =
  | typeof TranslationObjectResponseSchema
  | typeof TranslationPairResponseSchema;

export interface TranslationInferenceRequest {
  modelProfileId: string;
  messages: Prompt.RawInput;
  responseSchema?: TranslationResponseSchema;
  structuredOutputMode: StructuredOutputMode;
  grammar?: string;
  maxOutputTokens: number;
  sampling: {
    temperature: number;
    topP: number;
    topK?: number;
  };
  penalties: {
    repetition?: number;
    presence?: number;
    frequency?: number;
  };
  seed?: number;
  stop?: string[];
  reasoningMode: ReasoningMode;
  signal: AbortSignal;
}

export interface ProviderInferenceMapping {
  generationConfig: Record<string, unknown>;
  structuredGeneration: boolean;
}

const parameterSupported = (
  supportedParameters: readonly string[] | null,
  name: string,
  providerDefault: boolean,
): boolean =>
  supportedParameters === null ? providerDefault : supportedParameters.includes(name);

const reasoningEffort = (mode: ReasoningMode): 'none' | 'minimal' | 'medium' => {
  switch (mode) {
    case 'disabled':
      return 'none';
    case 'minimal':
      return 'minimal';
    case 'normal':
      return 'medium';
  }
};

const applyReasoningControl = (
  config: Record<string, unknown>,
  profile: TranslationModelProfile,
  request: TranslationInferenceRequest,
): void => {
  if (
    !profile.capabilities.supportsReasoningControl ||
    profile.reasoningControl === undefined
  ) {
    return;
  }
  switch (profile.reasoningControl) {
    case 'reasoning-effort':
      if (profile.providerId === 'openai') {
        config.reasoning = { effort: reasoningEffort(request.reasoningMode) };
      } else {
        config.reasoning_effort = reasoningEffort(request.reasoningMode);
      }
      return;
    case 'enable-thinking':
      config.enable_thinking = request.reasoningMode !== 'disabled';
      return;
    case 'thinking-object':
      config.thinking =
        request.reasoningMode === 'disabled'
          ? { type: 'disabled' }
          : { type: 'adaptive' };
      if (profile.providerId === 'anthropic' && request.reasoningMode === 'minimal') {
        config.output_config = { effort: 'low' };
      }
  }
};

const applyStructuredOutput = (
  config: Record<string, unknown>,
  provider: LLMProvider,
  request: TranslationInferenceRequest,
  profile: TranslationModelProfile,
  supportedParameters: readonly string[] | null,
): boolean => {
  switch (request.structuredOutputMode) {
    case 'json-schema':
    case 'tool-call':
      return request.responseSchema !== undefined;
    case 'json-object':
      if (
        profile.capabilities.supportsJsonObjectMode &&
        parameterSupported(
          supportedParameters,
          'response_format',
          provider !== 'anthropic',
        )
      ) {
        config.response_format = { type: 'json_object' };
      }
      return false;
    case 'grammar':
      if (request.grammar === undefined || !profile.capabilities.supportsGrammar) {
        return false;
      }
      if (provider === 'openrouter') {
        config.response_format = {
          type: 'grammar',
          grammar: request.grammar,
        };
      } else if (
        provider === 'openai-compatible' &&
        parameterSupported(supportedParameters, 'grammar', false)
      ) {
        config.grammar = request.grammar;
      }
      return false;
    case 'prompt-only':
      return false;
  }
};

export const mapTranslationInferenceRequest = (
  provider: LLMProvider,
  profile: TranslationModelProfile,
  request: TranslationInferenceRequest,
  supportedParameters: readonly string[] | null,
): ProviderInferenceMapping => {
  const config: Record<string, unknown> = {};
  switch (provider) {
    case 'openai':
      config.max_output_tokens = request.maxOutputTokens;
      config.temperature = request.sampling.temperature;
      config.top_p = request.sampling.topP;
      if (profile.capabilities.supportsSeed && request.seed !== undefined) {
        config.seed = request.seed;
      }
      break;
    case 'anthropic':
      config.max_tokens = request.maxOutputTokens;
      config.temperature = request.sampling.temperature;
      config.top_p = request.sampling.topP;
      if (request.sampling.topK !== undefined) config.top_k = request.sampling.topK;
      if (
        profile.capabilities.supportsStopSequences &&
        request.stop !== undefined &&
        request.stop.length > 0
      ) {
        config.stop_sequences = request.stop;
      }
      break;
    case 'openrouter':
      config.max_tokens = request.maxOutputTokens;
      if (parameterSupported(supportedParameters, 'temperature', true)) {
        config.temperature = request.sampling.temperature;
      }
      if (parameterSupported(supportedParameters, 'top_p', true)) {
        config.top_p = request.sampling.topP;
      }
      if (
        request.sampling.topK !== undefined &&
        parameterSupported(supportedParameters, 'top_k', false)
      ) {
        config.top_k = request.sampling.topK;
      }
      if (
        request.penalties.repetition !== undefined &&
        parameterSupported(supportedParameters, 'repetition_penalty', false)
      ) {
        config.repetition_penalty = request.penalties.repetition;
      }
      if (
        request.penalties.presence !== undefined &&
        parameterSupported(supportedParameters, 'presence_penalty', false)
      ) {
        config.presence_penalty = request.penalties.presence;
      }
      if (
        request.penalties.frequency !== undefined &&
        parameterSupported(supportedParameters, 'frequency_penalty', false)
      ) {
        config.frequency_penalty = request.penalties.frequency;
      }
      if (
        request.seed !== undefined &&
        profile.capabilities.supportsSeed &&
        parameterSupported(supportedParameters, 'seed', false)
      ) {
        config.seed = request.seed;
      }
      if (
        request.stop !== undefined &&
        profile.capabilities.supportsStopSequences &&
        parameterSupported(supportedParameters, 'stop', false)
      ) {
        config.stop = request.stop;
      }
      break;
    case 'openai-compatible':
      config.max_output_tokens = request.maxOutputTokens;
      config.temperature = request.sampling.temperature;
      config.top_p = request.sampling.topP;
      if (
        request.sampling.topK !== undefined &&
        parameterSupported(supportedParameters, 'top_k', false)
      ) {
        config.top_k = request.sampling.topK;
      }
      if (request.penalties.repetition !== undefined) {
        if (parameterSupported(supportedParameters, 'repeat_penalty', false)) {
          config.repeat_penalty = request.penalties.repetition;
        } else if (parameterSupported(supportedParameters, 'repetition_penalty', false)) {
          config.repetition_penalty = request.penalties.repetition;
        }
      }
      if (
        request.penalties.presence !== undefined &&
        parameterSupported(supportedParameters, 'presence_penalty', false)
      ) {
        config.presence_penalty = request.penalties.presence;
      }
      if (
        request.penalties.frequency !== undefined &&
        parameterSupported(supportedParameters, 'frequency_penalty', false)
      ) {
        config.frequency_penalty = request.penalties.frequency;
      }
      if (
        request.seed !== undefined &&
        profile.capabilities.supportsSeed &&
        parameterSupported(supportedParameters, 'seed', false)
      ) {
        config.seed = request.seed;
      }
      if (
        request.stop !== undefined &&
        profile.capabilities.supportsStopSequences &&
        parameterSupported(supportedParameters, 'stop', false)
      ) {
        config.stop = request.stop;
      }
      break;
  }

  applyReasoningControl(config, profile, request);
  const structuredGeneration = applyStructuredOutput(
    config,
    provider,
    request,
    profile,
    supportedParameters,
  );
  return { generationConfig: config, structuredGeneration };
};
