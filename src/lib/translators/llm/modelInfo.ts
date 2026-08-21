import { Result, Schema } from 'effect';

import {
  getRegisteredTranslationModelPatch,
  resolveTranslationModelProfile,
  type ConfiguredLLMProfile,
  type LLMProvider,
  type TranslationModelProfile,
} from './modelProfile';
import { resolveTranslationTokenizer, type TranslationTokenCounter } from './tokenizer';

export const DEFAULT_LLM_API_URL = 'https://api.openai.com/v1';

/**
 * Conservative limits applied when neither an override nor provider metadata exists
 */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 4096;
export const FALLBACK_PREFERRED_INPUT_TOKENS = 1200;
export const FALLBACK_MAX_CONCURRENT_REQUESTS = 2;

const MODEL_LIST_TIMEOUT_MS = 5000;

const providerDefaults: Record<
  LLMProvider,
  {
    apiUrl: string;
    modelsPath: string;
    authHeader: (apiKey: string) => Record<string, string>;
  }
> = {
  openai: {
    apiUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    apiUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    authHeader: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
  openrouter: {
    apiUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
  'openai-compatible': {
    apiUrl: DEFAULT_LLM_API_URL,
    modelsPath: '/models',
    authHeader: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
  },
};

export interface LLMModelInfo {
  id: string;
  displayName: string;
  contextWindowTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  supportedParameters: readonly string[] | null;
  tokenizerId: string | null;
  supportsPrefixCaching: boolean | null;
  contextWindowSource: 'provider' | 'known-model' | null;
  maxInputSource: 'provider' | null;
  maxOutputSource: 'provider' | 'known-model' | null;
}

export interface ResolvedLLMExecutionSettings {
  contextWindowTokens: number;
  contextWindowSource: 'override' | 'provider' | 'known-model' | 'fallback';
  preferredInputTokens: number;
  preferredInputSource: 'override' | 'fallback';
  maxInputTokens: number | null;
  maxInputSource: 'provider' | null;
  maxOutputTokens: number | null;
  maxOutputSource: 'override' | 'provider' | 'known-model' | null;
  maxConcurrentRequests: number;
  concurrencySource: 'override' | 'fallback';
  supportedParameters: readonly string[] | null;
  translationProfile: TranslationModelProfile;
  tokenCounter: TranslationTokenCounter;
  profileWarnings: readonly string[];
}

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const positiveTokenCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;

/**
 * The smallest positive value wins when two provider fields constrain the same hard limit
 */
const minPositive = (...values: (number | null)[]): number | null => {
  let result: number | null = null;
  for (const value of values) {
    if (value !== null && (result === null || value < result)) result = value;
  }
  return result;
};

const stringRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const supportedParameterList = (value: unknown): readonly string[] | null =>
  Array.isArray(value)
    ? value.filter((parameter): parameter is string => typeof parameter === 'string')
    : null;

const tokenizerIdentifier = (...values: unknown[]): string | null => {
  const supported = new Set(['o200k_base', 'cl100k_base', 'p50k_base', 'r50k_base']);
  for (const value of values) {
    if (typeof value === 'string' && supported.has(value)) return value;
  }
  return null;
};

const optionalBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const ModelListEnvelope = Schema.Struct({ data: Schema.Array(Schema.Unknown) });

const OpenRouterModelEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.Unknown),
  context_length: Schema.optional(Schema.Unknown),
  per_request_limits: Schema.optional(Schema.Unknown),
  top_provider: Schema.optional(Schema.Unknown),
  supported_parameters: Schema.optional(Schema.Unknown),
  architecture: Schema.optional(Schema.Unknown),
  supports_implicit_caching: Schema.optional(Schema.Unknown),
});

const AnthropicModelEntry = Schema.Struct({
  id: Schema.String,
  display_name: Schema.optional(Schema.Unknown),
  supported_parameters: Schema.optional(Schema.Unknown),
  tokenizer: Schema.optional(Schema.Unknown),
  tokenizer_id: Schema.optional(Schema.Unknown),
});

