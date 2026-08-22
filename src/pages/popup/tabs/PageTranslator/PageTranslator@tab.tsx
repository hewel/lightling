import type { TabComponent } from '../../layout/PopupWindow';

import { PageTranslator } from './PageTranslator';
import {
  initializePageTranslatorEntry,
  type PageTranslatorEntryInitData,
  usePageTranslatorEntry,
} from './usePageTranslatorEntry';

export type { SitePrefs } from './usePageTranslatorEntry';
export type InitData = PageTranslatorEntryInitData;

/**
 * Wrapper on `PageTranslator` to use as tab in `PopupWindow`
 */
export const PageTranslatorTab: TabComponent<typeof initializePageTranslatorEntry> = ({
  config,
  translatorFeatures,
  initData,
  isMobile,
}) => {
  const entry = usePageTranslatorEntry({ config, initData });

  return (
    <PageTranslator
      translatorFeatures={translatorFeatures}
      showCounters={config.popupTab.pageTranslator.showCounters}
      toggleTranslate={entry.toggleTranslate}
      exportLog={entry.exportLog}
      counters={entry.counters}
      isTranslated={entry.isTranslated}
      from={entry.from}
      setFrom={entry.setFrom}
      to={entry.to}
      setTo={entry.setTo}
      hostname={entry.hostname}
      sitePreferences={entry.sitePreferences}
      setSitePreferences={entry.setSitePreferences}
      languagePreferences={entry.languagePreferences}
      setLanguagePreferences={entry.setLanguagePreferences}
      isShowOptions={entry.isShowOptions}
      setIsShowOptions={entry.setIsShowOptions}
      isMobile={isMobile}
    />
  );
};

PageTranslatorTab.init = initializePageTranslatorEntry;
