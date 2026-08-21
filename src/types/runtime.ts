import { isLanguageCodeISO639v1 } from 'anylang/languages';
import { Effect, Schema } from 'effect';

import { NonNaNNumber, NonNegativeInteger, PositiveInteger } from '../lib/types';
import { type DeepMutable } from './utils';

export const ArrayOfStrings = Schema.mutable(Schema.Array(Schema.String));

export const LangCode = Schema.String.check(
  Schema.makeFilter((input: string) => isLanguageCodeISO639v1(input), {
    identifier: 'LangCode',
    expected: 'an ISO 639-1 language code',
  }),
);

export const LangCodeWithAuto = Schema.String.check(
  Schema.makeFilter(
    (input: string) => input === 'auto' || isLanguageCodeISO639v1(input),
    {
      identifier: 'LangCodeWithAuto',
      expected: '"auto" or an ISO 639-1 language code',
    },
  ),
);

const OptionalNumber = Schema.Union([NonNaNNumber, Schema.Undefined]).pipe(
  // `withDecodingDefault` requires the schema's precise success type, not `void`.
  // @effect-diagnostics-next-line effectSucceedWithVoid:off
  Schema.withDecodingDefault(Effect.succeed(undefined)),
);

const OptionalBoolean = Schema.Union([Schema.Boolean, Schema.Undefined]).pipe(
  // `withDecodingDefault` requires the schema's precise success type, not `void`.
  // @effect-diagnostics-next-line effectSucceedWithVoid:off
  Schema.withDecodingDefault(Effect.succeed(undefined)),
);

/**
 * Minimum sensible LLM context window override
 */
const ContextWindowTokens = PositiveInteger.check(
  Schema.makeFilter((input: number) => input >= 512, {
    identifier: 'ContextWindowTokens',
    expected: 'an integer of at least 512',
  }),
);

/**
 * Bounded parallel request limit for a single LLM profile
 */
const ConcurrentRequestsLimit = PositiveInteger.check(
  Schema.makeFilter((input: number) => input <= 8, {
    identifier: 'ConcurrentRequestsLimit',
    expected: 'an integer between 1 and 8',
  }),
);

/**
 * Nullable execution override; `null` (and a missing key in legacy data) means automatic
 */
const withAutoDefault = <A, I, R>(schema: Schema.Codec<A, I, R>) =>
  Schema.Union([schema, Schema.Null]).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  );

export const LLMProvider = Schema.Literals([
  'openai',
  'anthropic',
  'openrouter',
  'openai-compatible',
]);

export const TranslationQualityMode = Schema.Literals([
  'fast',
  'balanced',
  'accurate',
  'custom',
]);

export const TranslationPromptVariant = Schema.Literals([
  'compact',
  'standard',
  'advanced',
]);

export const TranslationStructuredOutputMode = Schema.Literals([
  'json-schema',
  'grammar',
  'tool-call',
  'json-object',
  'prompt-only',
]);

export const TranslationReasoningMode = Schema.Literals([
  'disabled',
  'minimal',
  'normal',
]);

export const TranslationReasoningControl = Schema.Literals([
  'reasoning-effort',
  'enable-thinking',
  'thinking-object',
]);

const Temperature = NonNaNNumber.check(
  Schema.makeFilter((input: number) => input >= 0 && input <= 2, {
    identifier: 'Temperature',
    expected: 'a number between 0 and 2',
  }),
);

const Probability = NonNaNNumber.check(
  Schema.makeFilter((input: number) => input >= 0 && input <= 1, {
    identifier: 'Probability',
    expected: 'a number between 0 and 1',
  }),
);

const RepetitionPenalty = NonNaNNumber.check(
  Schema.makeFilter((input: number) => input >= 0.5 && input <= 2, {
    identifier: 'RepetitionPenalty',
    expected: 'a number between 0.5 and 2',
  }),
);

const SignedPenalty = NonNaNNumber.check(
  Schema.makeFilter((input: number) => input >= -2 && input <= 2, {
    identifier: 'SignedPenalty',
    expected: 'a number between -2 and 2',
  }),
);

const CapabilityOverrides = Schema.Struct({
  supportsJsonSchema: withAutoDefault(Schema.Boolean),
  supportsGrammar: withAutoDefault(Schema.Boolean),
  supportsToolCalling: withAutoDefault(Schema.Boolean),
  supportsJsonObjectMode: withAutoDefault(Schema.Boolean),
  supportsSeed: withAutoDefault(Schema.Boolean),
  supportsStopSequences: withAutoDefault(Schema.Boolean),
  supportsReasoningControl: withAutoDefault(Schema.Boolean),
  supportsPrefixCaching: withAutoDefault(Schema.Boolean),
  supportsCancellation: withAutoDefault(Schema.Boolean),
  reportsPromptTokens: withAutoDefault(Schema.Boolean),
  reportsCompletionTokens: withAutoDefault(Schema.Boolean),
  reportsContextWindow: withAutoDefault(Schema.Boolean),
}).pipe(
  Schema.withDecodingDefault(
    Effect.sync(() => ({
      supportsJsonSchema: null,
      supportsGrammar: null,
      supportsToolCalling: null,
      supportsJsonObjectMode: null,
      supportsSeed: null,
      supportsStopSequences: null,
      supportsReasoningControl: null,
      supportsPrefixCaching: null,
      supportsCancellation: null,
      reportsPromptTokens: null,
      reportsCompletionTokens: null,
      reportsContextWindow: null,
    })),
  ),
);

