import { Schema } from 'effect';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [getUserLanguagePreferencesFactory, getUserLanguagePreferences] =
  buildBackendRequest('getUserLanguagePreferences', {
    responseValidator: Schema.String,

    factoryHandler:
      ({ config }) =>
      async () => {
        const { language } = await config.get();
        return language;
      },
  });
