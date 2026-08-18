import { buildBackendRequest } from '../../utils/requestBuilder';

import { notifyDictionaryClear } from '.';
import { flush } from './data';

export const [clearTranslationsFactory, clearTranslations] = buildBackendRequest(
  'clearTranslations',
  {
    factoryHandler: () => () => flush().then(notifyDictionaryClear),
  },
);
