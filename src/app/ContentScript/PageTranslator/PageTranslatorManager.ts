import type { ObservableStore } from '@/lib/store';

import type { PageTranslationOptions } from '../PageTranslationContext';
import { PageTranslator, type PageTranslatorConfig } from './PageTranslator';
import { PageTranslatorLifecycle } from './PageTranslatorLifecycle';

export class PageTranslatorManager {
  private readonly $state;
  private readonly pageTranslator: PageTranslator;

  constructor(
    $state: ObservableStore<{
      state: PageTranslationOptions | null;
      config: PageTranslatorConfig;
    }>,
    private readonly onStartupFailure: () => void = () => {},
  ) {
    this.$state = $state;

    // Create instances for translation
    const currentState = $state.getState();
    this.pageTranslator = new PageTranslator(currentState.config);
  }

  public getDomTranslator() {
    return this.pageTranslator;
  }

  public start() {
    const lifecycle = new PageTranslatorLifecycle(
      this.pageTranslator,
      this.onStartupFailure,
    );

    // Manage page translation instance
    this.$state.subscribe(
      ({ config }) => config,
      (config) => {
        void lifecycle.updateConfig(config).catch((error: unknown) => {
          console.warn('Failed to update page translator configuration', error);
        });
      },
      { fireImmediately: true },
    );

    // Manage page translation state
    this.$state.subscribe(
      ({ state }) => state,
      (pageTranslation) => {
        void lifecycle.updateState(pageTranslation).catch((error: unknown) => {
          console.warn('Failed to update page translator state', error);
        });
      },
      { fireImmediately: true },
    );
  }
}
