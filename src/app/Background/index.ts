// Translators
import {
  createFallbackTranslator,
  GoogleTranslator,
  GoogleTranslatorTokenFree,
  TranslatorConstructor,
} from 'anylang/translators';

import { TELEMETRY_EVENT_NAME } from '../../lib/telemetry';
import { telemetry } from '../../lib/telemetry/singleton';
import { BergamotTranslator } from '../../lib/translators/bergamot/BergamotTranslator';
import { LLMTranslator } from '../../lib/translators/llm/LLMTranslator';
import { isDeepEqual } from '../../lib/utils';
import {
  createPromiseWithControls,
  PromiseWithControls,
} from '../../lib/utils/createPromiseWithControls';
import { getTranslatorsClasses } from '../../requests/backend/translators';
import { AppConfigType } from '../../types/runtime';

import { ObservableAsyncStorage } from '../ConfigStorage/ConfigStorage';
import { TranslationAccounting } from './TranslationAccounting';
import { TranslationStatsStorage } from './TranslationStatsStorage';
import { TranslatorManager } from './TranslatorManager';
import { TTSController } from './TTS/TTSController';
import { TTSManager } from './TTS/TTSManager';

// Use one of the available Google API
const AggregatedGoogleTranslator = class extends createFallbackTranslator([
  {
    translator: new GoogleTranslator(),
    languages: new Set(GoogleTranslator.getSupportedLanguages()),
    languageDetection: GoogleTranslator.isSupportedAutoFrom(),
  },
  {
    translator: new GoogleTranslatorTokenFree(),
    languages: new Set(GoogleTranslatorTokenFree.getSupportedLanguages()),
    languageDetection: GoogleTranslatorTokenFree.isSupportedAutoFrom(),
  },
]) {
  static translatorName = 'Google';
};

const AutoTranslator = class extends createFallbackTranslator([
  {
    translator: new AggregatedGoogleTranslator(),
    languages: new Set(AggregatedGoogleTranslator.getSupportedLanguages()),
    languageDetection: AggregatedGoogleTranslator.isSupportedAutoFrom(),
  },
  {
    translator: new BergamotTranslator(),
    languages: new Set(BergamotTranslator.getSupportedLanguages()),
    languageDetection: BergamotTranslator.isSupportedAutoFrom(),
  },
]) {
  static translatorName = 'Auto';
  constructor() {
    super({
      onTranslatorError(error) {
        telemetry.track(TELEMETRY_EVENT_NAME.ERROR_CAPTURED, {
          scope: 'auto translator',
          error: String(error),
        });
      },
    });
  }
};

export const embeddedTranslators = {
  AutoTranslator,
  GoogleTranslator: AggregatedGoogleTranslator,
  BergamotTranslator,
  LLMTranslator,
} as const;

/**
 * Map where key is identifier of translator and value is translator constructor
 */
export type TranslatorsMap = Record<string, TranslatorConstructor>;

/**
 * Background features manager
 */
export class Background {
  private readonly config: ObservableAsyncStorage<AppConfigType>;
  private readonly ttsManager;
  constructor(config: ObservableAsyncStorage<AppConfigType>) {
    this.config = config;
    this.ttsManager = new TTSManager();
  }

  private translateManager: TranslatorManager | null = null;
  private translateManagerPromise: PromiseWithControls<TranslatorManager> | null = null;
  public async getTranslateManager() {
    if (this.translateManager === null) {
      // Create promise to await configuring instance
      if (this.translateManagerPromise === null) {
        const promiseWithControls = createPromiseWithControls<TranslatorManager>();

        // Set promise
        this.translateManagerPromise = promiseWithControls;

        // Clear promise
        promiseWithControls.promise.finally(() => {
          if (promiseWithControls === this.translateManagerPromise) {
            this.translateManagerPromise = null;
          }
        });
      }

      return this.translateManagerPromise.promise;
    }

    return this.translateManager;
  }

  public getTTSManager() {
    return this.ttsManager;
  }

  private readonly translationStatsStorage = new TranslationStatsStorage();
  private readonly translationAccounting = new TranslationAccounting(
    this.translationStatsStorage,
  );
  public getTranslationAccounting() {
    return this.translationAccounting;
  }

  public getTranslationStatsStorage() {
    return this.translationStatsStorage;
  }

  private ttsController: TTSController | null = null;
  public async getTTSController() {
    if (this.ttsController === null) {
      const $config = await this.config.getObservableStore();
      const config = $config.getState();
      this.ttsController = new TTSController(this.ttsManager, config.ttsModule);
    }

    return this.ttsController;
  }

  public async start() {
    const $config = await this.config.getObservableStore();

    // Build translators list
    const translators: TranslatorsMap = await getTranslatorsClasses();

    // Update config of translate manager
    $config.subscribe(
      ({ scheduler, translatorModule, cache, llmTranslator }) => ({
        scheduler,
        translatorModule,
        cache,
        llmTranslator,
      }),
      (config) => {
        if (this.translateManager === null) {
          this.translateManager = new TranslatorManager(config, translators, {
            onLLMTokenUsage: this.translationAccounting.recordLLMUsage,
          });

          // Return a scheduler instance for awaiters
          if (this.translateManagerPromise !== null) {
            this.translateManagerPromise.resolve(this.translateManager);
          }
          return;
        }

        this.translateManager.setConfig(config);
      },
      { equalityFn: isDeepEqual, fireImmediately: true },
    );

    // Update TTS module
    $config.subscribe(
      ({ ttsModule }) => ttsModule,
      (ttsModule) => {
        this.getTTSController().then((ttsController) => {
          ttsController.updateSpeaker(ttsModule);
        });
      },
      { fireImmediately: true },
    );
  }
}
