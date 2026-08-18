import { Schema } from 'effect';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { getEntries, TranslationEntryWithKeyType } from './data';

export const [getTranslationsFactory, getTranslations] = buildBackendRequest(
	'getTranslations',
	{
		responseValidator: Schema.mutable(Schema.Array(TranslationEntryWithKeyType)),
		factoryHandler: () => () => getEntries(),
	},
);
