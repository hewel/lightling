import { isEqual } from 'lodash';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore, StoreApi } from 'zustand/vanilla';

/**
 * Vanilla store with selector subscriptions. Replaces the role effector stores played.
 */
export const createObservableStore = <T extends object>(initialState: T) =>
  createStore<T>()(subscribeWithSelector(() => initialState));

export type ObservableStore<T extends object> = StoreApi<T> & {
  subscribe: {
    (listener: (state: T, previousState: T) => void): () => void;
    <U>(
      selector: (state: T) => U,
      listener: (selectedState: U, previousSelectedState: U) => void,
      options?: {
        equalityFn?: (a: U, b: U) => boolean;
        fireImmediately?: boolean;
      },
    ): () => void;
  };
};

/**
 * Update only not-equal object properties (moved verbatim from lib/effector/reducers.ts).
 */
export const updateNotEqualProps = <T extends Record<string, unknown>>(
  state: T,
  data: T,
): T => {
  const newState = { ...state };
  for (const key in data) {
    if (!isEqual(state[key as keyof T], data[key as keyof T])) {
      newState[key as keyof T] = data[key as keyof T];
    }
  }
  return newState;
};
