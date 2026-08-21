import { TELEMETRY_EVENT_NAME } from '@/lib/telemetry';
import { trackClientEvent } from '@/requests/backend/telemetry';

import type { PageTranslationOptions } from '../PageTranslationContext';
import type { PageTranslatorStats } from './PageTranslator';
import type { PageTranslatorManager } from './PageTranslatorManager';
import { pageTranslatorStateUpdated } from './requests/pageTranslatorStateUpdated';

export type PageTranslatorState = {
  isTranslated: boolean;
  counters: PageTranslatorStats;
  translateDirection: {
    from: string;
    to: string;
  } | null;
};

export class PageTranslatorController {
  private readonly getManager: () => Promise<PageTranslatorManager>;
  private readonly updateTranslationState: (
    options: PageTranslationOptions | null,
  ) => void;
  private readonly resolveTranslationOptions: (
    options: PageTranslationOptions,
  ) => Promise<PageTranslationOptions>;
  constructor(
    getManager: () => Promise<PageTranslatorManager>,
    updateTranslationState: (options: PageTranslationOptions | null) => void,
    resolveTranslationOptions: (
      options: PageTranslationOptions,
    ) => Promise<PageTranslationOptions>,
  ) {
    this.getManager = getManager;
    this.updateTranslationState = updateTranslationState;
    this.resolveTranslationOptions = resolveTranslationOptions;
  }

  public async translate(options: PageTranslationOptions) {
    const resolvedOptions = await this.resolveTranslationOptions(options);
    this.updateTranslationState(resolvedOptions);
    await this.notifyState();
    trackClientEvent(TELEMETRY_EVENT_NAME.PAGE_TRANSLATION_CHANGED, {
      action: 'run',
      from: resolvedOptions.from,
      to: resolvedOptions.to,
    });
  }

  public async stopTranslate() {
    this.updateTranslationState(null);
    await this.notifyState();
    trackClientEvent(TELEMETRY_EVENT_NAME.PAGE_TRANSLATION_CHANGED, {
      action: 'stop',
    });
  }

  public async getStatus(): Promise<PageTranslatorState> {
    const manager = await this.getManager();
    const domTranslator = manager.getDomTranslator();
    return {
      isTranslated: domTranslator.isRun(),
      counters: domTranslator.getStatus(),
      translateDirection: domTranslator.getTranslateDirection(),
    };
  }

  public async getTranslationLog() {
    const manager = await this.getManager();
    return manager.getDomTranslator().getTranslationLog();
  }

  private async notifyState() {
    pageTranslatorStateUpdated(await this.getStatus());
  }
}
