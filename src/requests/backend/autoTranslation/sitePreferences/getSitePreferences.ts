import { Schema } from 'effect';

import { buildBackendRequest } from '@/requests/utils/requestBuilder';

import { dataSignature, getPreferences } from './utils';

export const [getSitePreferencesFactory, getSitePreferencesReq] = buildBackendRequest(
	'getSitePreferences',
	{
		requestValidator: Schema.String,
		responseValidator: Schema.Union([dataSignature, Schema.Null]),

		factoryHandler: () => getPreferences,
	},
);

export const getSitePreferences = (site: string) => getSitePreferencesReq(site);
