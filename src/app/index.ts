import browser from 'webextension-polyfill';
import { createStore, StoreApi } from 'zustand/vanilla';

import { defaultConfig } from '../config';
import { isBackgroundContext, isChromium, isFirefox } from '../lib/browser';
import { getAllTabs } from '../lib/browser/tabs';
import { TELEMETRY_EVENT_NAME } from '../lib/telemetry';
import { telemetry } from '../lib/telemetry/singleton';
import { TextTranslatorStorage } from '../pages/popup/tabs/TextTranslator/TextTranslator.utils/TextTranslatorStorage';
import { clearCache } from '../requests/backend/clearCache';
import { sendAppConfigUpdateEvent } from '../requests/global/appConfigUpdate';
import { customTranslatorsFactory } from '../requests/offscreen/customTranslators';
import { AppConfigType } from '../types/runtime';
import { Background } from './Background';
import { requestHandlers } from './Background/requestHandlers';
import { ConfigStorage, ObservableAsyncStorage } from './ConfigStorage/ConfigStorage';
import { TranslatePageContextMenu } from './ContextMenus/TranslatePageContextMenu';
import { TranslateSelectionContextMenu } from './ContextMenus/TranslateSelectionContextMenu';
import { migrateAll } from './migrations/migrationsList';

type OnInstalledData = null | browser.Runtime.OnInstalledDetailsType;

async function getWebGpuStatus() {
  if (!navigator.gpu) {
    return 'unsupported';
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    return 'no-adapter';
  }

  return 'available';
}

/**
 * Manage global states and application context
 */
export class App {
  /**
   * Run application
   */
  public static async main() {
    const onInstalledStore = createStore<OnInstalledData>()(() => null);
    browser.runtime.onInstalled.addListener((details) =>
      onInstalledStore.setState(details),
    );

    // Migrate data
    await migrateAll();

    const config = new ConfigStorage(defaultConfig);
    const observableConfig = new ObservableAsyncStorage(config);
    const background = new Background(observableConfig);

    const app = new App({
      config: observableConfig,
      background,
      $onInstalledData: onInstalledStore,
    });
    await app.start();
  }

  private readonly config: ObservableAsyncStorage<AppConfigType>;
  private readonly background: Background;
  private readonly $onInstalledData: StoreApi<OnInstalledData>;
  constructor({
    config,
    background,
    $onInstalledData,
  }: {
    config: ObservableAsyncStorage<AppConfigType>;
    background: Background;
    $onInstalledData: StoreApi<OnInstalledData>;
  }) {
    this.config = config;
    this.background = background;
    this.$onInstalledData = $onInstalledData;
  }

  private isStarted = false;
  public async start() {
    if (this.isStarted) {
      throw new Error('Application already started');
    }

    this.isStarted = true;

    await this.setupOffscreenDocuments();
    await this.background.start();

    await this.setupRequestHandlers();
    await this.handleConfigUpdates();

    this.onInstalled(this.$onInstalledData.getState());
    this.$onInstalledData.subscribe((state) => this.onInstalled(state));

    // Send telemetry info
    this.config
      .get()
      .then((config) => config)
      .catch(() => null)
      .then(async (config) => {
        const webGpuStatus = await getWebGpuStatus();

        telemetry.track(TELEMETRY_EVENT_NAME.APP_OPENED, {
          targetLanguage: config?.language,
          browserLanguage: navigator.language,
          browserLanguages: navigator.languages.join(','),
          webGpuStatus,
          hardwareConcurrency: navigator.hardwareConcurrency,
        });
      });
  }

  private async setupOffscreenDocuments() {
    // Setup sandboxed iframes
    if (isChromium()) {
      // Currently `offscreen` API is non standard, so we cast type
      const offscreen = (globalThis as any).chrome.offscreen;

      // We may have only one offscreen document, but we need more,
      // so we create only one "main" document, that creates embedded iframes
      try {
        offscreen.createDocument({
          url: 'pages/offscreen-documents/main/main.html',
          reasons: ['WORKERS', 'IFRAME_SCRIPTING', 'MATCH_MEDIA'],
          justification:
            'Main offscreen document, to run WASM and custom translators code in sandbox',
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith('Only a single offscreen')
        )
          throw error;
      }
    } else {
      customTranslatorsFactory();
    }
  }

  private async setupRequestHandlers() {
    // TODO: debug this condition and remove or move on top
    // Prevent run it again on other pages, such as options page
    if (!isFirefox() || isBackgroundContext()) {
      requestHandlers.forEach((factory) => {
        factory({
          config: this.config,
          backgroundContext: this.background,
        });
      });
    }
  }

  private async handleConfigUpdates() {
    const $appConfig = await this.config.getObservableStore();

    // Send update event
    $appConfig.subscribe(
      (state) => state,
      (config) => {
        sendAppConfigUpdateEvent(config);
      },
      { fireImmediately: true },
    );

    // Watch for updates
    $appConfig.subscribe(() => {
      telemetry.track(TELEMETRY_EVENT_NAME.SETTINGS_UPDATED);
    });

    // Clear cache while disable
    $appConfig.subscribe(
      (config) => config.scheduler.useCache,
      (useCache) => {
        if (!useCache) {
          clearCache();
        }
      },
      { fireImmediately: true },
    );

    // Clear TextTranslator state
    const textTranslatorStorage = new TextTranslatorStorage();
    $appConfig.subscribe(
      (config) => config.textTranslator.rememberText,
      (rememberText) => {
        if (!rememberText) {
          textTranslatorStorage.forgetText();
        }
      },
      { fireImmediately: true },
    );

    // Configure context menu
    const translateSelectionContextMenu = new TranslateSelectionContextMenu();
    $appConfig.subscribe(
      (config) => {
        const { enabled, mode } = config.selectTranslator;
        return enabled && mode === 'contextMenu';
      },
      (isEnabled) => {
        if (isEnabled) {
          translateSelectionContextMenu.enable();
        } else {
          translateSelectionContextMenu.disable();
        }
      },
      { fireImmediately: true },
    );

    const translatePageContextMenu = new TranslatePageContextMenu();
    $appConfig.subscribe(
      (config) => config.pageTranslator.enableContextMenu,
      (isEnabled) => {
        if (isEnabled) {
          translatePageContextMenu.enable();
        } else {
          translatePageContextMenu.disable();
        }
      },
      { fireImmediately: true },
    );
  }

  private readonly onInstalled = async (details: OnInstalledData) => {
    if (details === null) return;

    // Track install/updates
    if (details.reason === 'install') {
      telemetry.track(TELEMETRY_EVENT_NAME.APP_INSTALLED);
    }
    if (
      details.reason === 'update' &&
      details.previousVersion !== undefined &&
      details.previousVersion !== browser.runtime.getManifest().version
    ) {
      telemetry.track(TELEMETRY_EVENT_NAME.APP_UPDATED);
    }

    // Inject content scripts for chrome, to make page translation available just after install
    if (isChromium()) {
      const contentScriptFiles = browser.runtime.getManifest().content_scripts?.[0]?.js;
      if (!contentScriptFiles?.length) return;

      const tabs = await getAllTabs();
      tabs.forEach((tab) => {
        if (tab.status === 'unloaded') return;

        // Ignore special URLs
        if (
          !tab.url ||
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('https://chrome.google.com')
        )
          return;

        browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: contentScriptFiles,
        });
      });
    }
  };
}