const TranslationGenerationOverrides = Schema.Struct({
  temperature: withAutoDefault(Temperature),
  topP: withAutoDefault(Probability),
  topK: withAutoDefault(PositiveInteger),
  repetitionPenalty: withAutoDefault(RepetitionPenalty),
  presencePenalty: withAutoDefault(SignedPenalty),
  frequencyPenalty: withAutoDefault(SignedPenalty),
  seed: withAutoDefault(NonNegativeInteger),
}).pipe(
  Schema.withDecodingDefault(
    Effect.sync(() => ({
      temperature: null,
      topP: null,
      topK: null,
      repetitionPenalty: null,
      presencePenalty: null,
      frequencyPenalty: null,
      seed: null,
    })),
  ),
);

const TranslationBatchOverrides = Schema.Struct({
  maxItems: withAutoDefault(PositiveInteger),
  maxSourceTokens: withAutoDefault(PositiveInteger),
  maxContextTokens: withAutoDefault(PositiveInteger),
  maxMemoryTokens: withAutoDefault(PositiveInteger),
  preferredSourceTokens: withAutoDefault(PositiveInteger),
  preferredItems: withAutoDefault(PositiveInteger),
}).pipe(
  Schema.withDecodingDefault(
    Effect.sync(() => ({
      maxItems: null,
      maxSourceTokens: null,
      maxContextTokens: null,
      maxMemoryTokens: null,
      preferredSourceTokens: null,
      preferredItems: null,
    })),
  ),
);

const TranslationRetryOverrides = Schema.Struct({
  maxRetries: withAutoDefault(NonNegativeInteger),
  retryWithSmallerBatch: withAutoDefault(Schema.Boolean),
  retryWithoutRetrievedContext: withAutoDefault(Schema.Boolean),
  retryWithRicherLocalContext: withAutoDefault(Schema.Boolean),
}).pipe(
  Schema.withDecodingDefault(
    Effect.sync(() => ({
      maxRetries: null,
      retryWithSmallerBatch: null,
      retryWithoutRetrievedContext: null,
      retryWithRicherLocalContext: null,
    })),
  ),
);

const TranslationProfileOverrides = Schema.Struct({
  tokenizerId: withAutoDefault(Schema.String),
  promptVariant: withAutoDefault(TranslationPromptVariant),
  structuredOutputMode: withAutoDefault(TranslationStructuredOutputMode),
  reasoningMode: withAutoDefault(TranslationReasoningMode),
  reasoningControl: withAutoDefault(TranslationReasoningControl),
  safetyReserveTokens: withAutoDefault(PositiveInteger),
  schemaReserveTokens: withAutoDefault(PositiveInteger),
  adaptiveBatching: withAutoDefault(Schema.Boolean),
  debug: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  generation: TranslationGenerationOverrides,
  batching: TranslationBatchOverrides,
  retry: TranslationRetryOverrides,
  capabilities: CapabilityOverrides,
}).pipe(
  Schema.withDecodingDefault(
    Effect.sync(() => ({
      tokenizerId: null,
      promptVariant: null,
      structuredOutputMode: null,
      reasoningMode: null,
      reasoningControl: null,
      safetyReserveTokens: null,
      schemaReserveTokens: null,
      adaptiveBatching: null,
      debug: false,
      generation: {
        temperature: null,
        topP: null,
        topK: null,
        repetitionPenalty: null,
        presencePenalty: null,
        frequencyPenalty: null,
        seed: null,
      },
      batching: {
        maxItems: null,
        maxSourceTokens: null,
        maxContextTokens: null,
        maxMemoryTokens: null,
        preferredSourceTokens: null,
        preferredItems: null,
      },
      retry: {
        maxRetries: null,
        retryWithSmallerBatch: null,
        retryWithoutRetrievedContext: null,
        retryWithRicherLocalContext: null,
      },
      capabilities: {
        supportsJsonSchema: null,
        supportsGrammar: null,
        supportsToolCalling: null,
        supportsJsonObjectMode: null,
        supportsSeed: null,
        supportsStopSequences: null,
        supportsReasoningControl: null,
        supportsPrefixCaching: null,
        supportsCancellation: null,
        reportsPromptTokens: null,
        reportsCompletionTokens: null,
        reportsContextWindow: null,
      },
    })),
  ),
);

export const DEFAULT_TRANSLATION_PROFILE_OVERRIDES = Schema.decodeSync(
  TranslationProfileOverrides,
)({});

export const DEFAULT_TRANSLATION_QUALITY_MODE = 'balanced' as const;

export const DEFAULT_ADAPTIVE_BATCHING = true;

export const DEFAULT_LLM_FALLBACK_PROFILE = null;

