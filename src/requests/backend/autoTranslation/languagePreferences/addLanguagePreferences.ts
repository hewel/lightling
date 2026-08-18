import { Schema } from 'effect';

import { buildBackendRequest } from '@/requests/utils/requestBuilder';

import { addLanguage, dataSignature, LanguageInfo } from './utils';

export const [addLanguagePreferencesFactory, addLanguagePreferencesReq] =
  buildBackendRequest('addLanguagePreferences', {
    requestValidator: Schema.Struct({
      lang: Schema.String,
      preferences: dataSignature,
    }),

    factoryHandler:
      () =>
      ({ lang, preferences }) =>
        addLanguage(lang, preferences),
  });

export const addLanguagePreferences = (lang: string, preferences: LanguageInfo) =>
  addLanguagePreferencesReq({ lang, preferences });
