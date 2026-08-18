import { Schema } from 'effect';

import { buildBackendRequest } from '@/requests/utils/requestBuilder';

import { dataSignature, setPreferences, SiteData } from './utils';

export const [setSitePreferencesFactory, setSitePreferencesReq] = buildBackendRequest(
  'setSitePreferences',
  {
    requestValidator: Schema.Struct({
      site: Schema.String,
      options: dataSignature,
    }),

    factoryHandler:
      () =>
      ({ site, options }) =>
        setPreferences(site, options),
  },
);

export const setSitePreferences = (site: string, data: SiteData) =>
  setSitePreferencesReq({ site, options: data });