const OpenAiModelEntry = Schema.Struct({
  id: Schema.String,
  display_name: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  context_length: Schema.optional(Schema.Unknown),
  max_input_tokens: Schema.optional(Schema.Unknown),
  max_completion_tokens: Schema.optional(Schema.Unknown),
  max_output_tokens: Schema.optional(Schema.Unknown),
  supported_parameters: Schema.optional(Schema.Unknown),
  tokenizer: Schema.optional(Schema.Unknown),
  tokenizer_id: Schema.optional(Schema.Unknown),
});

/**
 * Decode one provider-specific model entry. Malformed optional metadata becomes
 * `null` without dropping a valid ID.
 */
const decodeModelEntry = (provider: LLMProvider, entry: unknown): LLMModelInfo | null => {
  switch (provider) {
    case 'openrouter': {
      const result = Schema.decodeUnknownResult(OpenRouterModelEntry)(entry);
      if (!Result.isSuccess(result)) return null;

      const model = result.success;
      const perRequestLimits = stringRecord(model.per_request_limits);
      const topProvider = stringRecord(model.top_provider);
      const architecture = stringRecord(model.architecture);
      const supportedParameters = supportedParameterList(model.supported_parameters);

      return {
        id: model.id,
        displayName: nonEmptyString(model.name) ?? model.id,
        contextWindowTokens: minPositive(
          positiveTokenCount(model.context_length),
          positiveTokenCount(topProvider?.context_length),
        ),
        maxInputTokens: positiveTokenCount(perRequestLimits?.prompt_tokens),
        maxOutputTokens: minPositive(
          positiveTokenCount(perRequestLimits?.completion_tokens),
          positiveTokenCount(topProvider?.max_completion_tokens),
        ),
        supportedParameters,
        tokenizerId: tokenizerIdentifier(architecture?.tokenizer),
        supportsPrefixCaching: optionalBoolean(model.supports_implicit_caching),
        contextWindowSource: null,
        maxInputSource: null,
        maxOutputSource: null,
      };
    }
    case 'anthropic': {
      const result = Schema.decodeUnknownResult(AnthropicModelEntry)(entry);
      if (!Result.isSuccess(result)) return null;

      const model = result.success;
      return {
        id: model.id,
        displayName: nonEmptyString(model.display_name) ?? model.id,
        contextWindowTokens: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        supportedParameters: supportedParameterList(model.supported_parameters),
        tokenizerId: tokenizerIdentifier(model.tokenizer_id, model.tokenizer),
        supportsPrefixCaching: null,
        contextWindowSource: null,
        maxInputSource: null,
        maxOutputSource: null,
      };
    }
    case 'openai':
    case 'openai-compatible': {
      const result = Schema.decodeUnknownResult(OpenAiModelEntry)(entry);
      if (!Result.isSuccess(result)) return null;

      const model = result.success;
      return {
        id: model.id,
        displayName:
          nonEmptyString(model.display_name) ?? nonEmptyString(model.name) ?? model.id,
        contextWindowTokens: positiveTokenCount(model.context_length),
        maxInputTokens: positiveTokenCount(model.max_input_tokens),
        maxOutputTokens: minPositive(
          positiveTokenCount(model.max_completion_tokens),
          positiveTokenCount(model.max_output_tokens),
        ),
        supportedParameters: supportedParameterList(model.supported_parameters),
        tokenizerId: tokenizerIdentifier(model.tokenizer_id, model.tokenizer),
        supportsPrefixCaching: null,
        contextWindowSource: null,
        maxInputSource: null,
        maxOutputSource: null,
      };
    }
  }
};

/**
 * Fill capability fields the provider did not report from exact known-model metadata
 */
const applyKnownModel = (info: LLMModelInfo): LLMModelInfo => {
  const known = getRegisteredTranslationModelPatch(info.id);
  if (known === null) return info;

  const result = { ...info };
  if (result.contextWindowTokens === null && known.contextWindow !== undefined) {
    result.contextWindowTokens = known.contextWindow;
    result.contextWindowSource = 'known-model';
  }
  if (result.maxOutputTokens === null && known.maximumOutputTokens !== undefined) {
    result.maxOutputTokens = known.maximumOutputTokens;
    result.maxOutputSource = 'known-model';
  }
  return result;
};

