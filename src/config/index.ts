import { isMobileBrowser } from '../lib/browser';
import { getUserLanguage } from '../lib/language';
import {
  DEFAULT_ADAPTIVE_BATCHING,
  DEFAULT_LLM_FALLBACK_PROFILE,
  DEFAULT_TRANSLATION_PROFILE_OVERRIDES,
  DEFAULT_TRANSLATION_QUALITY_MODE,
  type AppConfigType,
} from '../types/runtime';
import noTranslateSelectors from './no-translate-selectors';

export const DEFAULT_TRANSLATOR = 'AutoTranslator';
export const DEFAULT_TTS = 'google';

// Init config
export const defaultConfig: AppConfigType = {
  translatorModule: DEFAULT_TRANSLATOR,
  llmTranslator: {
    activeProfile: 'OpenAI',
    profiles: [
      {
        name: 'OpenAI',
        provider: 'openai',
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
  },
  ttsModule: DEFAULT_TTS,
  language: getUserLanguage(),
  scheduler: {
    useCache: true,
    translateRetryAttemptLimit: 2,
    isAllowDirectTranslateBadChunks: true,
    directTranslateLength: null,
    translatePoolDelay: 300,
    chunkSizeForInstantTranslate: null,
  },
  cache: {
    ignoreCase: true,
  },
  pageTranslator: {
    excludeSelectors: noTranslateSelectors.split('\n'),
    translatableAttributes: ['title', 'alt', 'placeholder', 'label', 'aria-label'],
    // Temporary solution to fix UX due to bug https://github.com/translate-tools/linguist/issues/75
    lazyTranslate: isMobileBrowser() ? false : true,
    detectLanguageByContent: true,
    originalTextPopup: false,
    enableLogExport: false,
    enableContextMenu: true,
    toggleTranslationHotkey: null,
  },
  textTranslator: {
    rememberText: true,
    spellCheck: true,
    suggestLanguage: true,
    suggestLanguageAlways: true,
  },
  selectTranslator: {
    enabled: true,
    disableWhileTranslatePage: true,
    mode: 'popupButton',
    zIndex: 999999,
    rememberDirection: false,
    modifiers: [],
    strictSelection: false,
    detectedLangFirst: true,
    timeoutForHideButton: 3000,
    focusOnTranslateButton: false,
    showOnceForSelection: isMobileBrowser() ? false : true,
    showOriginalText: true,
    isUseAutoForDetectLang: true,
  },
  popup: {
    rememberLastTab: true,
  },
  history: {
    enabled: true,
  },
  popupTab: {
    pageTranslator: {
      showCounters: true,
    },
  },
};