const TranslationQualityModeWithDefault = TranslationQualityMode.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_TRANSLATION_QUALITY_MODE)),
);

const AdaptiveBatchingWithDefault = Schema.Boolean.pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_ADAPTIVE_BATCHING)),
);

const FallbackProfileWithDefault = Schema.Union([Schema.String, Schema.Null]).pipe(
  Schema.withDecodingDefault(Effect.succeed(DEFAULT_LLM_FALLBACK_PROFILE)),
);

export const LLMProfile = Schema.Struct({
  name: Schema.String,
  provider: LLMProvider,
  apiUrl: Schema.String,
  apiKey: Schema.String,
  model: Schema.String,
  contextWindowTokens: withAutoDefault(ContextWindowTokens),
  preferredInputTokens: withAutoDefault(PositiveInteger),
  maxOutputTokens: withAutoDefault(PositiveInteger),
  maxConcurrentRequests: withAutoDefault(ConcurrentRequestsLimit),
  qualityMode: TranslationQualityModeWithDefault,
  fallbackProfile: FallbackProfileWithDefault,
  adaptiveBatching: AdaptiveBatchingWithDefault,
  translationProfile: TranslationProfileOverrides,
});

export const AppConfig = Schema.Struct({
  language: Schema.String,
  translatorModule: Schema.String,
  llmTranslator: Schema.Struct({
    // Name of the profile in `profiles` used for translation
    activeProfile: Schema.String,
    profiles: Schema.mutable(Schema.Array(LLMProfile)),
  }).pipe(
    Schema.withDecodingDefault(
      // `Effect.sync` so each decode gets a fresh object (AppConfigType is DeepMutable)
      Effect.sync(() => ({
        activeProfile: 'OpenAI',
        profiles: [
          {
            name: 'OpenAI',
            provider: 'openai' as const,
            apiUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4o-mini',
            contextWindowTokens: null,
            preferredInputTokens: null,
            maxOutputTokens: null,
            maxConcurrentRequests: null,
            qualityMode: DEFAULT_TRANSLATION_QUALITY_MODE,
            fallbackProfile: DEFAULT_LLM_FALLBACK_PROFILE,
            adaptiveBatching: DEFAULT_ADAPTIVE_BATCHING,
            translationProfile: structuredClone(DEFAULT_TRANSLATION_PROFILE_OVERRIDES),
          },
        ],
      })),
    ),
  ),
  ttsModule: Schema.String,
  scheduler: Schema.Struct({
    useCache: Schema.Boolean,
    translateRetryAttemptLimit: NonNegativeInteger,
    isAllowDirectTranslateBadChunks: Schema.Boolean,
    directTranslateLength: Schema.Union([NonNaNNumber, Schema.Null]),
    translatePoolDelay: NonNaNNumber,
    chunkSizeForInstantTranslate: Schema.Union([NonNaNNumber, Schema.Null]),
  }),
  cache: Schema.Struct({
    ignoreCase: Schema.Boolean,
  }),
  selectTranslator: Schema.Struct({
    enabled: Schema.Boolean,
    disableWhileTranslatePage: Schema.Boolean,
    zIndex: OptionalNumber,
    focusOnTranslateButton: OptionalBoolean,
    rememberDirection: Schema.Boolean,
    modifiers: Schema.mutable(
      Schema.Array(
        Schema.Union([
          Schema.Literal('ctrlKey'),
          Schema.Literal('altKey'),
          Schema.Literal('shiftKey'),
          Schema.Literal('metaKey'),
        ]),
      ),
    ),
    strictSelection: Schema.Boolean,
    detectedLangFirst: Schema.Boolean,
    showOnceForSelection: Schema.Boolean,
    showOriginalText: Schema.Boolean,
    isUseAutoForDetectLang: Schema.Boolean,
    timeoutForHideButton: NonNaNNumber,
    mode: Schema.Union([
      Schema.Literal('popupButton'),
      Schema.Literal('quickTranslate'),
      Schema.Literal('contextMenu'),
    ]),
  }),
  pageTranslator: Schema.Struct({
    excludeSelectors: ArrayOfStrings,
    translatableAttributes: ArrayOfStrings,
    lazyTranslate: Schema.Boolean,
    detectLanguageByContent: Schema.Boolean,
    originalTextPopup: Schema.Boolean,
    enableLogExport: Schema.Boolean,
    enableContextMenu: Schema.Boolean,
    toggleTranslationHotkey: Schema.Union([Schema.Null, Schema.String]),
  }),
  textTranslator: Schema.Struct({
    rememberText: Schema.Boolean,
    spellCheck: Schema.Boolean,
    suggestLanguage: Schema.Boolean,
    suggestLanguageAlways: Schema.Boolean,
  }),
  popup: Schema.Struct({
    rememberLastTab: Schema.Boolean,
  }),
  history: Schema.Struct({
    enabled: Schema.Boolean,
  }),
  popupTab: Schema.Struct({
    pageTranslator: Schema.Struct({
      showCounters: Schema.Boolean,
    }),
  }),
});

export type AppConfigType = DeepMutable<typeof AppConfig.Type>;