const withProviderSources = (info: LLMModelInfo): LLMModelInfo => ({
  ...info,
  contextWindowSource: info.contextWindowTokens !== null ? 'provider' : null,
  maxInputSource: info.maxInputTokens !== null ? 'provider' : null,
  maxOutputSource: info.maxOutputTokens !== null ? 'provider' : null,
});

/**
 * Effective API base URL: provider default for an empty value, without trailing slashes
 */
export const getEffectiveLLMApiUrl = (
  profile: Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl'>,
): string =>
  (profile.apiUrl === ''
    ? providerDefaults[profile.provider].apiUrl
    : profile.apiUrl
  ).replace(/\/+$/, '');

/**
 * Identity of a discovery result; any change invalidates fetched model metadata
 */
export const getLLMDiscoveryIdentity = (
  profile: Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl' | 'apiKey'>,
): string =>
  JSON.stringify([profile.provider, getEffectiveLLMApiUrl(profile), profile.apiKey]);

export type LLMResolvedProfile = {
  provider: ConfiguredLLMProfile['provider'];
  apiUrl: string | undefined;
  apiKey: string | undefined;
  model: ConfiguredLLMProfile['model'];
};

export const createLLMClientOptions = (
  profile: Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl' | 'apiKey'>,
): { apiUrl?: string; apiKey?: string } => ({
  ...(profile.apiUrl === '' ? {} : { apiUrl: profile.apiUrl }),
  ...(profile.apiKey === '' ? {} : { apiKey: profile.apiKey }),
});

export const resolveLLMProfileConnection = (
  profile: Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl' | 'apiKey' | 'model'>,
): LLMResolvedProfile => {
  const clientOptions = createLLMClientOptions(profile);

  return {
    provider: profile.provider,
    apiUrl:
      clientOptions.apiUrl === undefined ? undefined : getEffectiveLLMApiUrl(profile),
    apiKey: clientOptions.apiKey,
    model: profile.model,
  };
};

/**
 * Fetch metadata of models available at the profile's API, sorted by ID.
 * Every supported provider exposes an OpenAI-style `GET {apiUrl}/models` listing;
 * only the base URL, auth header, and entry shape differ.
 */
