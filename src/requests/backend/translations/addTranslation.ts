import { NonNaNNumber } from '@/lib/types';
import { TranslationType } from '@/types/translation/Translation';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { notifyDictionaryEntryAdd } from '.';
import { addEntry } from './data';

export const [addTranslationFactory, addTranslation] = buildBackendRequest(
	'addTranslation',
	{
		requestValidator: TranslationType,
		responseValidator: NonNaNNumber,

		factoryHandler: () => async (translation) => {
			const id = await addEntry({
				translation,
				timestamp: new Date().getTime(),
			});

			notifyDictionaryEntryAdd(translation);

			return id;
		},
	},
);
