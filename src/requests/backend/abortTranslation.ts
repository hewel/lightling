import { Schema } from 'effect';

import { buildBackendRequest } from '../utils/requestBuilder';

export const [abortTranslationFactory, abortTranslation] = buildBackendRequest(
  'abortTranslation',
  {
    requestValidator: Schema.Struct({
      context: Schema.String,
    }),
    factoryHandler:
      ({ backgroundContext }) =>
      async ({ context }) => {
        const translateManager = await backgroundContext.getTranslateManager();
        await translateManager.abort(context);
      },
  },
);
