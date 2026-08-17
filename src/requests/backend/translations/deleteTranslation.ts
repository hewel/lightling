import { type } from '../../../lib/types';
import { buildBackendRequest } from '../../utils/requestBuilder';

import { notifyDictionaryEntryDelete } from '.';
import { deleteEntry } from './data';

export const [deleteTranslationFactory, deleteTranslationReq] = buildBackendRequest(
	'deleteTranslation',
	{
		requestValidator: type.number,
		factoryHandler: () => async (id) => {
			await deleteEntry(id);

			notifyDictionaryEntryDelete(id);
		},
	},
);

export const deleteTranslation = (id: number) => deleteTranslationReq(id);
