import browser from 'webextension-polyfill';

import { defaultConfig } from '@/config';
import { clearAllMocks } from '@/lib/tests';
import type { AppConfigType } from '@/types/runtime';

import { ConfigStorage, ObservableAsyncStorage } from '../ConfigStorage';
import { ConfigStorageMigration } from '../ConfigStorage.migrations';
import configVersion1 from './config-v1.json';
import configVersion3 from './config-v3.json';

const latestVersion = 14;

describe('config migrations', () => {
  beforeAll(clearAllMocks);

  test('migrate config from v0 to v3', async () => {
    // Load data
    localStorage.setItem('config.Main', JSON.stringify(configVersion1));

    // Migrate data
    await ConfigStorageMigration.migrate(0, 3);

    const { appConfig } = await browser.storage.local.get('appConfig');

    expect(appConfig).toEqual(configVersion3);
    expect(localStorage.getItem('config.Main')).toBeNull();
  });

  test('migrate config from v10 flat LLM config to v11 profiles', async () => {
    // Load data with the flat llmTranslator shape of version 10
    localStorage.setItem('config.Main', JSON.stringify(configVersion1));
    await ConfigStorageMigration.migrate(0, 10);
    await browser.storage.local.set({
      appConfig: {
        ...(await browser.storage.local.get('appConfig')).appConfig,
        llmTranslator: {
          apiUrl: 'https://llm.example/v1',
          apiKey: 'secret-key',
          model: 'test-model',
        },
      },
    });

    // Migrate data
    await ConfigStorageMigration.migrate(10, 11);

    const { appConfig } = await browser.storage.local.get('appConfig');
    expect(appConfig.llmTranslator).toEqual({
      activeProfile: 'Default',
      profiles: [
        {
          name: 'Default',
          provider: 'openai-compatible',
          apiUrl: 'https://llm.example/v1',
          apiKey: 'secret-key',
          model: 'test-model',
        },
      ],
    });

    // Keep the shared storage clean for the following snapshot test
    await browser.storage.local.clear();
    localStorage.clear();
  });

  test('migrate config v11 to v12 with execution overrides and an integer retry limit', async () => {
    await browser.storage.local.set({
      appConfig: {
        llmTranslator: {
          activeProfile: 'Default',
          profiles: [
            {
              name: 'Default',
              provider: 'openai-compatible',
              apiUrl: 'https://llm.example/v1',
              apiKey: 'secret-key',
              model: 'test-model',
            },
          ],
        },
        scheduler: {
          translateRetryAttemptLimit: 2.7,
        },
      },
    });

    // Migrate data
    await ConfigStorageMigration.migrate(11, 12);

    const { appConfig } = await browser.storage.local.get('appConfig');
    expect(appConfig.llmTranslator).toEqual({
      activeProfile: 'Default',
      profiles: [
        {
          name: 'Default',
          provider: 'openai-compatible',
          apiUrl: 'https://llm.example/v1',
          apiKey: 'secret-key',
          model: 'test-model',
          contextWindowTokens: null,
          preferredInputTokens: null,
          maxOutputTokens: null,
          maxConcurrentRequests: null,
        },
      ],
    });
    expect(appConfig.scheduler.translateRetryAttemptLimit).toBe(2);

    // Keep the shared storage clean for the following snapshot test
    await browser.storage.local.clear();
    localStorage.clear();
  });

  test('migrate config v12 to v13 with translation log export disabled', async () => {
    await browser.storage.local.set({
      appConfig: {
        pageTranslator: {
          lazyTranslate: true,
        },
      },
    });

    await ConfigStorageMigration.migrate(12, 13);

    const { appConfig } = await browser.storage.local.get('appConfig');
    expect(appConfig.pageTranslator).toEqual({
      lazyTranslate: true,
      enableLogExport: false,
    });

    await browser.storage.local.clear();
    localStorage.clear();
  });

  test('migrate config v13 to v14 with draggablePopup disabled', async () => {
    await browser.storage.local.set({
      appConfig: {
        selectTranslator: {
          enabled: true,
          showOriginalText: true,
        },
      },
    });

    await ConfigStorageMigration.migrate(13, 14);

    const { appConfig } = await browser.storage.local.get('appConfig');
    expect(appConfig.selectTranslator).toEqual({
      enabled: true,
      showOriginalText: true,
      draggablePopup: false,
    });

    await browser.storage.local.clear();
    localStorage.clear();
  });

  test('migrate config v0 to latest version', async () => {
    // Load data
    localStorage.setItem(
      'config.Main',
      JSON.stringify({
        ...configVersion1,
        translatorModule: 'BingTranslatorPublic',
      }),
    );

    // Migrate data
    await ConfigStorageMigration.migrate(0, latestVersion);

    const { appConfig } = await browser.storage.local.get('appConfig');
    expect(appConfig).toMatchSnapshot();
  });

  describe(`race condition detection`, () => {
    beforeEach(clearAllMocks);

    for (let attempt = 1; attempt <= 5; attempt++) {
      test(`Detection race conditions. Attempt #${attempt}`, async () => {
        // Load data
        localStorage.setItem(
          'config.Main',
          JSON.stringify({
            ...configVersion1,
            translatorModule: 'BingTranslatorPublic',
          }),
        );

        // Migrate part of data
        await ConfigStorageMigration.migrate(0, 5);

        // Migrate another part of data
        await ConfigStorageMigration.migrate(5, latestVersion);

        const { appConfig } = await browser.storage.local.get('appConfig');
        expect(appConfig).toMatchSnapshot();
      });
    }
  });
});

describe('use config', () => {
  beforeAll(clearAllMocks);

  test('config storage set/get', async () => {
    const configStorage = new ConfigStorage(defaultConfig);

    // Get config
    const config1 = await configStorage.get();
    expect(config1).toEqual(defaultConfig);

    const newData = { ...config1, translatorModule: 'testTranslator' };
    await configStorage.set(newData);

    const config2 = await configStorage.get();
    expect(config2).toEqual(newData);
  });

  test('observable storage', async () => {
    const configStorage = new ConfigStorage(defaultConfig);
    const observableConfigStorage = new ObservableAsyncStorage(configStorage);

    // Listen config update
    const $config = await observableConfigStorage.getObservableStore();
    const updateConfigPromise = new Promise<AppConfigType>((res) => {
      $config.subscribe((state) => res(state));
    });

    const latestConfig = await configStorage.get();
    await observableConfigStorage.set({ ...latestConfig, language: 'ja' });

    const updatedConfig = await updateConfigPromise;
    expect(updatedConfig.language).toBe('ja');
  });
});
