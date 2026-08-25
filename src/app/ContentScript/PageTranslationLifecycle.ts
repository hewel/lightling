import { createObservableStore, type ObservableStore } from '@/lib/store';
import { isDeepEqual } from '@/lib/utils';

import { onHotkeysPressed } from '../../components/controls/Hotkey/utils';
import type { AppConfigType } from '../../types/runtime';

import type { PageData, PageTranslationOptions } from './PageTranslationContext';
import { PageTranslatorController } from './PageTranslator/PageTranslatorController';
import { PageTranslatorManager } from './PageTranslator/PageTranslatorManager';
import { SelectTranslatorController } from './SelectTranslator/SelectTranslatorController';
import { SelectTranslatorManager } from './SelectTranslator/SelectTranslatorManager';

export type PageTranslationLifecycleState = {
  config: AppConfigType;
  pageTranslation: PageTranslationOptions | null;
  pageData: PageData;
};

export interface PageTranslationLifecycleDependencies {
  $context: ObservableStore<PageTranslationLifecycleState>;
  setPageTranslatorController: (controller: PageTranslatorController) => void;
  setSelectTranslatorController: (controller: SelectTranslatorController) => void;
  updatePageTranslationState: (pageTranslation: PageTranslationOptions | null) => void;
  resolveTranslationOptions: (
    options: PageTranslationOptions,
  ) => Promise<PageTranslationOptions>;
  scanPage: () => Promise<void>;
}

export const startPageTranslationLifecycle = ({
  $context,
  setPageTranslatorController,
  setSelectTranslatorController,
  updatePageTranslationState,
  resolveTranslationOptions,
  scanPage,
}: PageTranslationLifecycleDependencies): void => {
  const selectSlice = (state: PageTranslationLifecycleState) => ({
    enabled:
      state.config.selectTranslator.enabled &&
      (state.pageTranslation === null ||
        !state.config.selectTranslator.disableWhileTranslatePage),
    config: state.config.selectTranslator,
    pageData: state.pageData,
  });
  const $selectTranslatorState = createObservableStore(selectSlice($context.getState()));
  $context.subscribe(selectSlice, (slice) => $selectTranslatorState.setState(slice), {
    equalityFn: isDeepEqual,
  });

  const selectTranslatorManager = new SelectTranslatorManager($selectTranslatorState);
  selectTranslatorManager.start();
  setSelectTranslatorController(new SelectTranslatorController(selectTranslatorManager));

  const pageSlice = (state: PageTranslationLifecycleState) => ({
    state: state.pageTranslation,
    config: {
      ...state.config.pageTranslator,
      translatorModule: state.config.translatorModule,
      llmTranslator: state.config.llmTranslator,
    },
  });
  const $pageTranslatorState = createObservableStore(pageSlice($context.getState()));
  $context.subscribe(pageSlice, (slice) => $pageTranslatorState.setState(slice), {
    equalityFn: isDeepEqual,
  });

  let pageTranslatorManager: PageTranslatorManager | null = null;
  const getPageTranslatorManager = async () => {
    if (pageTranslatorManager === null) {
      pageTranslatorManager = new PageTranslatorManager($pageTranslatorState, () =>
        updatePageTranslationState(null),
      );
      pageTranslatorManager.start();
    }
    return pageTranslatorManager;
  };

  setPageTranslatorController(
    new PageTranslatorController(
      getPageTranslatorManager,
      updatePageTranslationState,
      resolveTranslationOptions,
    ),
  );
  $context.subscribe(
    ({ pageTranslation }) => pageTranslation,
    (pageTranslation) => {
      if (pageTranslation !== null) {
        void getPageTranslatorManager();
      }
    },
    { fireImmediately: true },
  );

  void scanPage();

  let hotkeysObserverCleanup: (() => void) | null = null;
  $context.subscribe(
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
            updatePageTranslationState(null);
          } else {
            if (pageLanguage === null) {
              throw new Error('Page language not set');
            }

            updatePageTranslationState({
              from: pageLanguage,
              to: userLanguage,
            });
          }
        });
      }
    },
    { equalityFn: isDeepEqual, fireImmediately: true },
  );
};
