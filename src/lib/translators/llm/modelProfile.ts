// cspell:ignore inclusionai
import type { AppConfigType } from '@/types/runtime';

export const TRANSLATION_MODEL_PROFILE_VERSION = 'translation-profile-v1';
export const TRANSLATION_PAGE_PROMPT_VERSION = 'page-v3';

export type ConfiguredLLMProfile = AppConfigType['llmTranslator']['profiles'][number];
export type LLMProvider = ConfiguredLLMProfile['provider'];
export type TranslationQualityMode = ConfiguredLLMProfile['qualityMode'];
export type PromptVariant = 'compact' | 'standard' | 'advanced';
export type StructuredOutputMode =
  | 'json-schema'
  | 'grammar'
  | 'tool-call'
  | 'json-object'
  | 'prompt-only';
export type ReasoningMode = 'disabled' | 'minimal' | 'normal';
export type ReasoningControl = 'reasoning-effort' | 'enable-thinking' | 'thinking-object';
export type TranslationResponseShape = 'pairs' | 'objects' | 'array';
export type ChatTemplateOwner = 'provider' | 'tokenizer' | 'application';

export interface TranslationGenerationSettings {
  temperature: number;
  topP: number;
  topK?: number;
  repetitionPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stop?: string[];
}

export interface TranslationBatchSettings {
  maxItems: number;
  maxSourceTokens: number;
  maxContextTokens: number;
  maxMemoryTokens: number;
  preferredSourceTokens: number;
  preferredItems: number;
  concurrency: number;
}

export interface TranslationRetrySettings {
  maxRetries: number;
  retryWithSmallerBatch: boolean;
  retryWithoutRetrievedContext: boolean;
  retryWithRicherLocalContext: boolean;
}

export interface TranslationModelCapabilities {
  supportsJsonSchema: boolean;
  supportsGrammar: boolean;
  supportsToolCalling: boolean;
  supportsJsonObjectMode: boolean;
  supportsSeed: boolean;
  supportsStopSequences: boolean;
  supportsReasoningControl: boolean;
  supportsPrefixCaching: boolean;
  supportsCancellation: boolean;
  reportsPromptTokens: boolean;
  reportsCompletionTokens: boolean;
  reportsContextWindow: boolean;
}

export interface TranslationAdaptiveSettings {
  enabled: boolean;
  observationWindow: number;
  minimumSourceTokens: number;
  maximumSourceTokens: number;
  increaseStep: number;
  decreaseFactor: number;
}

export interface TranslationModelProfile {
  id: string;
  providerId: LLMProvider;
  modelId: string;
  tokenizerId?: string;
  tokenizerSource: 'override' | 'provider' | 'registered-model' | 'fallback';
  contextWindow: number;
  maximumOutputTokens?: number;
  promptVariant: PromptVariant;
  responseShape: TranslationResponseShape;
  structuredOutputMode: StructuredOutputMode;
  reasoningMode: ReasoningMode;
  reasoningControl?: ReasoningControl;
  messageFormat: 'structured-chat' | 'rendered-prompt';
  chatTemplateOwner: ChatTemplateOwner;
  capabilities: TranslationModelCapabilities;
  generation: TranslationGenerationSettings;
  batching: TranslationBatchSettings;
  retry: TranslationRetrySettings;
  adaptive: TranslationAdaptiveSettings;
  safetyReserveTokens: number;
  schemaReserveTokens: number;
  initialOutputRatios: Record<string, number>;
  promptVersion: string;
  profileVersion: string;
}

export interface TranslationModelMetadata {
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  tokenizerId: string | null;
  supportedParameters: readonly string[] | null;
  supportsPrefixCaching: boolean | null;
}

export interface TranslationModelProfilePatch {
  id?: string;
  tokenizerId?: string;
  tokenizerSource?: TranslationModelProfile['tokenizerSource'];
  contextWindow?: number;
  maximumOutputTokens?: number;
  promptVariant?: PromptVariant;
  responseShape?: TranslationResponseShape;
  structuredOutputMode?: StructuredOutputMode;
  reasoningMode?: ReasoningMode;
  reasoningControl?: ReasoningControl;
  messageFormat?: TranslationModelProfile['messageFormat'];
  chatTemplateOwner?: ChatTemplateOwner;
  capabilities?: Partial<TranslationModelCapabilities>;
  generation?: Partial<TranslationGenerationSettings>;
  batching?: Partial<TranslationBatchSettings>;
  retry?: Partial<TranslationRetrySettings>;
  adaptive?: Partial<TranslationAdaptiveSettings>;
  safetyReserveTokens?: number;
  schemaReserveTokens?: number;
  initialOutputRatios?: Record<string, number>;
  promptVersion?: string;
  profileVersion?: string;
}

