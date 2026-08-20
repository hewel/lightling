import { TranslatorsCacheStorage } from '../../app/Background/TranslatorsCacheStorage';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [clearCacheFactory, clearCache] = buildBackendRequest('clearCache', {
  factoryHandler: () => async () => {
    await TranslatorsCacheStorage.clearAll();
  },
});
