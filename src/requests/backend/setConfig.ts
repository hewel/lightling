import { tryDecode } from '@/lib/types';

import { AppConfig } from '../../types/runtime';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [setConfigFactory, setConfig] = buildBackendRequest('setConfig', {
  requestValidator: AppConfig,
  factoryHandler:
    ({ config }) =>
    async (newConfig) => {
      // `buildBackendRequest` validates but forwards the original payload, and its
      // same-frame path bypasses validation entirely, so persist the decoded object
      // with schema defaults (such as explicit `null` execution overrides) applied
      await config.set(tryDecode(AppConfig, newConfig));
    },
});
