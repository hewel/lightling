import { Schema } from 'effect';

import { NonNaNNumber } from '@/lib/types';
import { TranslationType } from '@/types/translation/Translation';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { addEntry } from './data';

export const [addTranslationHistoryEntryFactory, addTranslationHistoryEntry] =
  buildBackendRequest('addTranslationHistoryEntry', {
    requestValidator: Schema.Struct({
      translation: TranslationType,
      origin: Schema.String,
    }),
    responseValidator: Schema.Union([NonNaNNumber, Schema.Null]),

    factoryHandler:
      ({ config }) =>
      async (data) => {
        const { history } = await config.get();
        if (!history.enabled) return null;

        return addEntry({ ...data, timestamp: Date.now() });
      },
  });
