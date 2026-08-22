import { createObservableStore, type ObservableStore } from '@/lib/store';
import { isDeepEqual } from '@/lib/utils';

import { onHotkeysPressed } from '../../components/controls/Hotkey/utils';
import { getPageLanguage } from '../../lib/browser';
import type { AppConfigType } from '../../types/runtime';

import { shouldAutoTranslate } from './PageTranslator/autoTranslationDecision';
import { PageTranslatorController } from './PageTranslator/PageTranslatorController';
import { PageTranslatorManager } from './PageTranslator/PageTranslatorManager';
import { SelectTranslatorController } from './SelectTranslator/SelectTranslatorController';
import { SelectTranslatorManager } from './SelectTranslator/SelectTranslatorManager';

export type PageTranslationOptions = {
  from: string;
  to: string;
};

export const withDetectedPageLanguage = (
  options: PageTranslationOptions,
  pageLanguage: string | null,
): PageTranslationOptions =>
  options.from === 'auto' && pageLanguage !== null
    ? { ...options, from: pageLanguage }
    : options;

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

  private readonly resolveTranslationOptions = async (
    options: PageTranslationOptions,
  ): Promise<PageTranslationOptions> => {
    if (options.from !== 'auto') return options;
    const detectedLanguage = await getPageLanguage(true);
    const pageLanguage = detectedLanguage ?? this.$context.getState().pageData.language;
    if (detectedLanguage !== null) {
      this.$context.setState({ pageData: { language: detectedLanguage } });
    }
    return withDetectedPageLanguage(options, pageLanguage);
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
      config: {
        ...state.config.pageTranslator,
        translatorModule: state.config.translatorModule,
        llmTranslator: state.config.llmTranslator,
      },
    });
    const $pageTranslatorState = createObservableStore(
      pageSlice(this.$context.getState()),
    );
    this.$context.subscribe(pageSlice, (slice) => $pageTranslatorState.setState(slice), {
      equalityFn: isDeepEqual,
    });

    let pageTranslatorManager: PageTranslatorManager | null = null;
    const getPageTranslatorManager = async () => {
      if (pageTranslatorManager === null) {
        pageTranslatorManager = new PageTranslatorManager($pageTranslatorState);
        pageTranslatorManager.start();
      }
      return pageTranslatorManager;
    };

    this.controllers.pageTranslator = new PageTranslatorController(
      getPageTranslatorManager,
      this.updatePageTranslationState,
      this.resolveTranslationOptions,
    );
    this.$context.subscribe(
      ({ pageTranslation }) => pageTranslation,
      (pageTranslation) => {
        if (pageTranslation !== null) {
          void getPageTranslatorManager();
        }
      },
      { fireImmediately: true },
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

    const { config: updatedConfig, pageTranslation } = this.$context.getState();
    if (
      pageLanguage !== null &&
      (await shouldAutoTranslate({
        isTranslating: pageTranslation !== null,
        pageLanguage,
        userLanguage: updatedConfig.language,
      }))
    ) {
      this.updatePageTranslationState({
        from: pageLanguage,
        to: updatedConfig.language,
      });
    }
  };
}