export interface TranslationProfileResolution {
  profile: TranslationModelProfile;
  warnings: string[];
}

const conservativeCapabilities: TranslationModelCapabilities = {
  supportsJsonSchema: false,
  supportsGrammar: false,
  supportsToolCalling: false,
  supportsJsonObjectMode: false,
  supportsSeed: false,
  supportsStopSequences: false,
  supportsReasoningControl: false,
  supportsPrefixCaching: false,
  supportsCancellation: true,
  reportsPromptTokens: false,
  reportsCompletionTokens: false,
  reportsContextWindow: false,
};

const providerCapabilityDefaults: Record<
  LLMProvider,
  Partial<TranslationModelCapabilities>
> = {
  openai: {
    supportsJsonSchema: true,
    supportsToolCalling: true,
    supportsJsonObjectMode: true,
    supportsSeed: true,
    supportsReasoningControl: true,
    supportsPrefixCaching: true,
    reportsPromptTokens: true,
    reportsCompletionTokens: true,
  },
  anthropic: {
    supportsToolCalling: true,
    supportsStopSequences: true,
    supportsReasoningControl: true,
    supportsPrefixCaching: true,
    reportsPromptTokens: true,
    reportsCompletionTokens: true,
  },
  openrouter: {
    reportsPromptTokens: true,
    reportsCompletionTokens: true,
  },
  'openai-compatible': {},
};

const providerProfileDefaults: Record<LLMProvider, TranslationModelProfilePatch> = {
  openai: { reasoningControl: 'reasoning-effort' },
  anthropic: { reasoningControl: 'thinking-object' },
  openrouter: { reasoningControl: 'reasoning-effort' },
  'openai-compatible': {},
};

const baseProfile = (
  providerId: LLMProvider,
  modelId: string,
): TranslationModelProfile => ({
  id: `${providerId}:${modelId}:translation-v1`,
  providerId,
  modelId,
  tokenizerSource: 'fallback',
  contextWindow: 4096,
  promptVariant: 'standard',
  responseShape: 'objects',
  structuredOutputMode: 'prompt-only',
  reasoningMode: 'disabled',
  messageFormat: 'structured-chat',
  chatTemplateOwner: 'provider',
  capabilities: {
    ...conservativeCapabilities,
    ...providerCapabilityDefaults[providerId],
  },
  generation: {
    temperature: 0.1,
    topP: 0.95,
    repetitionPenalty: 1,
    presencePenalty: 0,
    frequencyPenalty: 0,
  },
  batching: {
    maxItems: 48,
    maxSourceTokens: 1600,
    maxContextTokens: 768,
    maxMemoryTokens: 512,
    preferredSourceTokens: 1200,
    preferredItems: 32,
    concurrency: 2,
  },
  retry: {
    maxRetries: 3,
    retryWithSmallerBatch: true,
    retryWithoutRetrievedContext: true,
    retryWithRicherLocalContext: true,
  },
  adaptive: {
    enabled: true,
    observationWindow: 5,
    minimumSourceTokens: 256,
    maximumSourceTokens: 1600,
    increaseStep: 96,
    decreaseFactor: 0.75,
  },
  safetyReserveTokens: 384,
  schemaReserveTokens: 128,
  initialOutputRatios: { default: 1.35 },
  promptVersion: TRANSLATION_PAGE_PROMPT_VERSION,
  profileVersion: TRANSLATION_MODEL_PROFILE_VERSION,
});

export const createConservativeTranslationModelProfile = (
  modelId: string,
): TranslationModelProfile => ({
  ...baseProfile('openai-compatible', modelId),
  id: `translator:${modelId}:translation-v1`,
  capabilities: { ...conservativeCapabilities },
  safetyReserveTokens: 640,
});

