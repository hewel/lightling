import type { BudgetSnapshot } from '@/lib/translators/llm/budgetController';
import { getActiveLLMProfile } from '@/lib/translators/llm/LLMTranslator';
import { getLLMDiscoveryIdentity } from '@/lib/translators/llm/modelInfo';
import { loadLLMExecutionSettingsCached } from '@/lib/translators/llm/modelListCache';
import {
  createConservativeTranslationModelProfile,
  type TranslationModelProfile,
} from '@/lib/translators/llm/modelProfile';
import {
  resolveSizeTier,
  type TranslationModelSizeTier,
} from '@/lib/translators/llm/sizeTier';
import {
  conservativeTokenCounter,
  type TranslationTokenCounter,
} from '@/lib/translators/llm/tokenizer';
import { getTranslationBudgetSnapshot } from '@/requests/backend/getTranslationBudgetSnapshot';
import { setTranslationBudgetSnapshot } from '@/requests/backend/setTranslationBudgetSnapshot';
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
  sizeTier: TranslationModelSizeTier;
  persistedBudget: BudgetSnapshot | null;
  onBudgetSnapshot: (snapshot: BudgetSnapshot) => void;
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

export const preparePageTranslationSession = async ({
  config,
  from,
  to,
  documentIdentity,
  pageUrl,
  sessionId,
}: PageTranslationSessionInput): Promise<PageTranslationSessionDescriptor> => {
  const configuredProfile =
    config.translatorModule === 'LLMTranslator' && config.llmTranslator !== undefined
      ? getActiveLLMProfile(config.llmTranslator)
      : null;
  const provider = configuredProfile?.provider ?? config.translatorModule ?? 'unknown';
  const model = configuredProfile?.model ?? config.translatorModule ?? 'unknown';
  const settings =
    configuredProfile === null
      ? null
      : await loadLLMExecutionSettingsCached(configuredProfile);
  const modelProfile =
    settings?.translationProfile ?? createConservativeTranslationModelProfile(model);
  const tokenCounter = settings?.tokenCounter ?? conservativeTokenCounter;
  const sizeTier =
    configuredProfile === null
      ? 'medium'
      : resolveSizeTier(configuredProfile, settings?.modelInfo ?? null);
  const budgetIdentity =
    configuredProfile === null ? null : getLLMDiscoveryIdentity(configuredProfile);
  const persistedBudget =
    budgetIdentity === null
      ? null
      : await getTranslationBudgetSnapshot({ identity: budgetIdentity });
  const onBudgetSnapshot = (snapshot: BudgetSnapshot): void => {
    if (budgetIdentity === null) return;
    void setTranslationBudgetSnapshot({
      identity: budgetIdentity,
      snapshot,
      updatedAt: Date.now(),
    }).catch((error: unknown) => {
      console.warn('Failed to persist page translation budget snapshot', error);
    });
  };
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
    sizeTier,
    persistedBudget,
    onBudgetSnapshot,
    logEnabled,
    debug,
  };
};
