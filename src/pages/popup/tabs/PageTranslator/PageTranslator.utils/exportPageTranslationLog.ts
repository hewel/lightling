import { saveFile } from '@/lib/files';
import type { PageTranslationLog } from '@/lib/pageTranslation/log';

export const exportPageTranslationLogFile = (
  log: PageTranslationLog,
  hostname: string,
  exportedAt = new Date(),
): void => {
  const safeHostname = hostname.replace(/[^\p{L}\p{N}.-]+/gu, '_').slice(0, 80) || 'page';
  const timestamp = exportedAt.toISOString().replace(/[:.]/gu, '-');
  saveFile(
    new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }),
    `lightling-page-translation-log_${safeHostname}_${timestamp}.json`,
  );
};
