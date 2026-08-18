import { Schema } from 'effect';

import { getPageLanguage as getPageLanguageHelper } from '../../lib/browser';

import { buildTabRequest } from '../utils/requestBuilder';

export const [getPageLanguageFactory, getPageLanguage] = buildTabRequest(
	'getPageLanguage',
	{
		responseValidator: Schema.Union([Schema.String, Schema.Null]),
		factoryHandler:
			({ $config }) =>
			async () =>
				getPageLanguageHelper(
					$config.getState().pageTranslator.detectLanguageByContent,
					true,
				),
	},
);
