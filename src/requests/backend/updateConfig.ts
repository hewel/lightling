import { Schema } from 'effect';

import { getMessage } from '../../lib/language';
import { checkTypeByPath } from '../../lib/types';
import { setValueAtPath } from '../../lib/utils';
import { AppConfig } from '../../types/runtime';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [updateConfigFactory, updateConfig] = buildBackendRequest('updateConfig', {
  requestValidator: Schema.Record(Schema.String, Schema.Unknown),
  responseValidator: Schema.Struct({
    success: Schema.Boolean,
    errors: Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Null]),
  }),

  /**
   * Partial update config by paths
   */
  factoryHandler:
    ({ config, backgroundContext }) =>
    async (configMap) => {
      // Get actual config
      const actualConfig = await config.get();

      // Clone
      const newConfigSegments = structuredClone(actualConfig);

      // Handle
      const errors: Record<string, string> = {};
      for (const path in configMap) {
        const pathArray = path.split('.');
        if (pathArray.length === 0) {
          throw new TypeError(`Invalid path "${path}"`);
        }

        const value = configMap[path];

        // Validate type of new value
        if (checkTypeByPath(AppConfig, pathArray, value)) {
          setValueAtPath(newConfigSegments, pathArray, value);
        } else {
          errors[path] = getMessage('settings_message_common_invalidValueType');
        }
      }

      // Validate translator
      const translateManager = await backgroundContext.getTranslateManager();
      if ('translatorModule' in newConfigSegments) {
        const translators = translateManager.getTranslators();
        const translatorId = newConfigSegments.translatorModule;
        if (!(translatorId in translators)) {
          throw new Error(`Translator "${translatorId}" is unavailable`);
        }
      }

      if (Object.keys(errors).length > 0) {
        return {
          success: false,
          errors,
        };
      } else {
        console.warn('Update config', actualConfig, newConfigSegments);

        await config.set(newConfigSegments);
        return {
          success: true,
          errors: null,
        };
      }
    },
});
