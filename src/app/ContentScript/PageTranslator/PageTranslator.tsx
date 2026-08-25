import { getContentScriptStyles } from '@/lib/browser';
import type { PageTranslationLog } from '@/lib/pageTranslation/log';
import { ShadowDOMContainerManager } from '@/lib/ShadowDOMContainerManager';
import { getActiveLLMProfile } from '@/lib/translators/llm/LLMTranslator';
import { createUUID } from '@/lib/utils';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import type { AppConfigType } from '@/types/runtime';

import { OriginalTextPopup } from './components/OriginalTextPopup/OriginalTextPopup';
import { PageTranslationPipeline } from './PageTranslationPipeline';
import { preparePageTranslationSession } from './pageTranslationSession';
import { pageTranslatorStatsUpdated } from './requests/pageTranslatorStatsUpdated';

export type PageTranslatorStats = {
  resolved: number;
  rejected: number;
  pending: number;
};

export type PageTranslatorConfig = Partial<
  Pick<
    AppConfigType['pageTranslator'],
    | 'originalTextPopup'
    | 'translatableAttributes'
    | 'excludeSelectors'
    | 'lazyTranslate'
    | 'enableLogExport'
  >
> &
  Partial<Pick<AppConfigType, 'translatorModule' | 'llmTranslator'>>;

export class PageTranslationStartupCancelledError extends Error {
  public constructor() {
    super('Page translation startup cancelled because the page URL changed');
    this.name = 'PageTranslationStartupCancelledError';
  }
}

export class PageTranslator {
  private readonly documentIdentity = createUUID();
  private translateContext: string = createUUID();
  private pageTranslator: PageTranslationPipeline | null = null;
  private pendingRun: { generation: number; context: string } | null = null;
  private runGeneration = 0;
  private pageTranslateDirection: { from: string; to: string } | null = null;
  private translateState: PageTranslatorStats = {
    resolved: 0,
    rejected: 0,
    pending: 0,
  };

  private config: PageTranslatorConfig = {};
  constructor(config: PageTranslatorConfig) {
    this.updateConfig(config);
  }

  public updateConfig(config: PageTranslatorConfig) {
    this.config = { ...this.config, ...config };
  }
  public isRun() {
    return this.pageTranslator !== null || this.pendingRun !== null;
  }

  public getStatus() {
    return this.translateState;
  }

  public getTranslateDirection() {
    return this.pageTranslateDirection;
  }

  public async run(from: string, to: string) {
    if (this.pageTranslator !== null || this.pendingRun !== null) {
      throw new Error('Page already translated');
    }

    const generation = ++this.runGeneration;
    this.translateContext = createUUID();
    const localContext = this.translateContext;
    this.pendingRun = { generation, context: localContext };
    this.pageTranslateDirection = { from, to };
    const pageUrl = location.href;

    try {
      const session = await preparePageTranslationSession({
        config: this.config,
        from,
        to,
        documentIdentity: this.documentIdentity,
        pageUrl,
        sessionId: localContext,
      });
      const isCurrentPending =
        this.pendingRun?.generation === generation &&
        this.pendingRun.context === localContext;
      if (!isCurrentPending) return;
      if (location.href !== pageUrl) {
        throw new PageTranslationStartupCancelledError();
      }

      this.pageTranslator = new PageTranslationPipeline({
        root: document.documentElement,
        sourceLanguage: from,
        targetLanguage: to,
        identity: {
          provider: session.provider,
          model: session.model,
        },
        sessionId: session.sessionId,
        sessionSignature: session.sessionSignature,
        modelProfile: session.modelProfile,
        tokenCounter: session.tokenCounter,
        sizeTier: session.sizeTier,
        persistedBudget: session.persistedBudget,
        userConcurrencyCeiling:
          this.config.llmTranslator === undefined
            ? null
            : getActiveLLMProfile(this.config.llmTranslator).maxConcurrentRequests,
        onBudgetSnapshot: session.onBudgetSnapshot,
        logEnabled: session.logEnabled,
        debug: session.debug,
        translatableAttributes: this.config.translatableAttributes,
        excludeSelectors: (this.config.excludeSelectors ?? []).filter(
          (selector) => !selector.startsWith('!') && selector.trim() !== '',
        ),
        onUnitStarted: (count) => {
          if (localContext !== this.translateContext) return;
          this.translateState.pending += count;
          this.translateStateUpdate();
        },
        onUnitResolved: (count) => {
          if (localContext !== this.translateContext) return;
          this.translateState.resolved += count;
          this.translateState.pending = Math.max(0, this.translateState.pending - count);
          this.translateStateUpdate();
        },
        onUnitRejected: (count) => {
          if (localContext !== this.translateContext) return;
          this.translateState.rejected += count;
          this.translateState.pending = Math.max(0, this.translateState.pending - count);
          this.translateStateUpdate();
        },
      });
      this.pendingRun = null;
      this.pageTranslator.start();

      if (this.config.originalTextPopup) {
        document.addEventListener('mouseover', this.showOriginalTextHandler);
      }
    } catch (error) {
      if (
        this.pendingRun?.generation !== generation ||
        this.pendingRun.context !== localContext
      ) {
        return;
      }
      this.pendingRun = null;
      this.pageTranslateDirection = null;
      throw error;
    }
  }

  public getTranslationLog(): PageTranslationLog | null {
    return this.pageTranslator?.getLog() ?? null;
  }

  public stop() {
    if (this.pageTranslator === null && this.pendingRun === null) {
      throw new Error('Page is not translated');
    }

    const previousContext = this.pageTranslator?.getSessionId();
    ++this.runGeneration;
    this.pendingRun = null;
    this.pageTranslator?.stop();
    this.pageTranslator = null;
    this.pageTranslateDirection = null;

    this.translateContext = createUUID();
    this.translateState = {
      resolved: 0,
      rejected: 0,
      pending: 0,
    };
    this.translateStateUpdate();

    if (this.config.originalTextPopup) {
      document.removeEventListener('mouseover', this.showOriginalTextHandler);
      this.shadowRoot.unmountComponent();
    }

    if (previousContext !== undefined) {
      void abortTranslation({ context: previousContext }).catch((error) =>
        console.warn('Failed to abort page translation', error),
      );
    }
  }

  private readonly shadowRoot = new ShadowDOMContainerManager({
    styles: getContentScriptStyles(),
  });

  private readonly showOriginalTextHandler = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    const target = event.target;

    if (this.shadowRoot.getRootNode() === null) {
      this.shadowRoot.createRootNode();
    }

    const text = this.pageTranslator?.getOriginalText(target) ?? '';
    if (text !== '') {
      this.shadowRoot.mountComponent(
        <OriginalTextPopup target={{ current: target }}>{text}</OriginalTextPopup>,
      );
    } else {
      this.shadowRoot.unmountComponent();
    }
  };

  /**
   * For reduce re-render frequency on client
   */
  private readonly updateTimeout = 100;
  private lastSentUpdate = 0;
  private timer: number | null = null;
  private readonly translateStateUpdate = () => {
    if (this.timer !== null) return;

    const sendUpdate = () => {
      this.lastSentUpdate = new Date().getTime();
      pageTranslatorStatsUpdated(this.translateState);
    };

    const now = new Date().getTime();
    const idleTime = now - this.lastSentUpdate;
    if (idleTime >= this.updateTimeout) {
      sendUpdate();
    } else {
      this.timer = window.setTimeout(() => {
        this.timer = null;
        sendUpdate();
      }, this.updateTimeout - idleTime);
    }
  };
}
