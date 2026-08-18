import { Schema } from 'effect';

import { NonNaNNumber } from '@/lib/types';
import { TranslationType } from '@/types/translation/Translation';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { findEntry } from './data';

export const [findTranslationFactory, findTranslation] = buildBackendRequest(
	'findTranslation',
	{
		requestValidator: Schema.Struct({
			from: Schema.optional(TranslationType.fields.from),
			to: Schema.optional(TranslationType.fields.to),
			originalText: Schema.optional(TranslationType.fields.originalText),
			translatedText: Schema.optional(TranslationType.fields.translatedText),
		}),
		responseValidator: Schema.Union([NonNaNNumber, Schema.Null]),

		factoryHandler: () => async (translation) => {
			const entry = await findEntry({ translation });
			return entry === null ? null : entry.key;
		},
	},
);
