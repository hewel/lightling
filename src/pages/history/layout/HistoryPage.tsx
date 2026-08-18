import { isEqual } from 'lodash';
import { FC, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import * as stylex from '@stylexjs/stylex';

import { Page } from '@/components/layouts/Page/Page';
import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { telemetry } from '@/lib/telemetry/singleton';
import { getConfig } from '@/requests/backend/getConfig';
import { ITranslationHistoryEntryWithKey } from '@/requests/backend/history/data';
import { getTranslationHistoryEntries } from '@/requests/backend/history/getHistoryEntries';

import {
  TranslationsHistory,
  TranslationsHistoryFetcher,
} from './TranslationsHistory/TranslationsHistory';

const styles = stylex.create({
  root: {
    padding: '1rem',
  },
});

export const HistoryPage: FC = () => {
  useLayoutEffect(() => {
    telemetry.track(TELEMETRY_EVENT_NAME.SCREEN_SHOWN, { screen: 'History' });
  }, []);

  const [translations, setTranslations] = useState<
    null | ITranslationHistoryEntryWithKey[]
  >(null);

  const [hasMoreTranslations, setIsHasMoreTranslations] = useState(true);
  const requestTranslations: TranslationsHistoryFetcher = useCallback((options) => {
    getTranslationHistoryEntries(options).then((entries) => {
      setTranslations((currentEntries) => {
        // Check should we try load more data or not
        const hasChanges =
          currentEntries === null ||
          currentEntries.length !== entries.length ||
          !isEqual(currentEntries, entries);
        setIsHasMoreTranslations(hasChanges);

        return entries;
      });
    });
  }, []);

  const [isHistoryEnabled, setIsHistoryEnabled] = useState<null | boolean>(null);
  useEffect(() => {
    getConfig().then((config) => {
      setIsHistoryEnabled(config.history.enabled);
    });
  }, []);

  // Wait render nested components with new props
  const [isLoaded, setIsLoaded] = useState(false);
  useLayoutEffect(() => {
    if (isHistoryEnabled === null) return;
    if (translations === null) return;

    setIsLoaded(true);
  }, [translations, isHistoryEnabled]);

  return (
    <Page loading={!isLoaded} renderWhileLoading>
      <div {...stylex.props(styles.root)}>
        <TranslationsHistory
          {...{
            translations: translations || [],
            hasMoreTranslations,
            requestTranslations,
            isHistoryEnabled: Boolean(isHistoryEnabled),
          }}
        />
      </div>
    </Page>
  );
};
