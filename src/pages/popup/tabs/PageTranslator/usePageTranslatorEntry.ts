import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import type { PageTranslatorStats } from '@/app/ContentScript/PageTranslator/PageTranslator';
import { pageTranslatorStatsUpdatedHandler } from '@/app/ContentScript/PageTranslator/requests/pageTranslatorStatsUpdated';
import { getCurrentTab, getCurrentTabId } from '@/lib/browser/tabs';
import { useStateWithProxy } from '@/lib/hooks/useStateWithProxy';
import { addLanguagePreferences } from '@/requests/backend/autoTranslation/languagePreferences/addLanguagePreferences';
import { deleteLanguagePreferences } from '@/requests/backend/autoTranslation/languagePreferences/deleteLanguagePreferences';
import { getLanguagePreferences } from '@/requests/backend/autoTranslation/languagePreferences/getLanguagePreferences';
import { deleteSitePreferences } from '@/requests/backend/autoTranslation/sitePreferences/deleteSitePreferences';
import { getSitePreferences } from '@/requests/backend/autoTranslation/sitePreferences/getSitePreferences';
import { setSitePreferences } from '@/requests/backend/autoTranslation/sitePreferences/setSitePreferences';
import type { SiteData } from '@/requests/backend/autoTranslation/sitePreferences/utils';
import { getPageLanguage } from '@/requests/contentscript/getPageLanguage';
import { disableTranslatePage } from '@/requests/contentscript/pageTranslation/disableTranslatePage';
import { enableTranslatePage } from '@/requests/contentscript/pageTranslation/enableTranslatePage';
import { getPageTranslateState } from '@/requests/contentscript/pageTranslation/getPageTranslateState';
import { getPageTranslationLog } from '@/requests/contentscript/pageTranslation/getPageTranslationLog';
import type { AppConfigType } from '@/types/runtime';

import type { TabData } from '../../layout/PopupWindow';

import { languagePreferenceOptions, sitePreferenceOptions } from './PageTranslator';
import { exportPageTranslationLogFile } from './PageTranslator.utils/exportPageTranslationLog';
import { PageTranslationStorage } from './PageTranslator.utils/PageTranslationStorage';
import {
  getTranslatePreferencesForSite,
  mapLanguagePreferences,
} from './PageTranslator.utils/utils';

export type SitePrefs = SiteData | null;
export { mapLanguagePreferences };

export interface PageTranslatorEntryInitData {
  tabId: number;
  hostname: string;
  sitePreferences: SitePrefs;
  languagePreferences: string;
  sitePreferencesForLanguage: string;
  isTranslated: boolean;
  counters: PageTranslatorStats;
  direction: {
    from: string;
    to: string;
  };
  isShowOptions: boolean;
}

export interface PageTranslatorEntryProps {
  config: AppConfigType;
  initData: PageTranslatorEntryInitData;
}

export interface PageTranslatorEntryState {
  hostname: string;
  from: string | undefined;
  setFrom: Dispatch<SetStateAction<string | undefined>>;
  to: string | undefined;
  setTo: Dispatch<SetStateAction<string | undefined>>;
  sitePreferences: string;
  setSitePreferences: (value: string) => void;
  languagePreferences: string;
  setLanguagePreferences: (value: string) => void;
  isTranslated: boolean;
  counters: PageTranslatorStats;
  isShowOptions: boolean;
  setIsShowOptions: Dispatch<SetStateAction<boolean>>;
  toggleTranslate: () => void;
  exportLog?: () => void;
}

type StatsSubscription = (
  handler: (stats: PageTranslatorStats, tabId?: number) => void,
) => () => void;

export const subscribeToPageTranslatorStats = (
  tabId: number,
  setCounters: (stats: PageTranslatorStats) => void,
  subscribe: StatsSubscription = pageTranslatorStatsUpdatedHandler,
): (() => void) =>
  subscribe((counters, messageTabId) => {
    if (messageTabId !== tabId) return;

    setCounters(counters);
  });

interface LanguagePreferenceActions {
  add: (language: string, enabled: boolean) => unknown;
  remove: (language: string) => unknown;
}

