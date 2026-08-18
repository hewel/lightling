import { Schema } from 'effect';

import { validateTranslatorCode } from '@/lib/translators/customTranslators/utils';
import { NonNaNNumber } from '@/lib/types';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { applyTranslators } from './applyTranslators';
import * as db from './data';
import { TranslatorEntry } from './data';

export const [updateTranslatorFactory, updateTranslator] = buildBackendRequest(
  'updateTranslator',
  {
    requestValidator: Schema.Struct({
      id: NonNaNNumber,
      translator: TranslatorEntry,
    }),

    factoryHandler:
      () =>
      async ({ id, translator }) => {
        await validateTranslatorCode(translator.code);

        await db.updateTranslator(id, translator);
        await applyTranslators();
      },
  },
);
