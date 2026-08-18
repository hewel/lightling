import { createObservableStore, ObservableStore, updateNotEqualProps } from '@/lib/store';

import { getConfig } from '../../requests/backend/getConfig';
import { ping } from '../../requests/backend/ping';
import { onAppConfigUpdated } from '../../requests/global/appConfigUpdate';
import { AppConfigType } from '../../types/runtime';

export class ClientConfig {
  private store: ObservableStore<AppConfigType> | null = null;

  private readonly cleanupCallbacks: (() => void)[] = [];
  public async getStore() {
    if (this.store === null) {
      // TODO: add deadline
      // Wait load background script
      await ping({ delay: 100 });

      const state = await getConfig();
      this.store = createObservableStore(state);

      const unsubscribeRequestHandler = onAppConfigUpdated((config) => {
        this.store?.setState((state) => updateNotEqualProps(state, config));
      });

      this.cleanupCallbacks.push(unsubscribeRequestHandler);
    }

    return this.store;
  }

  public disconnect() {
    if (this.store === null) return;

    this.cleanupCallbacks.forEach((cleanup) => {
      cleanup();
    });
    this.store = null;
  }
}