export const applyLanguagePreference = (
  state: string,
  language: string | undefined,
  setState: (state: string) => void,
  actions: LanguagePreferenceActions = {
    add: addLanguagePreferences,
    remove: deleteLanguagePreferences,
  },
): void => {
  setState(state);

  if (language === undefined) return;

  switch (state) {
    case languagePreferenceOptions.ENABLE:
      actions.add(language, true);
      return;
    case languagePreferenceOptions.DISABLE_FOR_ALL:
      actions.add(language, false);
      return;
    case languagePreferenceOptions.DISABLE:
      actions.remove(language);
      return;
    default:
      console.error('Data for error below', state);
      throw new Error('Unknown type for "translateLang"');
  }
};

interface SitePreferenceActions {
  remove: (hostname: string) => unknown;
  set: (hostname: string, preferences: NonNullable<SitePrefs>) => unknown;
}

export const applySitePreference = (
  state: string,
  language: string | undefined,
  hostname: string,
  initialPreferences: SitePrefs,
  setState: (state: string) => void,
  actions: SitePreferenceActions = {
    remove: deleteSitePreferences,
    set: setSitePreferences,
  },
): void => {
  const newState: NonNullable<SitePrefs> = initialPreferences || {
    enableAutoTranslate: true,
    autoTranslateLanguages: [],
    autoTranslateIgnoreLanguages: [],
  };

  switch (state) {
    case sitePreferenceOptions.DEFAULT:
      actions.remove(hostname);
      setState(state);
      return;
    case sitePreferenceOptions.DEFAULT_FOR_THIS_LANGUAGE:
      newState.autoTranslateLanguages = newState.autoTranslateLanguages.filter(
        (lang) => lang !== language,
      );
      newState.autoTranslateIgnoreLanguages =
        newState.autoTranslateIgnoreLanguages.filter((lang) => lang !== language);

      if (
        newState.autoTranslateLanguages.length === 0 &&
        newState.autoTranslateIgnoreLanguages.length === 0
      ) {
        actions.remove(hostname);
        setState(state);
        return;
      }
      break;
    case sitePreferenceOptions.ALWAYS:
      newState.enableAutoTranslate = true;
      newState.autoTranslateLanguages = [];
      newState.autoTranslateIgnoreLanguages = [];
      break;
    case sitePreferenceOptions.NEVER:
      newState.enableAutoTranslate = false;
      newState.autoTranslateLanguages = [];
      break;
    case sitePreferenceOptions.ALWAYS_FOR_THIS_LANGUAGE:
      if (language === undefined) return;

      newState.enableAutoTranslate = true;
      newState.autoTranslateIgnoreLanguages =
        newState.autoTranslateIgnoreLanguages.filter((lang) => lang !== language);
      if (!newState.autoTranslateLanguages.includes(language)) {
        newState.autoTranslateLanguages.push(language);
      }
      break;
    case sitePreferenceOptions.NEVER_FOR_THIS_LANGUAGE:
      if (language === undefined) return;

      newState.autoTranslateLanguages = newState.autoTranslateLanguages.filter(
        (lang) => lang !== language,
      );
      if (!newState.autoTranslateIgnoreLanguages.includes(language)) {
        newState.autoTranslateIgnoreLanguages.push(language);
      }
      break;
    default:
      console.error('Data for error below', state);
      throw new Error('Unknown type for "translateSite"');
  }

  actions.set(hostname, newState);
  setState(state);
};

