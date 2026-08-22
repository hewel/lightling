import { getActiveLLMProfile } from '@/lib/translators/llm/LLMTranslator';
import {
  createConservativeTranslationModelProfile,
  resolveTranslationModelProfile,
  type TranslationModelProfile,
} from '@/lib/translators/llm/modelProfile';
import {
  conservativeTokenCounter,
  resolveTranslationTokenizer,
  type TranslationTokenCounter,
} from '@/lib/translators/llm/tokenizer';
import type { AppConfigType } from '@/types/runtime';

export type PageTranslationSessionConfig = {
  translatorModule?: AppConfigType['translatorModule'];
  llmTranslator?: AppConfigType['llmTranslator'];
  lazyTranslate?: AppConfigType['pageTranslator']['lazyTranslate'];
  enableLogExport?: AppConfigType['pageTranslator']['enableLogExport'];
};

export interface PageTranslationSessionDescriptor {
  sessionId: string;
  sessionSignature: string;
  provider: string;
  model: string;
  modelProfile: TranslationModelProfile;
  tokenCounter: TranslationTokenCounter;
  logEnabled: boolean;
  debug: boolean;
}

export interface PageTranslationSessionInput {
  config: PageTranslationSessionConfig;
  from: string;
  to: string;
  documentIdentity: string;
  pageUrl: string;
  sessionId: string;
}

export const preparePageTranslationSession = ({
  config,
  from,
  to,
  documentIdentity,
  pageUrl,
  sessionId,
}: PageTranslationSessionInput): PageTranslationSessionDescriptor => {
  const configuredProfile =
    config.translatorModule === 'LLMTranslator' && config.llmTranslator !== undefined
      ? getActiveLLMProfile(config.llmTranslator)
      : null;
  const provider = configuredProfile?.provider ?? config.translatorModule ?? 'unknown';
  const model = configuredProfile?.model ?? config.translatorModule ?? 'unknown';
  const profileResolution =
    configuredProfile === null
      ? null
      : resolveTranslationModelProfile(configuredProfile, null);
  const tokenizerResolution =
    configuredProfile === null
      ? null
      : resolveTranslationTokenizer(configuredProfile, null);
  const modelProfile =
    profileResolution === null || tokenizerResolution === null
      ? createConservativeTranslationModelProfile(model)
      : {
          ...profileResolution.profile,
          tokenizerId: tokenizerResolution.counter.id,
          tokenizerSource: tokenizerResolution.source,
          safetyReserveTokens:
            tokenizerResolution.counter.accuracy === 'estimate'
              ? Math.max(profileResolution.profile.safetyReserveTokens, 640)
              : profileResolution.profile.safetyReserveTokens,
        };
  const tokenCounter = tokenizerResolution?.counter ?? conservativeTokenCounter;
  const logEnabled = config.enableLogExport === true;
  const debug = logEnabled || configuredProfile?.translationProfile?.debug === true;
  const sessionSignature = [
    pageUrl,
    documentIdentity,
    from,
    to,
    provider,
    model,
    modelProfile.profileVersion,
    modelProfile.promptVersion,
    config.lazyTranslate ? 'lazy' : 'eager',
  ].join('\u0000');

  return {
    sessionId,
    sessionSignature,
    provider,
    model,
    modelProfile,
    tokenCounter,
    logEnabled,
    debug,
  };
};