const qualityPatches: Record<TranslationQualityMode, TranslationModelProfilePatch> = {
  fast: {
    promptVariant: 'compact',
    responseShape: 'array',
    batching: {
      maxItems: 24,
      maxSourceTokens: 900,
      maxContextTokens: 256,
      maxMemoryTokens: 192,
      preferredSourceTokens: 720,
      preferredItems: 18,
      concurrency: 2,
    },
    retry: {
      maxRetries: 2,
      retryWithSmallerBatch: true,
      retryWithoutRetrievedContext: true,
      retryWithRicherLocalContext: false,
    },
  },
  balanced: {},
  accurate: {
    promptVariant: 'advanced',
    responseShape: 'objects',
    batching: {
      maxItems: 32,
      maxSourceTokens: 1400,
      maxContextTokens: 1400,
      maxMemoryTokens: 1200,
      preferredSourceTokens: 900,
      preferredItems: 24,
      concurrency: 1,
    },
    retry: {
      maxRetries: 4,
      retryWithSmallerBatch: true,
      retryWithoutRetrievedContext: true,
      retryWithRicherLocalContext: true,
    },
  },
  custom: {},
};

const registeredModelAliases: Record<string, string> = {
  'openai/gpt-4o-mini': 'gpt-4o-mini',
  'Ling-3.0-flash': 'ling-3.0-flash',
  'inclusionai/ling-3.0-flash': 'ling-3.0-flash',
  'Ling-3.0-tiny': 'ling-3.0-tiny',
  'inclusionai/ling-3.0-tiny': 'ling-3.0-tiny',
  'tencent/hy-mt2-30b-a3b': 'hy-mt2-30b-a3b',
};

const registeredModelPatches: Record<string, TranslationModelProfilePatch> = {
  'gpt-4o-mini': {
    tokenizerId: 'o200k_base',
    tokenizerSource: 'registered-model',
    contextWindow: 128_000,
    maximumOutputTokens: 16_384,
  },
  'ling-3.0-flash': { contextWindow: 262_144 },
  'ling-3.0-tiny': { contextWindow: 262_144 },
  'hy-mt2-30b-a3b': { contextWindow: 8192 },
};

export const getCanonicalTranslationModelId = (modelId: string): string =>
  registeredModelAliases[modelId] ?? modelId;

export const getRegisteredTranslationModelPatch = (
  modelId: string,
): TranslationModelProfilePatch | null =>
  registeredModelPatches[getCanonicalTranslationModelId(modelId)] ?? null;

const exactModelPatch = (
  configured: ConfiguredLLMProfile,
): TranslationModelProfilePatch => {
  const registered = getRegisteredTranslationModelPatch(configured.model);
  const canonicalModelId = getCanonicalTranslationModelId(configured.model);
  if (
    configured.provider === 'openai-compatible' &&
    configured.apiUrl.replace(/\/+$/u, '') === 'https://api.ant-ling.com/v1' &&
    (canonicalModelId === 'ling-3.0-flash' || canonicalModelId === 'ling-3.0-tiny')
  ) {
    return {
      ...(registered ?? {}),
      reasoningControl: 'thinking-object',
      capabilities: {
        ...registered?.capabilities,
        supportsReasoningControl: true,
      },
    };
  }
  return registered ?? {};
};

export const mergeTranslationModelProfile = (
  base: TranslationModelProfile,
  patch: TranslationModelProfilePatch,
): TranslationModelProfile => ({
  ...base,
  ...patch,
  providerId: base.providerId,
  modelId: base.modelId,
  capabilities: { ...base.capabilities, ...patch.capabilities },
  generation: { ...base.generation, ...patch.generation },
  batching: { ...base.batching, ...patch.batching },
  retry: { ...base.retry, ...patch.retry },
  adaptive: { ...base.adaptive, ...patch.adaptive },
  initialOutputRatios: patch.initialOutputRatios ?? base.initialOutputRatios,
});

const includesParameter = (
  supported: readonly string[] | null,
  ...names: string[]
): boolean => supported !== null && names.some((name) => supported.includes(name));

const metadataCapabilityPatch = (
  metadata: TranslationModelMetadata | null,
): Partial<TranslationModelCapabilities> => {
  if (metadata === null) return {};
  const supported = metadata.supportedParameters;
  return {
    ...(supported === null
      ? {}
      : {
          supportsJsonSchema: includesParameter(
            supported,
            'structured_outputs',
            'json_schema',
          ),
          supportsGrammar: includesParameter(
            supported,
            'grammar',
            'guided_json',
            'guided_decoding',
          ),
          supportsToolCalling: includesParameter(supported, 'tools', 'tool_choice'),
          supportsJsonObjectMode: includesParameter(supported, 'response_format'),
          supportsSeed: includesParameter(supported, 'seed'),
          supportsStopSequences: includesParameter(supported, 'stop', 'stop_sequences'),
          supportsReasoningControl: includesParameter(
            supported,
            'reasoning',
            'reasoning_effort',
            'enable_thinking',
            'thinking',
          ),
        }),
    ...(metadata.supportsPrefixCaching === null
      ? {}
      : { supportsPrefixCaching: metadata.supportsPrefixCaching }),
    reportsContextWindow: metadata.contextWindowTokens !== null,
  };
};

