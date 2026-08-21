import browser from 'webextension-polyfill';

import {
  fetchLLMModels,
  getLLMDiscoveryIdentity,
  loadLLMExecutionSettings,
  type LLMModelInfo,
  type ResolvedLLMExecutionSettings,
} from './modelInfo';
import type { ConfiguredLLMProfile } from './modelProfile';

type ProfileIdentity = Pick<ConfiguredLLMProfile, 'provider' | 'apiUrl' | 'apiKey'>;

const STORAGE_KEY = 'llmModelListCache';

interface ModelListCacheEntry {
  fetchedAt: number;
  models: LLMModelInfo[];
}

type ModelListCache = Record<string, ModelListCacheEntry>;

const readCache = async (): Promise<ModelListCache> => {
  const data = await browser.storage.local.get(STORAGE_KEY);
  const cache = data?.[STORAGE_KEY];
  return typeof cache === 'object' && cache !== null ? (cache as ModelListCache) : {};
};

/**
 * In-flight requests deduplication: parallel callers (options page, popup,
 * background translation) share a single network request per identity
 */
const pendingFetches = new Map<string, Promise<LLMModelInfo[]>>();

/**
 * Return the cached model list for the profile's discovery identity, or `null`
 */
export const getCachedLLMModels = async (
  profile: ProfileIdentity,
): Promise<LLMModelInfo[] | null> => {
  const cache = await readCache();
  return cache[getLLMDiscoveryIdentity(profile)]?.models ?? null;
};

/**
 * Fetch the model list once and remember it in `browser.storage.local`.
 *
 * The cache is keyed by discovery identity (provider + effective API URL + API
 * key), so any connection change invalidates the entry. It never expires;
 * pass `forceRefresh` to refetch deliberately.
 */
export const fetchLLMModelsCached = async (
  profile: ProfileIdentity,
  options?: { forceRefresh?: boolean },
): Promise<LLMModelInfo[]> => {
  const identity = getLLMDiscoveryIdentity(profile);

  if (options?.forceRefresh !== true) {
    const cached = await getCachedLLMModels(profile);
    if (cached !== null) return cached;
  }

  const pending = pendingFetches.get(identity);
  if (pending !== undefined) return pending;

  const request = fetchLLMModels(profile)
    .then(async (models) => {
      const cache = await readCache();
      cache[identity] = { fetchedAt: Date.now(), models };
      await browser.storage.local.set({ [STORAGE_KEY]: cache });
      return models;
    })
    .finally(() => {
      pendingFetches.delete(identity);
    });

  pendingFetches.set(identity, request);
  return request;
};

/**
 * `loadLLMExecutionSettings` backed by the persistent model list cache,
 * so runtime discovery does not refetch the list on every translation
 */
export const loadLLMExecutionSettingsCached = (
  profile: ConfiguredLLMProfile,
): Promise<ResolvedLLMExecutionSettings> =>
  loadLLMExecutionSettings(profile, fetchLLMModelsCached);
