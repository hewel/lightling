import type { PageTranslationLog } from '@/lib/pageTranslation/log';

import { buildTabRequest } from '../../utils/requestBuilder';
interface PageTranslationLogContext {
  getDOMTranslator(): {
    getTranslationLog(): Promise<PageTranslationLog | null>;
  } | null;
}

export const readPageTranslationLog = async (
  pageTranslationContext: PageTranslationLogContext,
): Promise<PageTranslationLog> => {
  const pageTranslator = pageTranslationContext.getDOMTranslator();
  if (pageTranslator === null) {
    throw new Error('Page translator is not initialized');
  }
  const log = await pageTranslator.getTranslationLog();
  if (log === null) {
    throw new Error('Page translation log export is not enabled');
  }
  return log;
};

export const [getPageTranslationLogFactory, getPageTranslationLog] = buildTabRequest<
  void,
  PageTranslationLog
>('getPageTranslationLog', {
  factoryHandler:
    ({ pageTranslationContext }) =>
    () =>
      readPageTranslationLog(pageTranslationContext),
});
