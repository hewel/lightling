import { NonNaNNumber } from '@/lib/types';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { deleteEntry } from './data';

export const [deleteTranslationHistoryEntryFactory, deleteTranslationHistoryEntryReq] =
  buildBackendRequest('deleteTranslationHistoryEntry', {
    requestValidator: NonNaNNumber,
    factoryHandler: () => (id) => deleteEntry(id),
  });

export const deleteTranslationHistoryEntry = (id: number) =>
  deleteTranslationHistoryEntryReq(id);