export const usePageTranslatorEntry = ({
  config,
  initData,
}: PageTranslatorEntryProps): PageTranslatorEntryState => {
  const {
    hostname,
    tabId,
    isTranslated: isTranslatedInit,
    counters: countersInit,
    direction: { from: initFrom, to: initTo },
  } = initData;

  const [from, setFrom] = useState<string | undefined>(initFrom);
  const [to, setTo] = useState<string | undefined>(initTo);
  const [sitePreferences, setSitePreferencesState] = useState<string>(
    initData.sitePreferencesForLanguage,
  );

  useEffect(() => {
    if (from === undefined) return;

    setSitePreferencesState(
      getTranslatePreferencesForSite(from, initData.sitePreferences),
    );
  }, [from, initData.sitePreferences]);

  const setSitePreferencesProxy = useCallback(
    (state: string) => {
      applySitePreference(
        state,
        from,
        hostname,
        initData.sitePreferences,
        setSitePreferencesState,
      );
    },
    [from, hostname, initData.sitePreferences],
  );

  const [languagePreferences, setLanguagePreferencesState] = useState<string>(
    initData.languagePreferences,
  );

  useEffect(() => {
    if (from === undefined) {
      setLanguagePreferencesState(languagePreferenceOptions.DISABLE);
      return;
    }

    getLanguagePreferences(from).then((state) => {
      setLanguagePreferencesState(mapLanguagePreferences(state));
    });
  }, [from]);

  const setLanguagePreferencesProxy = useCallback(
    (state: string) => {
      applyLanguagePreference(state, from, setLanguagePreferencesState);
    },
    [from],
  );

  const [isTranslated, setIsTranslated] = useState(isTranslatedInit);
  const toggleTranslate = useCallback(() => {
    if (from === undefined || to === undefined) return;

    if (!isTranslated) {
      enableTranslatePage(tabId, from, to)
        .then(() => {
          setIsTranslated(true);
        })
        .catch(console.warn);
      return;
    }

    disableTranslatePage(tabId)
      .then(() => {
        setIsTranslated(false);
      })
      .catch(console.warn);
  }, [from, isTranslated, tabId, to]);

  const [counters, setCounters] = useState<PageTranslatorStats>(countersInit);
  useEffect(() => subscribeToPageTranslatorStats(tabId, setCounters), [tabId]);

  const pageTranslationStorage = useMemo(() => new PageTranslationStorage(), []);
  const [isShowOptions, setIsShowOptions] = useStateWithProxy<boolean>(
    initData.isShowOptions,
    (state, setState) => {
      if (typeof state !== 'function') {
        pageTranslationStorage.updateData({
          // oxlint-disable-next-line typescript/no-unnecessary-type-conversion
          optionsSpoilerState: Boolean(state),
        });
      }

      setState(state);
    },
  );

  const exportLog = useCallback(async () => {
    try {
      const log = await getPageTranslationLog(tabId);
      exportPageTranslationLogFile(log, hostname);
    } catch (error) {
      console.warn('Failed to export page translation log', error);
    }
  }, [hostname, tabId]);

  return {
    from,
    setFrom,
    to,
    setTo,
    hostname,
    sitePreferences,
    setSitePreferences: setSitePreferencesProxy,
    languagePreferences,
    setLanguagePreferences: setLanguagePreferencesProxy,
    isTranslated,
    counters,
    isShowOptions,
    setIsShowOptions,
    toggleTranslate,
    exportLog:
      config.pageTranslator.enableLogExport && isTranslated ? exportLog : undefined,
  };
};

export const initializePageTranslatorEntry = async ({
  translatorFeatures,
  config,
}: Pick<
  TabData,
  'translatorFeatures' | 'config'
>): Promise<PageTranslatorEntryInitData> => {
  const tab = await getCurrentTab();
  const pageUrl = tab.url;
  if (pageUrl === undefined) {
    throw Error(`Can't get access to tab URL`);
  }

  const hostname = new URL(pageUrl).host;
  const sitePreferences = await getSitePreferences(hostname);
  const tabId = await getCurrentTabId();
  const { isTranslated, counters, translateDirection } =
    await getPageTranslateState(tabId);

  let from: string | null = null;
  let to: string | null = null;

  if (translateDirection !== null) {
    from = translateDirection.from;
    to = translateDirection.to;
  }

  if (!isTranslated) {
    from = await getPageLanguage(tabId);
  }

  if (from === null) {
    from = translatorFeatures.isSupportAutodetect
      ? 'auto'
      : translatorFeatures.supportedLanguages[0];
  }

  if (to === null) {
    to = config.language;
  }

  const sitePreferencesForLanguage = getTranslatePreferencesForSite(
    from,
    sitePreferences,
  );
  const languagePreferences =
    await getLanguagePreferences(from).then(mapLanguagePreferences);
  const pageTranslationStorage = new PageTranslationStorage();
  const isShowOptions = await pageTranslationStorage
    .getData()
    .then((data) => data.optionsSpoilerState);

  return {
    tabId,
    hostname,
    sitePreferences,
    languagePreferences,
    sitePreferencesForLanguage,
    isTranslated,
    counters,
    direction: { from, to },
    isShowOptions,
  };
};
