import { Schema } from 'effect';

import { embeddedTranslators } from '@/app/Background';

import { buildBackendRequest } from '../../utils/requestBuilder';

import { formatToCustomTranslatorId } from '.';
import * as db from './data';

/**
 * Return all available translators both, embedded and custom
 */
export const [getAvailableTranslatorsFactory, getAvailableTranslators] =
  buildBackendRequest('getAvailableTranslators', {
    responseValidator: Schema.Record(Schema.String, Schema.String),
    factoryHandler: () => async () => {
      const translatorsMap: Record<string, string> = {};

      // Collect embedded translators
      for (const [key, translatorClass] of Object.entries(embeddedTranslators)) {
        translatorsMap[key] = translatorClass.translatorName;
      }

      // Add custom translators
      const customTranslators = await db.getTranslators({ order: 'asc' });
      customTranslators.forEach(({ key, data }) => {
        translatorsMap[formatToCustomTranslatorId(key)] = data.name;
      });

      return translatorsMap;
    },
  });
