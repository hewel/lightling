import { getContentScriptStyles } from '@/lib/browser';
import type { PageTranslationLog } from '@/lib/pageTranslation/log';
import { ShadowDOMContainerManager } from '@/lib/ShadowDOMContainerManager';
import { getActiveLLMProfile } from '@/lib/translators/llm/LLMTranslator';
import {
  createConservativeTranslationModelProfile,
  resolveTranslationModelProfile,
} from '@/lib/translators/llm/modelProfile';
import {
  conservativeTokenCounter,
  resolveTranslationTokenizer,
} from '@/lib/translators/llm/tokenizer';
import { abortTranslation } from '@/requests/backend/abortTranslation';
import type { AppConfigType } from '@/types/runtime';

import { OriginalTextPopup } from './components/OriginalTextPopup/OriginalTextPopup';
import { PageTranslationPipeline } from './PageTranslationPipeline';
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

export class PageTranslator {
  private readonly documentIdentity = crypto.randomUUID();
  private translateContext: string = crypto.randomUUID();
  private pageTranslator: PageTranslationPipeline | null = null;
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
    return this.pageTranslator !== null;
  }

  public getStatus() {
    return this.translateState;
  }

  public getTranslateDirection() {
    return this.pageTranslateDirection;
  }

  public run(from: string, to: string) {
    if (this.pageTranslator !== null) {
      throw new Error('Page already translated');
    }

    this.translateContext = crypto.randomUUID();
    const localContext = this.translateContext;
    const configuredProfile =
      this.config.translatorModule === 'LLMTranslator' &&
      this.config.llmTranslator !== undefined
        ? getActiveLLMProfile(this.config.llmTranslator)
        : null;
    const provider =
      configuredProfile?.provider ?? this.config.translatorModule ?? 'unknown';
    const model = configuredProfile?.model ?? this.config.translatorModule ?? 'unknown';
    const profileResolution =
      configuredProfile === null
        ? null
        : resolveTranslationModelProfile(configuredProfile, null);
    const tokenizerResolution =
      configuredProfile === null
        ? null
        : resolveTranslationTokenizer(configuredProfile, null);
    const modelProfile =
      profileResolution === null || tokenizerResolution === null
        ? createConservativeTranslationModelProfile(model)
        : {
            ...profileResolution.profile,
            tokenizerId: tokenizerResolution.counter.id,
            tokenizerSource: tokenizerResolution.source,
            safetyReserveTokens:
              tokenizerResolution.counter.accuracy === 'estimate'
                ? Math.max(profileResolution.profile.safetyReserveTokens, 640)
                : profileResolution.profile.safetyReserveTokens,
          };
    const tokenCounter = tokenizerResolution?.counter ?? conservativeTokenCounter;
    const signature = [
      location.href,
      this.documentIdentity,
      from,
      to,
      provider,
      model,
      modelProfile.profileVersion,
      modelProfile.promptVersion,
      this.config.lazyTranslate ? 'lazy' : 'eager',
    ].join('\u0000');

    this.pageTranslateDirection = { from, to };
    this.pageTranslator = new PageTranslationPipeline({
      root: document.documentElement,
      sourceLanguage: from,
      targetLanguage: to,
      identity: {
        provider,
        model,
        promptVersion: modelProfile.promptVersion,
        profileVersion: modelProfile.profileVersion,
      },
      sessionId: localContext,
      sessionSignature: signature,
      modelProfile,
      tokenCounter,
      logEnabled: this.config.enableLogExport === true,
      debug:
        this.config.enableLogExport === true ||
        configuredProfile?.translationProfile?.debug === true,
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
    this.pageTranslator.start();

    if (this.config.originalTextPopup) {
      document.addEventListener('mouseover', this.showOriginalTextHandler);
    }
  }

  public getTranslationLog(): PageTranslationLog | null {
    return this.pageTranslator?.getLog() ?? null;
  }

  public stop() {
    if (this.pageTranslator === null) {
      throw new Error('Page is not translated');
    }

    const previousContext = this.pageTranslator.getSessionId();
    this.pageTranslator.stop();
    this.pageTranslator = null;
    this.pageTranslateDirection = null;

    this.translateContext = crypto.randomUUID();
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

    void abortTranslation({ context: previousContext }).catch((error) =>
      console.warn('Failed to abort page translation', error),
    );
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
