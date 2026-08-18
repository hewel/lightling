import { TranslatorsCacheStorage } from '@/app/Background/TranslatorsCacheStorage';
import { NonNaNNumber } from '@/lib/types';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { formatToCustomTranslatorId } from '.';
import { applyTranslators } from './applyTranslators';
import * as db from './data';

export const [deleteTranslatorFactory, deleteTranslator] = buildBackendRequest(
	'deleteTranslator',
	{
		requestValidator: NonNaNNumber,

		factoryHandler: () => async (translatorId) => {
			// Delete translator
			await db.deleteTranslator(translatorId);
			await applyTranslators();

			// Delete translator cache
			const cache = new TranslatorsCacheStorage(
				formatToCustomTranslatorId(translatorId),
			);
			await cache.clear();
		},
	},
);