const capabilityOverrides = (
  configured: ConfiguredLLMProfile,
): Partial<TranslationModelCapabilities> => {
  if (configured.translationProfile === undefined) return {};
  const overrides = configured.translationProfile.capabilities;
  return {
    ...(overrides.supportsJsonSchema === null
      ? {}
      : { supportsJsonSchema: overrides.supportsJsonSchema }),
    ...(overrides.supportsGrammar === null
      ? {}
      : { supportsGrammar: overrides.supportsGrammar }),
    ...(overrides.supportsToolCalling === null
      ? {}
      : { supportsToolCalling: overrides.supportsToolCalling }),
    ...(overrides.supportsJsonObjectMode === null
      ? {}
      : { supportsJsonObjectMode: overrides.supportsJsonObjectMode }),
    ...(overrides.supportsSeed === null ? {} : { supportsSeed: overrides.supportsSeed }),
    ...(overrides.supportsStopSequences === null
      ? {}
      : { supportsStopSequences: overrides.supportsStopSequences }),
    ...(overrides.supportsReasoningControl === null
      ? {}
      : { supportsReasoningControl: overrides.supportsReasoningControl }),
    ...(overrides.supportsPrefixCaching === null
      ? {}
      : { supportsPrefixCaching: overrides.supportsPrefixCaching }),
    ...(overrides.supportsCancellation === null
      ? {}
      : { supportsCancellation: overrides.supportsCancellation }),
    ...(overrides.reportsPromptTokens === null
      ? {}
      : { reportsPromptTokens: overrides.reportsPromptTokens }),
    ...(overrides.reportsCompletionTokens === null
      ? {}
      : { reportsCompletionTokens: overrides.reportsCompletionTokens }),
    ...(overrides.reportsContextWindow === null
      ? {}
      : { reportsContextWindow: overrides.reportsContextWindow }),
  };
};

const userPatch = (configured: ConfiguredLLMProfile): TranslationModelProfilePatch => {
  if (configured.translationProfile === undefined) {
    return {
      batching:
        configured.maxConcurrentRequests === null
          ? {}
          : { concurrency: configured.maxConcurrentRequests },
      retry: {},
      adaptive: { enabled: configured.adaptiveBatching ?? true },
    };
  }
  const overrides = configured.translationProfile;
  const generation = overrides.generation;
  const batching = overrides.batching;
  const retry = overrides.retry;
  return {
    ...(overrides.tokenizerId === null
      ? {}
      : { tokenizerId: overrides.tokenizerId, tokenizerSource: 'override' }),
    ...(overrides.promptVariant === null
      ? {}
      : { promptVariant: overrides.promptVariant }),
    ...(overrides.structuredOutputMode === null
      ? {}
      : { structuredOutputMode: overrides.structuredOutputMode }),
    ...(overrides.reasoningMode === null
      ? {}
      : { reasoningMode: overrides.reasoningMode }),
    ...(overrides.reasoningControl === null
      ? {}
      : { reasoningControl: overrides.reasoningControl }),
    ...(overrides.safetyReserveTokens === null
      ? {}
      : { safetyReserveTokens: overrides.safetyReserveTokens }),
    ...(overrides.schemaReserveTokens === null
      ? {}
      : { schemaReserveTokens: overrides.schemaReserveTokens }),
    capabilities: capabilityOverrides(configured),
    generation: {
      ...(generation.temperature === null ? {} : { temperature: generation.temperature }),
      ...(generation.topP === null ? {} : { topP: generation.topP }),
      ...(generation.topK === null ? {} : { topK: generation.topK }),
      ...(generation.repetitionPenalty === null
        ? {}
        : { repetitionPenalty: generation.repetitionPenalty }),
      ...(generation.presencePenalty === null
        ? {}
        : { presencePenalty: generation.presencePenalty }),
      ...(generation.frequencyPenalty === null
        ? {}
        : { frequencyPenalty: generation.frequencyPenalty }),
      ...(generation.seed === null ? {} : { seed: generation.seed }),
    },
    batching: {
      ...(batching.maxItems === null ? {} : { maxItems: batching.maxItems }),
      ...(batching.maxSourceTokens === null
        ? {}
        : { maxSourceTokens: batching.maxSourceTokens }),
      ...(batching.maxContextTokens === null
        ? {}
        : { maxContextTokens: batching.maxContextTokens }),
      ...(batching.maxMemoryTokens === null
        ? {}
        : { maxMemoryTokens: batching.maxMemoryTokens }),
      ...(batching.preferredSourceTokens === null
        ? {}
        : { preferredSourceTokens: batching.preferredSourceTokens }),
      ...(batching.preferredItems === null
        ? {}
        : { preferredItems: batching.preferredItems }),
      ...(configured.maxConcurrentRequests === null
        ? {}
        : { concurrency: configured.maxConcurrentRequests }),
    },
    retry: {
      ...(retry.maxRetries === null ? {} : { maxRetries: retry.maxRetries }),
      ...(retry.retryWithSmallerBatch === null
        ? {}
        : { retryWithSmallerBatch: retry.retryWithSmallerBatch }),
      ...(retry.retryWithoutRetrievedContext === null
        ? {}
        : { retryWithoutRetrievedContext: retry.retryWithoutRetrievedContext }),
      ...(retry.retryWithRicherLocalContext === null
        ? {}
        : { retryWithRicherLocalContext: retry.retryWithRicherLocalContext }),
    },
    adaptive: {
      enabled: overrides.adaptiveBatching ?? configured.adaptiveBatching,
    },
  };
};

