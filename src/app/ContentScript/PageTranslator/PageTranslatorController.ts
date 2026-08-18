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
  constructor(
    getManager: () => Promise<PageTranslatorManager>,
    updateTranslationState: (options: PageTranslationOptions | null) => void,
  ) {
    this.getManager = getManager;
    this.updateTranslationState = updateTranslationState;
  }

  public async translate(options: PageTranslationOptions) {
    this.updateTranslationState(options);
    await this.notifyState();
    trackClientEvent(TELEMETRY_EVENT_NAME.PAGE_TRANSLATION_CHANGED, {
      action: 'run',
      from: options.from,
      to: options.to,
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

  private async notifyState() {
    pageTranslatorStateUpdated(await this.getStatus());
  }
}