export const fetchLLMModels = async (
  profile: Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl' | 'apiKey'>,
): Promise<LLMModelInfo[]> => {
  const defaults = providerDefaults[profile.provider];
  const baseUrl = getEffectiveLLMApiUrl(profile);

  const response = await fetch(`${baseUrl}${defaults.modelsPath}`, {
    headers: profile.apiKey === '' ? {} : defaults.authHeader(profile.apiKey),
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch a model list: HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const envelope = Schema.decodeUnknownResult(ModelListEnvelope)(payload);
  if (!Result.isSuccess(envelope)) {
    throw new Error('Invalid model list response');
  }

  return envelope.success.data
    .map((entry) => decodeModelEntry(profile.provider, entry))
    .filter((info): info is LLMModelInfo => info !== null)
    .map((info) => applyKnownModel(withProviderSources(info)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/**
 * Single precedence function for execution settings, shared by UI and runtime:
 * manual override, then selected provider metadata, then exact known-model
 * metadata, then conservative fallbacks.
 */
export const resolveLLMExecutionSettings = (
  profile: ConfiguredLLMProfile,
  modelInfo: LLMModelInfo | null,
): ResolvedLLMExecutionSettings => {
  const known = getRegisteredTranslationModelPatch(profile.model);

  const contextWindow = ((): Pick<
    ResolvedLLMExecutionSettings,
    'contextWindowTokens' | 'contextWindowSource'
  > => {
    if (profile.contextWindowTokens !== null) {
      return {
        contextWindowTokens: profile.contextWindowTokens,
        contextWindowSource: 'override',
      };
    }
    if (modelInfo !== null && modelInfo.contextWindowTokens !== null) {
      return {
        contextWindowTokens: modelInfo.contextWindowTokens,
        contextWindowSource: modelInfo.contextWindowSource ?? 'provider',
      };
    }
    if (known?.contextWindow !== undefined) {
      return {
        contextWindowTokens: known.contextWindow,
        contextWindowSource: 'known-model',
      };
    }
    return {
      contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
      contextWindowSource: 'fallback',
    };
  })();

  const maxOutput = ((): Pick<
    ResolvedLLMExecutionSettings,
    'maxOutputTokens' | 'maxOutputSource'
  > => {
    const candidates: {
      value: number;
      source: 'override' | 'provider' | 'known-model';
    }[] = [];
    if (profile.maxOutputTokens !== null) {
      candidates.push({ value: profile.maxOutputTokens, source: 'override' });
    }
    if (modelInfo !== null && modelInfo.maxOutputTokens !== null) {
      candidates.push({
        value: modelInfo.maxOutputTokens,
        source: modelInfo.maxOutputSource ?? 'provider',
      });
    }
    if (known?.maximumOutputTokens !== undefined) {
      candidates.push({
        value: known.maximumOutputTokens,
        source: 'known-model',
      });
    }
    if (candidates.length === 0) {
      return { maxOutputTokens: null, maxOutputSource: null };
    }
    const winner = candidates.reduce((a, b) => (b.value < a.value ? b : a));
    return { maxOutputTokens: winner.value, maxOutputSource: winner.source };
  })();

  const metadata =
    modelInfo === null
      ? null
      : {
          contextWindowTokens: modelInfo.contextWindowTokens,
          maxOutputTokens: modelInfo.maxOutputTokens,
          tokenizerId: modelInfo.tokenizerId,
          supportedParameters: modelInfo.supportedParameters,
          supportsPrefixCaching: modelInfo.supportsPrefixCaching,
        };
  const profileResolution = resolveTranslationModelProfile(profile, metadata);
  const tokenizerResolution = resolveTranslationTokenizer(profile, metadata);
  const translationProfile = {
    ...profileResolution.profile,
    tokenizerId: tokenizerResolution.counter.id,
    tokenizerSource: tokenizerResolution.source,
    safetyReserveTokens:
      tokenizerResolution.counter.accuracy === 'estimate'
        ? Math.max(profileResolution.profile.safetyReserveTokens, 640)
        : profileResolution.profile.safetyReserveTokens,
  };
  const profileWarnings = [
    ...profileResolution.warnings,
    ...(tokenizerResolution.warning === undefined ? [] : [tokenizerResolution.warning]),
  ];

  return {
    ...contextWindow,
    preferredInputTokens: profile.preferredInputTokens ?? FALLBACK_PREFERRED_INPUT_TOKENS,
    preferredInputSource: profile.preferredInputTokens !== null ? 'override' : 'fallback',
    maxInputTokens: modelInfo?.maxInputTokens ?? null,
    maxInputSource:
      modelInfo !== null && modelInfo.maxInputTokens !== null ? 'provider' : null,
    ...maxOutput,
    maxConcurrentRequests:
      profile.maxConcurrentRequests ?? FALLBACK_MAX_CONCURRENT_REQUESTS,
    concurrencySource: profile.maxConcurrentRequests !== null ? 'override' : 'fallback',
    supportedParameters: modelInfo?.supportedParameters ?? null,
    translationProfile,
    tokenCounter: tokenizerResolution.counter,
    profileWarnings: Array.from(new Set(profileWarnings)),
  };
};

/**
 * Best-effort runtime discovery of execution settings. Only OpenRouter and
 * OpenAI-compatible lists carry limits; OpenAI and Anthropic lists contain no
 * limits, so they resolve from known-model metadata and defaults without a
 * request. Discovery failure never rejects.
 */
export const loadLLMExecutionSettings = async (
  profile: ConfiguredLLMProfile,
): Promise<ResolvedLLMExecutionSettings> => {
  const isDiscoverable =
    profile.provider === 'openrouter' || profile.provider === 'openai-compatible';

  let modelInfo: LLMModelInfo | null = null;
  if (isDiscoverable) {
    try {
      const models = await fetchLLMModels(profile);
      modelInfo = models.find((model) => model.id === profile.model) ?? null;
    } catch {
      // Timeout, transport, and decode failures fall back without failing translation
      modelInfo = null;
    }
  }

  return resolveLLMExecutionSettings(profile, modelInfo);
};