export const selectStructuredOutputMode = (
  capabilities: TranslationModelCapabilities,
): StructuredOutputMode => {
  if (capabilities.supportsJsonSchema) return 'json-schema';
  if (capabilities.supportsGrammar) return 'grammar';
  if (capabilities.supportsToolCalling) return 'tool-call';
  if (capabilities.supportsJsonObjectMode) return 'json-object';
  return 'prompt-only';
};

const supportsStructuredMode = (
  mode: StructuredOutputMode,
  capabilities: TranslationModelCapabilities,
): boolean => {
  switch (mode) {
    case 'json-schema':
      return capabilities.supportsJsonSchema;
    case 'grammar':
      return capabilities.supportsGrammar;
    case 'tool-call':
      return capabilities.supportsToolCalling;
    case 'json-object':
      return capabilities.supportsJsonObjectMode;
    case 'prompt-only':
      return true;
  }
};

const normalizeResolvedProfile = (
  profile: TranslationModelProfile,
  warnings: string[],
): TranslationModelProfile => {
  let normalized = profile;
  if (!supportsStructuredMode(profile.structuredOutputMode, profile.capabilities)) {
    const fallback = selectStructuredOutputMode(profile.capabilities);
    warnings.push(
      `Structured output ${profile.structuredOutputMode} is unsupported; using ${fallback}`,
    );
    normalized = { ...normalized, structuredOutputMode: fallback };
  }
  if (
    profile.reasoningMode !== 'disabled' &&
    !profile.capabilities.supportsReasoningControl
  ) {
    warnings.push('Reasoning control is unsupported; using disabled reasoning');
    normalized = { ...normalized, reasoningMode: 'disabled' };
  }
  if (profile.reasoningMode !== 'disabled' && profile.reasoningControl === undefined) {
    warnings.push('Reasoning control mapping is unknown; using disabled reasoning');
    normalized = { ...normalized, reasoningMode: 'disabled' };
  }
  if (
    normalized.chatTemplateOwner !== 'provider' ||
    normalized.messageFormat !== 'structured-chat'
  ) {
    warnings.push(
      'The configured endpoint accepts structured chat only; using provider template',
    );
    normalized = {
      ...normalized,
      chatTemplateOwner: 'provider',
      messageFormat: 'structured-chat',
    };
  }
  const maximumSourceTokens = Math.max(
    1,
    normalized.contextWindow -
      normalized.safetyReserveTokens -
      normalized.schemaReserveTokens -
      64,
  );
  if (normalized.batching.maxSourceTokens > maximumSourceTokens) {
    warnings.push('Maximum source tokens exceeded the context budget and was reduced');
    normalized = {
      ...normalized,
      batching: {
        ...normalized.batching,
        maxSourceTokens: maximumSourceTokens,
        preferredSourceTokens: Math.min(
          normalized.batching.preferredSourceTokens,
          maximumSourceTokens,
        ),
      },
    };
  }
  return normalized;
};

