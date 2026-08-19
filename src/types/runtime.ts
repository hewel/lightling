import { isLanguageCodeISO639v1 } from 'anylang/languages';
import { Effect, Schema } from 'effect';

import { NonNaNNumber } from '../lib/types';
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
  Schema.withDecodingDefault(Effect.succeed(undefined)),
);

const OptionalBoolean = Schema.Union([Schema.Boolean, Schema.Undefined]).pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
);

export const LLMProvider = Schema.Literals([
  'openai',
  'anthropic',
  'openrouter',
  'openai-compatible',
]);

export const LLMProfile = Schema.Struct({
  name: Schema.String,
  provider: LLMProvider,
  apiUrl: Schema.String,
  apiKey: Schema.String,
  model: Schema.String,
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
          },
        ],
      })),
    ),
  ),
  ttsModule: Schema.String,
  scheduler: Schema.Struct({
    useCache: Schema.Boolean,
    translateRetryAttemptLimit: NonNaNNumber,
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
