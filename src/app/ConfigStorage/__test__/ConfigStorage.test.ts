import browser from 'webextension-polyfill';

import { defaultConfig } from '@/config';
import { clearAllMocks } from '@/lib/tests';
import type { AppConfigType } from '@/types/runtime';

import { ConfigStorage, ObservableAsyncStorage } from '../ConfigStorage';
import { ConfigStorageMigration } from '../ConfigStorage.migrations';
import configVersion1 from './config-v1.json';
import configVersion3 from './config-v3.json';

const latestVersion = 10;

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
    observableConfigStorage.dispose();
  });

  test('observable storage receives updates from another context', async () => {
    const nextConfig = { ...defaultConfig, language: 'ja' };
    const reader = new ObservableAsyncStorage(new ConfigStorage(defaultConfig));
    const $config = await reader.getObservableStore();
    const updateConfigPromise = new Promise<AppConfigType>((resolve) => {
      $config.subscribe((state) => resolve(state));
    });
    const storageChangeListener = vi
      .mocked(browser.storage.onChanged.addListener)
      .mock.calls.at(-1)?.[0];
    if (storageChangeListener === undefined) {
      throw new Error('Config storage change listener was not registered');
    }

    storageChangeListener({ appConfig: { newValue: nextConfig } }, 'local');

    await expect(updateConfigPromise).resolves.toMatchObject({ language: 'ja' });
    reader.dispose();
  });
});
