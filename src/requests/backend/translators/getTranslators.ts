import { buildBackendRequest } from '../../utils/requestBuilder';

import { CustomTranslator } from '.';
import * as db from './data';

export const [getTranslatorsFactory, getTranslators] = buildBackendRequest(
  'getTranslators',
  {
    factoryHandler: () => (): Promise<CustomTranslator[]> =>
      db
        .getTranslators({ order: 'asc' })
        .then((translators) => translators.map(({ key: id, data }) => ({ id, ...data }))),
  },
);
