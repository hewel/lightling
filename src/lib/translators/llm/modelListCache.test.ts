import browser from 'webextension-polyfill';

import type { LLMModelInfo } from './modelInfo';

const fetchLLMModelsMock = vi.hoisted(() =>
  vi.fn<(profile?: unknown) => Promise<LLMModelInfo[]>>(),
);

vi.mock('./modelInfo', async (importOriginal) => {
  const original = await importOriginal<typeof import('./modelInfo')>();
  return {
    ...original,
    fetchLLMModels: fetchLLMModelsMock,
  };
});

import { fetchLLMModelsCached, getCachedLLMModels } from './modelListCache';

const makeModel = (id: string): LLMModelInfo => ({
  id,
  displayName: id,
  contextWindowTokens: null,
  contextWindowSource: null,
  maxInputTokens: null,
  maxInputSource: null,
  maxOutputTokens: null,
  maxOutputSource: null,
  supportedParameters: null,
  tokenizerId: null,
  supportsPrefixCaching: null,
});

const profileA = { provider: 'openrouter', apiUrl: '', apiKey: 'key-a' } as const;
const profileB = { provider: 'openrouter', apiUrl: '', apiKey: 'key-b' } as const;

beforeEach(async () => {
  fetchLLMModelsMock.mockReset();
  await browser.storage.local.clear();
});

describe('modelListCache', () => {
  test('fetches once and serves subsequent calls from cache', async () => {
    fetchLLMModelsMock.mockResolvedValue([makeModel('model-1')]);

    const first = await fetchLLMModelsCached(profileA);
    const second = await fetchLLMModelsCached(profileA);

    expect(fetchLLMModelsMock).toHaveBeenCalledTimes(1);
    expect(first.map(({ id }) => id)).toEqual(['model-1']);
    expect(second).toEqual(first);
  });

  test('deduplicates concurrent fetches for the same identity', async () => {
    fetchLLMModelsMock.mockResolvedValue([makeModel('model-1')]);

    const [first, second] = await Promise.all([
      fetchLLMModelsCached(profileA),
      fetchLLMModelsCached(profileA),
    ]);

    expect(fetchLLMModelsMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test('caches per discovery identity', async () => {
    fetchLLMModelsMock.mockResolvedValue([makeModel('model-1')]);

    await fetchLLMModelsCached(profileA);
    await fetchLLMModelsCached(profileB);

    expect(fetchLLMModelsMock).toHaveBeenCalledTimes(2);
  });

  test('forceRefresh refetches and replaces the cached entry', async () => {
    fetchLLMModelsMock.mockResolvedValueOnce([makeModel('model-1')]);
    await fetchLLMModelsCached(profileA);

    fetchLLMModelsMock.mockResolvedValueOnce([makeModel('model-2')]);
    const refreshed = await fetchLLMModelsCached(profileA, { forceRefresh: true });

    expect(fetchLLMModelsMock).toHaveBeenCalledTimes(2);
    expect(refreshed.map(({ id }) => id)).toEqual(['model-2']);
    expect((await getCachedLLMModels(profileA))?.map(({ id }) => id)).toEqual([
      'model-2',
    ]);
  });

  test('cache survives a module reload', async () => {
    fetchLLMModelsMock.mockResolvedValue([makeModel('model-1')]);
    await fetchLLMModelsCached(profileA);

    vi.resetModules();
    // Dynamic import is intentional: exercise module reloading against persisted storage
    const reloaded = await import('./modelListCache');

    const cached = await reloaded.fetchLLMModelsCached(profileA);
    expect(fetchLLMModelsMock).toHaveBeenCalledTimes(1);
    expect(cached.map(({ id }) => id)).toEqual(['model-1']);
  });

  test('returns null for an unknown identity', async () => {
    expect(await getCachedLLMModels(profileA)).toBeNull();
  });
});
