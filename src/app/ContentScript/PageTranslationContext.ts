import { createObservableStore, type ObservableStore } from '@/lib/store';
import { isDeepEqual } from '@/lib/utils';

import { getPageLanguage } from '../../lib/browser';
import type { AppConfigType } from '../../types/runtime';

import { startPageTranslationLifecycle } from './PageTranslationLifecycle';
import { shouldAutoTranslate } from './PageTranslator/autoTranslationDecision';
import { PageTranslatorController } from './PageTranslator/PageTranslatorController';
import { SelectTranslatorController } from './SelectTranslator/SelectTranslatorController';

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
    return startPageTranslationLifecycle({
      $context: this.$context,
      setPageTranslatorController: (controller) => {
        this.controllers.pageTranslator = controller;
      },
      setSelectTranslatorController: (controller) => {
        this.controllers.selectTranslator = controller;
      },
      updatePageTranslationState: this.updatePageTranslationState,
      resolveTranslationOptions: this.resolveTranslationOptions,
      scanPage: this.scanPage,
    });
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
