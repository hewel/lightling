import { Schema } from 'effect';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { pushLanguage } from '.';

export const [addRecentUsedLanguageFactory, addRecentUsedLanguage] = buildBackendRequest(
	'addRecentUsedLanguage',
	{
		requestValidator: Schema.String,

		factoryHandler: () => async (language) => {
			pushLanguage(language);
		},
	},
);
