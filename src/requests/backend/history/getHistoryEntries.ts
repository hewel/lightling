import { Schema } from 'effect';

import { buildBackendRequest } from '../../utils/requestBuilder';

import {
  getEntries,
  TranslationHistoryEntryWithKeyType,
  TranslationHistoryFetcherOptions,
} from './data';

export const [getTranslationHistoryEntriesFactory, getTranslationHistoryEntries] =
  buildBackendRequest('getTranslationHistoryEntries', {
    responseValidator: Schema.mutable(Schema.Array(TranslationHistoryEntryWithKeyType)),
    factoryHandler:
      () =>
      (options: TranslationHistoryFetcherOptions = {}) =>
        getEntries(options),
  });
