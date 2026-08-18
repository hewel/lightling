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
  subscribe?(listener: (data: T) => void): () => void;
}

export class ConfigStorage implements AsyncStorage<AppConfigType> {
  private readonly storageName = 'appConfig';
  private readonly defaultData: AppConfigType;

  constructor(defaultData: AppConfigType) {
    this.defaultData = defaultData;
  }

  public async get(): Promise<AppConfigType> {
    const { [this.storageName]: data } = await browser.storage.local.get(
      this.storageName,
    );
    return this.decode(data);
  }

  public subscribe(listener: (data: AppConfigType) => void) {
    const handleStorageChange: Parameters<
      typeof browser.storage.onChanged.addListener
    >[0] = (changes, areaName) => {
      if (areaName !== 'local' || !Object.hasOwn(changes, this.storageName)) return;
      listener(this.decode(changes[this.storageName]?.newValue));
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }

  private decode(data: unknown): AppConfigType {
    if (data === undefined) return this.defaultData;

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
  private unsubscribe: (() => void) | null = null;

  public async getObservableStore(): Promise<ObservableStore<T>> {
    if (this.store === null) {
      const state = await this.config.get();
      this.store = createObservableStore<T>(state);
      this.unsubscribe =
        this.config.subscribe?.((data) => {
          this.store?.setState((state) => updateNotEqualProps(state, data));
        }) ?? null;
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

  public dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
