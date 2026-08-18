import { useCallback, useEffect, useState } from 'react';

import { getTTSLanguages } from '../../requests/backend/tts/getTTSLanguages';
import { onAppConfigUpdated } from '../../requests/global/appConfigUpdate';

import { isDeepEqual } from '../utils';
import { useIsMounted } from './useIsMounted';

export const useTTSLanguages = () => {
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>([]);
  const isMounted = useIsMounted();

  // Get languages
  useEffect(() => {
    getTTSLanguages().then(setSupportedLanguages);
  }, []);

  // Update languages by change TTS module
  useEffect(() => {
    const cleanup = onAppConfigUpdated(() => {
      getTTSLanguages().then((langs) => {
        if (!isMounted()) return;

        setSupportedLanguages((value) => {
          return isDeepEqual(value, langs) ? value : langs;
        });
      });
    });

    return cleanup;
  }, [isMounted]);

  const isSupportedLanguage = useCallback(
    (lang: string) => supportedLanguages.includes(lang),
    [supportedLanguages],
  );

  return {
    supportedLanguages,
    isSupportedLanguage,
  };
};
