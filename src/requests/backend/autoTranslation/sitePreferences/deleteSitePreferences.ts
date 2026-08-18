import { Schema } from 'effect';

import { buildBackendRequest } from '../../../utils/requestBuilder';

import { deletePreferences } from './utils';

export const [deleteSitePreferencesFactory, deleteSitePreferencesReq] =
	buildBackendRequest('deleteSitePreferences', {
		requestValidator: Schema.String,

		factoryHandler: () => deletePreferences,
	});

export const deleteSitePreferences = (site: string) => deleteSitePreferencesReq(site);