export const resolveTranslationModelProfile = (
  configured: ConfiguredLLMProfile,
  metadata: TranslationModelMetadata | null,
): TranslationProfileResolution => {
  const warnings: string[] = [];
  let profile = baseProfile(configured.provider, configured.model);
  profile = mergeTranslationModelProfile(
    profile,
    providerProfileDefaults[configured.provider],
  );
  profile = mergeTranslationModelProfile(profile, exactModelPatch(configured));
  profile = mergeTranslationModelProfile(
    profile,
    qualityPatches[configured.qualityMode ?? 'balanced'],
  );

  if (metadata !== null) {
    profile = mergeTranslationModelProfile(profile, {
      ...(metadata.contextWindowTokens === null
        ? {}
        : { contextWindow: metadata.contextWindowTokens }),
      ...(metadata.maxOutputTokens === null
        ? {}
        : { maximumOutputTokens: metadata.maxOutputTokens }),
      ...(metadata.tokenizerId === null
        ? {}
        : { tokenizerId: metadata.tokenizerId, tokenizerSource: 'provider' }),
      capabilities: metadataCapabilityPatch(metadata),
    });
  }

  profile = mergeTranslationModelProfile(profile, {
    ...(configured.contextWindowTokens === null
      ? {}
      : { contextWindow: configured.contextWindowTokens }),
    ...(configured.maxOutputTokens === null
      ? {}
      : { maximumOutputTokens: configured.maxOutputTokens }),
    ...(configured.preferredInputTokens === null
      ? {}
      : {
          batching: {
            preferredSourceTokens: configured.preferredInputTokens,
            maxSourceTokens: Math.max(
              configured.preferredInputTokens,
              profile.batching.maxSourceTokens,
            ),
          },
        }),
    ...userPatch(configured),
  });

  profile = {
    ...profile,
    structuredOutputMode:
      configured.translationProfile?.structuredOutputMode ??
      selectStructuredOutputMode(profile.capabilities),
    adaptive: {
      ...profile.adaptive,
      maximumSourceTokens: profile.batching.maxSourceTokens,
      minimumSourceTokens: Math.min(
        profile.adaptive.minimumSourceTokens,
        profile.batching.preferredSourceTokens,
      ),
    },
  };

  if (profile.tokenizerSource === 'fallback') {
    warnings.push('No exact tokenizer is available; using a conservative estimator');
    profile = {
      ...profile,
      safetyReserveTokens: Math.max(profile.safetyReserveTokens, 640),
    };
  }

  return { profile: normalizeResolvedProfile(profile, warnings), warnings };
};

export const validateTranslationModelProfile = (
  profile: TranslationModelProfile,
): string[] => {
  const errors: string[] = [];
  if (profile.id.trim() === '') errors.push('Profile ID must not be empty');
  if (profile.modelId.trim() === '') errors.push('Model ID must not be empty');
  if (profile.contextWindow <= 0) errors.push('Context window must be positive');
  if (profile.safetyReserveTokens < 0 || profile.schemaReserveTokens < 0) {
    errors.push('Token reserves must not be negative');
  }
  if (
    profile.safetyReserveTokens + profile.schemaReserveTokens >=
    profile.contextWindow
  ) {
    errors.push('Token reserves must fit within the context window');
  }
  if (profile.generation.temperature < 0 || profile.generation.temperature > 2) {
    errors.push('Temperature must be between 0 and 2');
  }
  if (profile.generation.topP < 0 || profile.generation.topP > 1) {
    errors.push('Top-p must be between 0 and 1');
  }
  if (
    profile.batching.maxItems <= 0 ||
    profile.batching.maxSourceTokens <= 0 ||
    profile.batching.concurrency <= 0
  ) {
    errors.push('Batch limits and concurrency must be positive');
  }
  if (profile.batching.maxSourceTokens >= profile.contextWindow) {
    errors.push('Maximum source tokens must be smaller than the context window');
  }
  if (!supportsStructuredMode(profile.structuredOutputMode, profile.capabilities)) {
    errors.push(
      `Structured output mode ${profile.structuredOutputMode} is unsupported by the resolved capabilities`,
    );
  }
  if (
    profile.reasoningMode !== 'disabled' &&
    (!profile.capabilities.supportsReasoningControl ||
      profile.reasoningControl === undefined)
  ) {
    errors.push('Reasoning mode is not safely mappable for this provider');
  }
  if (
    profile.messageFormat === 'structured-chat' &&
    profile.chatTemplateOwner !== 'provider'
  ) {
    errors.push('Structured chat cannot also apply a tokenizer or application template');
  }
  return errors;
};

