import { isRequireTranslateBySitePreferences } from '../../../pages/popup/tabs/PageTranslator/PageTranslator.utils/utils';
import { getLanguagePreferences } from '../../../requests/backend/autoTranslation/languagePreferences/getLanguagePreferences';
import { getSitePreferences } from '../../../requests/backend/autoTranslation/sitePreferences/getSitePreferences';
import { getTranslatorFeatures } from '../../../requests/backend/getTranslatorFeatures';

export type AutoTranslationDecisionInput = {
  isTranslating: boolean;
  pageLanguage: string | null;
  userLanguage: string;
};

export type AutoTranslationDecisionAdapters = {
  getPageHost: () => string;
  getSitePreferences: typeof getSitePreferences;
  getLanguagePreferences: typeof getLanguagePreferences;
  getTranslatorFeatures: typeof getTranslatorFeatures;
};

const defaultAdapters: AutoTranslationDecisionAdapters = {
  getPageHost: () => location.host,
  getSitePreferences,
  getLanguagePreferences,
  getTranslatorFeatures,
};

export const shouldAutoTranslate = async (
  { isTranslating, pageLanguage, userLanguage }: AutoTranslationDecisionInput,
  adapters: AutoTranslationDecisionAdapters = defaultAdapters,
): Promise<boolean> => {
  // Skip if page already in translating
  if (isTranslating) return false;

  // TODO: make it option
  const isAllowTranslateSameLanguages = true;

  // Skip by language directions
  if (pageLanguage === null) return false;
  if (pageLanguage === userLanguage && !isAllowTranslateSameLanguages) return false;

  let isNeedAutoTranslate = false;

  // Consider site preferences
  const sitePreferences = await adapters.getSitePreferences(adapters.getPageHost());
  const isSiteRequireTranslate = isRequireTranslateBySitePreferences(
    pageLanguage,
    sitePreferences,
  );
  if (isSiteRequireTranslate !== null) {
    // Never translate this site
    if (!isSiteRequireTranslate) return false;

    // Otherwise translate
    isNeedAutoTranslate = true;
  }

  // Consider common language preferences
  const isLanguageRequireTranslate = await adapters.getLanguagePreferences(pageLanguage);
  if (isLanguageRequireTranslate !== null) {
    // Never translate this language
    if (!isLanguageRequireTranslate) return false;

    // Otherwise translate
    isNeedAutoTranslate = true;
  }

  if (!isNeedAutoTranslate) return false;

  const { supportedLanguages } = await adapters.getTranslatorFeatures();
  return [pageLanguage, userLanguage].every((language) =>
    supportedLanguages.includes(language),
  );
};
