import browser from 'webextension-polyfill';

import {
  createObservableStore,
  type ObservableStore,
  updateNotEqualProps,
} from '@/lib/store';

import { decodeStruct } from '../../lib/types';
import { AppConfig, type AppConfigType } from '../../types/runtime';

export interface AsyncStorage<T> {
  get(): Promise<T>;
  set(data: T): Promise<void>;
}

export class ConfigStorage implements AsyncStorage<AppConfigType> {
  private readonly storageName = 'appConfig';
  private readonly defaultData: AppConfigType;

  constructor(defaultData: AppConfigType) {
    this.defaultData = defaultData;
  }

  public async get(): Promise<AppConfigType> {
    // Get config from browser storage
    const { [this.storageName]: data } = await browser.storage.local.get(
      this.storageName,
    );

    // Return default data for empty storage
    if (data === undefined) {
      return this.defaultData;
    }

    const configCodec = decodeStruct(AppConfig, data);
    if (configCodec.errors !== null) {
      throw new Error('Invalid config');
    }

    return configCodec.data;
  }

  public async set(data: AppConfigType) {
    await browser.storage.local.set({ [this.storageName]: data });
  }
}

export class ObservableAsyncStorage<
  T extends Record<any, any>,
> implements AsyncStorage<T> {
  private readonly config: AsyncStorage<T>;

  constructor(config: AsyncStorage<T>) {
    this.config = config;
  }

  private store: ObservableStore<T> | null = null;

  public async getObservableStore(): Promise<ObservableStore<T>> {
    if (this.store === null) {
      const state = await this.config.get();
      this.store = createObservableStore<T>(state);
    }

    return this.store;
  }

  public async get() {
    return this.config.get();
  }

  public async set(data: T) {
    const newObject = { ...data };

    await this.config.set(newObject);
    if (this.store !== null) {
      this.store.setState((state) => updateNotEqualProps(state, newObject));
    }
  }
}
