import { createObservableStore, ObservableStore } from '@/lib/store';
import { isDeepEqual } from '@/lib/utils';

import { onHotkeysPressed } from '../../components/controls/Hotkey/utils';
import { getPageLanguage } from '../../lib/browser';
import { isRequireTranslateBySitePreferences } from '../../pages/popup/tabs/PageTranslator/PageTranslator.utils/utils';
import { getLanguagePreferences } from '../../requests/backend/autoTranslation/languagePreferences/getLanguagePreferences';
// Requests
import { getSitePreferences } from '../../requests/backend/autoTranslation/sitePreferences/getSitePreferences';
import { getTranslatorFeatures } from '../../requests/backend/getTranslatorFeatures';
import { AppConfigType } from '../../types/runtime';

import { PageTranslatorController } from './PageTranslator/PageTranslatorController';
import { PageTranslatorManager } from './PageTranslator/PageTranslatorManager';
import { SelectTranslatorController } from './SelectTranslator/SelectTranslatorController';
import { SelectTranslatorManager } from './SelectTranslator/SelectTranslatorManager';

export type PageTranslationOptions = {
  from: string;
  to: string;
};

export type PageData = {
  language: string | null;
};

type PageContextState = {
  config: AppConfigType;
  pageTranslation: PageTranslationOptions | null;
  pageData: PageData;
};

export class PageTranslationContext {
  private readonly $config: ObservableStore<AppConfigType>;
  private readonly $context: ObservableStore<PageContextState>;

  constructor($config: ObservableStore<AppConfigType>) {
    this.$config = $config;
    this.$context = createObservableStore<PageContextState>({
      config: $config.getState(),
      pageTranslation: null,
      pageData: { language: null },
    });

    this.$config.subscribe((config) => this.$context.setState({ config }));
  }

  private readonly updatePageTranslationState = (
    pageTranslation: PageTranslationOptions | null,
  ) => {
    if (isDeepEqual(this.$context.getState().pageTranslation, pageTranslation)) return;
    this.$context.setState({ pageTranslation });
  };

  private readonly controllers: {
    pageTranslator: PageTranslatorController | null;
    selectTranslator: SelectTranslatorController | null;
  } = {
    pageTranslator: null,
    selectTranslator: null,
  };

  public getDOMTranslator() {
    return this.controllers.pageTranslator;
  }

  public getTextTranslator() {
    return this.controllers.selectTranslator;
  }

  public async start() {
    const selectSlice = (state: PageContextState) => ({
      enabled:
        state.config.selectTranslator.enabled &&
        (state.pageTranslation === null ||
          !state.config.selectTranslator.disableWhileTranslatePage),
      config: state.config.selectTranslator,
      pageData: state.pageData,
    });
    const $selectTranslatorState = createObservableStore(
      selectSlice(this.$context.getState()),
    );
    this.$context.subscribe(
      selectSlice,
      (slice) => $selectTranslatorState.setState(slice),
      { equalityFn: isDeepEqual },
    );

    const selectTranslatorManager = new SelectTranslatorManager($selectTranslatorState);
    selectTranslatorManager.start();
    this.controllers.selectTranslator = new SelectTranslatorController(
      selectTranslatorManager,
    );

    const pageSlice = (state: PageContextState) => ({
      state: state.pageTranslation,
      config: state.config.pageTranslator,
    });
    const $pageTranslatorState = createObservableStore(
      pageSlice(this.$context.getState()),
    );
    this.$context.subscribe(pageSlice, (slice) => $pageTranslatorState.setState(slice), {
      equalityFn: isDeepEqual,
    });

    const pageTranslatorManager = new PageTranslatorManager($pageTranslatorState);
    pageTranslatorManager.start();
    this.controllers.pageTranslator = new PageTranslatorController(
      pageTranslatorManager,
      this.updatePageTranslationState,
    );

    void this.scanPage();

    let hotkeysObserverCleanup: (() => void) | null = null;
    this.$context.subscribe(
      (state) => ({
        hotkeys: state.config.pageTranslator.toggleTranslationHotkey,
        userLanguage: state.config.language,
        pageLanguage: state.pageData.language,
        isPageTranslated: state.pageTranslation !== null,
      }),
      ({ hotkeys, pageLanguage, userLanguage, isPageTranslated }) => {
        if (hotkeysObserverCleanup) {
          hotkeysObserverCleanup();
          hotkeysObserverCleanup = null;
        }

        if (hotkeys) {
          hotkeysObserverCleanup = onHotkeysPressed(hotkeys, (event) => {
            event.preventDefault();
            if (isPageTranslated) {
              this.updatePageTranslationState(null);
            } else {
              if (pageLanguage === null) {
                throw new Error('Page language not set');
              }

              this.updatePageTranslationState({
                from: pageLanguage,
                to: userLanguage,
              });
            }
          });
        }
      },
      { equalityFn: isDeepEqual, fireImmediately: true },
    );
  }

  private readonly scanPage = async () => {
    const config = this.$context.getState().config;
    const pageLanguage = await getPageLanguage(
      config.pageTranslator.detectLanguageByContent,
    );
    this.$context.setState({ pageData: { language: pageLanguage } });
    await this.initTranslation(this.$context.getState());
  };

  private readonly initTranslation = async ({
    config,
    pageTranslation,
    pageData,
  }: PageContextState) => {
    // Skip if page already in translating
    if (pageTranslation !== null) return;

    // TODO: make it option
    const isAllowTranslateSameLanguages = true;

    const pageLanguage = pageData.language;
    const userLanguage = config.language;

    // Skip by language directions
    if (pageLanguage === null) return;
    if (pageLanguage === userLanguage && !isAllowTranslateSameLanguages) return;

    let isNeedAutoTranslate = false;

    // Consider site preferences
    const pageHost = location.host;
    const sitePreferences = await getSitePreferences(pageHost);
    const isSiteRequireTranslate = isRequireTranslateBySitePreferences(
      pageLanguage,
      sitePreferences,
    );
    if (isSiteRequireTranslate !== null) {
      // Never translate this site
      if (!isSiteRequireTranslate) return;

      // Otherwise translate
      isNeedAutoTranslate = true;
    }

    // Consider common language preferences
    const isLanguageRequireTranslate = await getLanguagePreferences(pageLanguage);
    if (isLanguageRequireTranslate !== null) {
      // Never translate this language
      if (!isLanguageRequireTranslate) return;

      // Otherwise translate
      isNeedAutoTranslate = true;
    }

    if (isNeedAutoTranslate) {
      const { supportedLanguages } = await getTranslatorFeatures();
      const isLanguagesSupportedByTranslator = [pageLanguage, userLanguage].every(
        (language) => supportedLanguages.includes(language),
      );

      if (isLanguagesSupportedByTranslator) {
        this.updatePageTranslationState({
          from: pageLanguage,
          to: userLanguage,
        });
      }
    }
  };
}