export const validateFallbackProfiles = (
  profiles: readonly ConfiguredLLMProfile[],
): string[] => {
  const errors: string[] = [];
  const names = new Set(profiles.map((profile) => profile.name));
  const nameCounts = new Map<string, number>();
  for (const profile of profiles) {
    nameCounts.set(profile.name, (nameCounts.get(profile.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (name.trim() === '') errors.push('Profile name must not be empty');
    if (count > 1) errors.push(`Profile name ${name} is duplicated`);
  }
  for (const profile of profiles) {
    const fallbackName = profile.fallbackProfile ?? null;
    if (fallbackName !== null && !names.has(fallbackName)) {
      errors.push(`Profile ${profile.name} references missing fallback ${fallbackName}`);
    }
    const seen = new Set<string>();
    let current: ConfiguredLLMProfile | undefined = profile;
    while (current !== undefined) {
      const nextName: string | null = current.fallbackProfile ?? null;
      if (nextName === null) break;
      if (seen.has(current.name)) {
        errors.push(`Fallback cycle includes profile ${current.name}`);
        break;
      }
      seen.add(current.name);
      current = profiles.find((candidate) => candidate.name === nextName);
    }
  }
  return Array.from(new Set(errors)).sort();
};

export interface AdaptiveBatchObservation {
  valid: boolean;
  truncated: boolean;
  timedOut: boolean;
  latencyMs: number;
}

interface AdaptiveState {
  preferredSourceTokens: number;
  observations: AdaptiveBatchObservation[];
}

export class AdaptiveBatchTuner {
  private readonly states = new Map<string, AdaptiveState>();

  public get(
    profile: TranslationModelProfile,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
  ): number {
    if (!profile.adaptive.enabled) return profile.batching.preferredSourceTokens;
    const key = this.key(profile, sourceLanguage, targetLanguage, contentClass);
    return (
      this.states.get(key)?.preferredSourceTokens ??
      profile.batching.preferredSourceTokens
    );
  }

  public observe(
    profile: TranslationModelProfile,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
    observation: AdaptiveBatchObservation,
  ): void {
    if (!profile.adaptive.enabled) return;
    const key = this.key(profile, sourceLanguage, targetLanguage, contentClass);
    const state = this.states.get(key) ?? {
      preferredSourceTokens: profile.batching.preferredSourceTokens,
      observations: [],
    };
    state.observations.push(observation);
    if (state.observations.length > profile.adaptive.observationWindow) {
      state.observations.shift();
    }
    if (state.observations.length < profile.adaptive.observationWindow) {
      this.states.set(key, state);
      return;
    }

    const hasFailure = state.observations.some(
      (item) => !item.valid || item.truncated || item.timedOut,
    );
    if (hasFailure) {
      state.preferredSourceTokens = Math.max(
        profile.adaptive.minimumSourceTokens,
        Math.floor(state.preferredSourceTokens * profile.adaptive.decreaseFactor),
      );
    } else {
      const averageLatency =
        state.observations.reduce((sum, item) => sum + item.latencyMs, 0) /
        state.observations.length;
      if (averageLatency < 5000) {
        state.preferredSourceTokens = Math.min(
          profile.adaptive.maximumSourceTokens,
          state.preferredSourceTokens + profile.adaptive.increaseStep,
        );
      }
    }
    state.observations = [];
    this.states.set(key, state);
  }

  public clear(profileId?: string): void {
    if (profileId === undefined) {
      this.states.clear();
      return;
    }
    for (const key of this.states.keys()) {
      if (key.startsWith(`${profileId}\u0000`)) this.states.delete(key);
    }
  }

  private key(
    profile: TranslationModelProfile,
    sourceLanguage: string,
    targetLanguage: string,
    contentClass: string,
  ): string {
    return `${profile.id}\u0000${sourceLanguage}>${targetLanguage}\u0000${contentClass}`;
  }
}
