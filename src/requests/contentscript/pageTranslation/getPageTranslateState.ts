import { Schema } from 'effect';

import { NonNaNNumber } from '@/lib/types';

import { buildTabRequest } from '../../utils/requestBuilder';

export const PageTranslateStateSignature = Schema.Struct({
	resolved: NonNaNNumber,
	rejected: NonNaNNumber,
	pending: NonNaNNumber,
});

export const [getPageTranslateStateFactory, getPageTranslateState] = buildTabRequest(
	'getPageTranslateState',
	{
		responseValidator: Schema.Struct({
			isTranslated: Schema.Boolean,
			counters: PageTranslateStateSignature,
			translateDirection: Schema.Union([
				Schema.Struct({
					from: Schema.String,
					to: Schema.String,
				}),
				Schema.Null,
			]),
		}),

		factoryHandler:
			({ pageTranslationContext }) =>
			async () => {
				const domTranslator = pageTranslationContext.getDOMTranslator();
				if (domTranslator === null) {
					throw new Error('DOM translator are empty');
				}

				return domTranslator.getStatus();
			},
	},
);
