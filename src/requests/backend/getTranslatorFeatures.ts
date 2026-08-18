import { Schema } from 'effect';

import { ArrayOfStrings } from '../../types/runtime';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [getTranslatorFeaturesFactory, getTranslatorFeatures] = buildBackendRequest(
	'getTranslatorFeatures',
	{
		responseValidator: Schema.Struct({
			supportedLanguages: ArrayOfStrings,
			isSupportAutodetect: Schema.Boolean,
		}),

		factoryHandler:
			({ backgroundContext }) =>
			async () => {
				const translateManager = await backgroundContext.getTranslateManager();
				return translateManager.getTranslatorFeatures();
			},
	},
);
