import { customTranslatorsFactory } from '@/requests/offscreen/customTranslators';

import type { AppConfigType } from '../../types/runtime';

import { Background } from '.';
import type { ObservableAsyncStorage } from '../ConfigStorage/ConfigStorage';
import { requestHandlers } from './requestHandlers';

export async function startLocalRuntime(config: ObservableAsyncStorage<AppConfigType>) {
  customTranslatorsFactory();

  const background = new Background(config);
  await background.start();

  requestHandlers.forEach((factory) => {
    factory({ config, backgroundContext: background });
  });
}
